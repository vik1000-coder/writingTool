import { JsonLineClient, type RpcMessage } from "./rpc";
import { schemaForMode } from "../core/integrity";
import type {
  ResearchModelBackend,
  ResearchRequest,
  ResearchEvent,
} from "../core/types";

interface Options {
  executable: string;
  cwd: string;
  model?: string;
  args?: string[];
  log?: (text: string) => void;
}
export class CodexBackend implements ResearchModelBackend {
  private client?: JsonLineClient;
  private connecting?: Promise<JsonLineClient>;
  private busy = false;
  constructor(private options: Options) {}
  private connect(): Promise<JsonLineClient> {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const rpc = new JsonLineClient(
        this.options.executable,
        this.options.args ?? ["app-server", "--listen", "stdio://"],
        {
          cwd: this.options.cwd,
          log: this.options.log,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        },
      );
      this.client = rpc;
      rpc.on("request", (m: RpcMessage) => {
        // Never approve a tool action, sandbox escape, or external connector operation.
        if (m.method?.endsWith("/requestApproval"))
          rpc.send({ id: m.id, result: { decision: "decline" } });
        else
          rpc.send({
            id: m.id,
            error: {
              code: -32601,
              message:
                "Research Copilot suggestion sessions do not allow tools or permissions",
            },
          });
      });
      rpc.on("closed", () => {
        this.connecting = undefined;
        this.client = undefined;
      });
      try {
        await rpc.request("initialize", {
          clientInfo: {
            name: "research_copilot",
            title: "Research Copilot",
            version: "0.1.0",
          },
          capabilities: { experimentalApi: false },
        });
        rpc.send({ method: "initialized", params: {} });
        return rpc;
      } catch (e) {
        rpc.dispose();
        this.connecting = undefined;
        throw e;
      }
    })();
    return this.connecting;
  }
  async account(): Promise<any> {
    return (await this.connect()).request("account/read", {
      refreshToken: false,
    });
  }
  async login(): Promise<{ authUrl?: string; loginId?: string }> {
    return (await this.connect()).request("account/login/start", {
      type: "chatgpt",
    });
  }
  async models(): Promise<{
    data: {
      id: string;
      model: string;
      displayName: string;
      isDefault: boolean;
    }[];
  }> {
    return (await this.connect()).request("model/list", {});
  }

  async *suggest(request: ResearchRequest): AsyncIterable<ResearchEvent> {
    if (this.busy) throw new Error("A Codex request is already running");
    this.busy = true;
    let cleanup = () => {};
    try {
      if (request.signal?.aborted) throw new Error("Request cancelled");
      yield { type: "status", text: "Connecting to Codex…" };
      const rpc = await this.connect();
      const effective = await rpc.request("config/read", {
        includeLayers: false,
      });
      const config: Record<string, unknown> = {
        "features.shell_tool": false,
        "features.apply_patch_freeform": false,
        "features.apps": false,
        "features.multi_agent": false,
        "features.js_repl": false,
        "features.code_mode": false,
        web_search: "disabled",
        "shell_environment_policy.inherit": "none",
      };
      for (const name of Object.keys(effective.config?.mcp_servers ?? {}))
        config[`mcp_servers.${name}.enabled`] = false;
      const started = await rpc.request(
        "thread/start",
        {
          cwd: this.options.cwd,
          ...(this.options.model ? { model: this.options.model } : {}),
          sandbox: "read-only",
          approvalPolicy: "never",
          ephemeral: true,
          config,
          baseInstructions:
            "You are a read-only research writing assistant. Use only the supplied context, never tools, skills, shell, file changes or external services. Return the requested structured response.",
        },
        { signal: request.signal },
      );
      const threadId: string = started.thread.id;
      if (request.signal?.aborted) throw new Error("Request cancelled");
      let turnId: string | undefined;
      const messages = new Map<string, { text: string; phase?: string }>();
      let settle!: (value: unknown) => void, fail!: (e: Error) => void;
      const completed = new Promise<unknown>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      });
      // Attach immediately: notification frames may arrive before turn/start's response.
      completed.catch(() => {});
      const interrupt = () => {
        if (turnId)
          void rpc
            .request(
              "turn/interrupt",
              { threadId, turnId },
              { timeoutMs: 3000 },
            )
            .catch(() => {});
      };
      const abort = () => {
        interrupt();
        fail(new Error("Request cancelled"));
      };
      const closed = (e: Error) => fail(e);
      const receive = (m: RpcMessage) => {
        const p = m.params;
        if (
          !p ||
          p.threadId !== threadId ||
          (turnId && p.turnId && p.turnId !== turnId)
        )
          return;
        if (m.method === "item/completed" && p.item?.type === "agentMessage")
          messages.set(p.item.id, { text: p.item.text, phase: p.item.phase });
        if (m.method === "turn/completed") {
          if (turnId && p.turn.id !== turnId) return;
          if (p.turn.status !== "completed") {
            fail(
              new Error(p.turn.error?.message ?? `Codex turn ${p.turn.status}`),
            );
            return;
          }
          const final =
            [...messages.values()]
              .filter((v) => v.phase === "final_answer")
              .at(-1) ?? [...messages.values()].at(-1);
          try {
            if (!final?.text)
              throw new Error("Codex returned no final response");
            if (final.text.length > 100000)
              throw new Error("Codex response too large");
            settle(
              JSON.parse(final.text.replace(/^```(?:json)?\s*|\s*```$/g, "")),
            );
          } catch (e) {
            fail(e instanceof Error ? e : new Error(String(e)));
          }
        }
      };
      const timer = setTimeout(() => {
        interrupt();
        fail(new Error("Codex suggestion timed out after 120 seconds"));
      }, 120000);
      rpc.on("notification", receive);
      rpc.on("closed", closed);
      request.signal?.addEventListener("abort", abort, { once: true });
      cleanup = () => {
        clearTimeout(timer);
        rpc.off("notification", receive);
        rpc.off("closed", closed);
        request.signal?.removeEventListener("abort", abort);
      };
      yield {
        type: "status",
        text: "Reasoning over selected project context…",
      };
      const turn = await rpc
        .request(
          "turn/start",
          {
            threadId,
            input: [{ type: "text", text: request.prompt }],
            approvalPolicy: "never",
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            outputSchema: schemaForMode(request.context.mode),
          },
          { signal: request.signal },
        )
        .catch((error) => {
          // The server may already have started inference without returning a
          // turn ID. Stop this dedicated helper so cancellation cannot leave an
          // unaddressable background turn running (or billing).
          if (request.signal?.aborted) rpc.dispose();
          throw error;
        });
      turnId = turn.turn.id;
      if (request.signal?.aborted) abort();
      yield { type: "result", value: await completed };
    } finally {
      cleanup();
      this.busy = false;
    }
  }
  dispose() {
    this.client?.dispose();
    this.client = undefined;
    this.connecting = undefined;
  }
}
