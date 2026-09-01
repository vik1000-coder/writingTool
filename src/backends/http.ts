import { schemaForMode } from "../core/integrity";
import type {
  ResearchModelBackend,
  ResearchRequest,
  ResearchEvent,
} from "../core/types";
export function localEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Local model endpoint must be an HTTP(S) loopback URL with no credentials",
    );
  return url.href.replace(/\/$/, "");
}
function parseStructuredText(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (original) {
    if (!cleaned.startsWith("{")) throw original;
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let index = 0; index < cleaned.length; index++) {
      const character = cleaned[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0)
        return JSON.parse(cleaned.slice(0, index + 1));
    }
    throw original;
  }
}
function connectionError(label: string, error: unknown, aborted: boolean) {
  if (aborted || (error instanceof Error && error.name === "AbortError"))
    return new Error(`${label} request was aborted.`);
  if (error instanceof Error && error.name === "TimeoutError")
    return new Error(
      `${label} request timed out after 120 seconds. Check your network, VPN, proxy, firewall, or provider status and try again.`,
    );
  const cause =
      error instanceof Error && "cause" in error
        ? (error.cause as { code?: unknown } | undefined)
        : undefined,
    code = typeof cause?.code === "string" ? cause.code : "";
  const hint = /ENOTFOUND|EAI_AGAIN/.test(code)
    ? " DNS lookup failed; check your connection, VPN, proxy, or firewall."
    : /ECONNREFUSED/.test(code)
      ? " The connection was refused; check that the selected service is reachable."
      : /TIMEOUT|ETIMEDOUT/.test(code)
        ? " The connection timed out; check your network, VPN, proxy, or firewall."
        : /CERT|TLS|SSL/.test(code)
          ? " TLS certificate validation failed; check your proxy or network security settings."
          : " Check your internet connection, VPN, proxy, or firewall and try again.";
  return new Error(`${label} could not connect.${hint}`);
}
export class HttpBackend implements ResearchModelBackend {
  constructor(
    private config: {
      kind: "local" | "openai" | "grok";
      endpoint?: string;
      model: string;
      apiKey?: string;
      cacheSession?: string;
    },
  ) {}
  async *suggest(request: ResearchRequest): AsyncIterable<ResearchEvent> {
    if (!this.config.model.trim())
      throw new Error(
        `Choose a ${this.config.kind} model ID in Research Copilot settings`,
      );
    if (this.config.kind === "openai" && !this.config.apiKey?.trim())
      throw new Error(
        "Set your OpenAI API key with Research Copilot: Set OpenAI API Key. API billing is separate from ChatGPT.",
      );
    if (this.config.kind === "grok" && !this.config.apiKey?.trim())
      throw new Error(
        "Set your xAI key with Research Copilot: Set Grok API Key. Grok API usage is billed by xAI.",
      );
    const local = this.config.kind === "local";
    if (!local && !/^[\x21-\x7E]+$/.test(this.config.apiKey!))
      throw new Error(
        "Invalid API key format. Enter a key without spaces or control characters using the API key command.",
      );
    const grok = this.config.kind === "grok";
    const label = local ? "Local model" : grok ? "Grok API" : "OpenAI API";
    const endpoint = local
      ? localEndpoint(this.config.endpoint ?? "http://127.0.0.1:11434/v1") +
        "/chat/completions"
      : grok
        ? "https://api.x.ai/v1/chat/completions"
        : "https://api.openai.com/v1/responses";
    const schema = {
      name: "research_suggestion",
      strict: true,
      schema: schemaForMode(request.context.mode),
    };
    const body =
      local || grok
        ? {
            model: this.config.model,
            messages: grok
              ? grokMessages(request)
              : [{ role: "user", content: request.prompt }],
            stream: false,
            ...(grok &&
            request.context.mode === "write" &&
            /^grok-4\.3(?:-|$)/.test(this.config.model)
              ? { reasoning_effort: "none", max_tokens: 1536 }
              : {}),
            ...(grok &&
            request.context.mode === "write" &&
            /^grok-4\.[56](?:-|$)/.test(this.config.model)
              ? { reasoning_effort: "low" }
              : {}),
            response_format: { type: "json_schema", json_schema: schema },
          }
        : {
            model: this.config.model,
            store: false,
            input: request.prompt,
            text: { format: { type: "json_schema", ...schema } },
          };
    yield {
      type: "status",
      text: local
        ? "Asking your local model…"
        : `Asking ${label} (separate API billing)…`,
    };
    const signal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(120000)])
      : AbortSignal.timeout(120000);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          ...(!local ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...(grok &&
          this.config.cacheSession &&
          /^[a-zA-Z0-9_-]{1,100}$/.test(this.config.cacheSession)
            ? { "x-grok-conv-id": this.config.cacheSession }
            : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw connectionError(label, error, request.signal?.aborted ?? false);
    }
    if (!response.ok)
      throw new Error(
        `${label} returned HTTP ${response.status}. Check model availability and authentication.`,
      );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Model returned an empty response");
    let data = "",
      size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1000000)
          throw new Error("Model response exceeds 1 MB limit");
        data += decoder.decode(value, { stream: true });
      }
      data += decoder.decode();
    } finally {
      await reader.cancel();
    }
    const parsed = JSON.parse(data);
    const result =
      local || grok
        ? parsed.choices?.[0]?.message?.content
        : parsed.output
            ?.filter((o: any) => o.type === "message")
            .flatMap((o: any) => o.content ?? [])
            .filter((c: any) => c.type === "output_text")
            .map((c: any) => c.text)
            .join("");
    if (typeof result !== "string" || !result)
      throw new Error("Model returned no structured text (possibly a refusal)");
    yield {
      type: "result",
      value: parseStructuredText(result),
      ...(parsed.usage
        ? {
            usage: {
              inputTokens:
                Number(
                  parsed.usage.prompt_tokens ?? parsed.usage.input_tokens,
                ) || 0,
              cachedInputTokens:
                Number(
                  parsed.usage.prompt_tokens_details?.cached_tokens ??
                    parsed.usage.input_tokens_details?.cached_tokens,
                ) || 0,
              outputTokens:
                Number(
                  parsed.usage.completion_tokens ?? parsed.usage.output_tokens,
                ) || 0,
              ...(Number.isFinite(Number(parsed.usage.cost_in_usd_ticks)) &&
              Number(parsed.usage.cost_in_usd_ticks) >= 0
                ? {
                    costUsd:
                      Number(parsed.usage.cost_in_usd_ticks) / 10_000_000_000,
                  }
                : {}),
            },
          }
        : {}),
    };
  }
  dispose() {}
}

function grokMessages(request: ResearchRequest) {
  const start = request.prompt.indexOf("\nCURRENT RESEARCH CONTEXT (JSON):\n");
  const tail = request.prompt.indexOf("\nPRIOR CONVERSATION (may be stale):\n");
  if (start < 0 || tail < start)
    return [{ role: "user", content: request.prompt }];
  const { current, ...stable } = request.context;
  return [
    { role: "system", content: request.prompt.slice(0, start) },
    {
      role: "user",
      content:
        "PROJECT EVIDENCE (UNTRUSTED JSON):\n" +
        JSON.stringify({
          ...stable,
          artifacts: [...stable.artifacts].sort((a, b) =>
            a.id.localeCompare(b.id),
          ),
        }),
    },
    {
      role: "user",
      content:
        "CURRENT WRITING POSITION (UNTRUSTED JSON):\n" +
        JSON.stringify(current) +
        request.prompt.slice(tail),
    },
  ];
}
