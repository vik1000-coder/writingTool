// Explicit, paid live smoke check. Reads only the key file supplied by the caller;
// never prints credentials, headers, or raw provider errors.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { HttpBackend } from "../src/backends/http";
import { assembleContext, buildPrompt } from "../src/core/context";
import { validateSuggestion, resolveSuggestion } from "../src/core/integrity";
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: smoke-grok.ts <key-file.txt|rtf> [model]");
  const text = file.toLowerCase().endsWith(".rtf")
    ? execFileSync("/usr/bin/textutil", ["-convert", "txt", "-stdout", file], {
        encoding: "utf8",
        maxBuffer: 100000,
      })
    : readFileSync(file, "utf8");
  const keys = [...new Set(text.match(/\bxai-[A-Za-z0-9_-]+/g))];
  if (keys.length !== 1)
    throw new Error("The supplied file must contain exactly one xAI key.");
  const model = process.argv[3] || "grok-4.3";
  const backend = new HttpBackend({
    kind: "grok",
    model,
    apiKey: keys[0],
    cacheSession: "synthetic-live-write-smoke",
  });
  const manuscript = "\\section{Results}\nThis synthetic example illustrates";
  const context = assembleContext({
    mode: "write",
    path: "paper/results.tex",
    text: manuscript,
    offset: manuscript.length,
    artifacts: [],
    budget: 4000,
  });
  const start = performance.now();
  try {
    for await (const event of backend.suggest({
      context,
      prompt: buildPrompt(context),
    })) {
      if (event.type !== "result") continue;
      const result = resolveSuggestion(
        validateSuggestion(event.value, "write"),
        [],
      );
      if (!result.insertable)
        throw new Error("Live WRITE failed local integrity checks.");
      console.log(
        JSON.stringify({
          liveGrokPassed: true,
          model,
          elapsedMs: Math.round(performance.now() - start),
          characters: result.suggestion.insert_text.length,
          outputFields: Object.keys(event.value as object),
          usage: event.usage,
          continuation: result.suggestion.insert_text,
        }),
      );
    }
  } finally {
    backend.dispose();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live check failed");
  process.exitCode = 1;
});
