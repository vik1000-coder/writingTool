import { OUTPUT_SCHEMA } from "../core/integrity";
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
export class HttpBackend implements ResearchModelBackend {
  constructor(
    private config: {
      kind: "local" | "openai" | "grok";
      endpoint?: string;
      model: string;
      apiKey?: string;
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
      schema: OUTPUT_SCHEMA,
    };
    const body =
      local || grok
        ? {
            model: this.config.model,
            messages: [{ role: "user", content: request.prompt }],
            stream: false,
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
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        ...(!local ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
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
      value: JSON.parse(result.replace(/^```(?:json)?\s*|\s*```$/g, "")),
    };
  }
  dispose() {}
}
