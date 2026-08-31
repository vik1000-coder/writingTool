import { CodexBackend } from "../src/backends/codex";
import { assembleContext, buildPrompt } from "../src/core/context";
import { validateSuggestion } from "../src/core/integrity";
import path from "node:path";
async function main() {
  const backend = new CodexBackend({
    executable: process.env.RESEARCH_CODEX_PATH || "codex",
    model: process.env.RESEARCH_CODEX_MODEL,
    cwd: path.resolve("examples/bridge-study"),
  });
  try {
    const account = await backend.account();
    console.log(
      JSON.stringify({
        authenticated: Boolean(account.account),
        accountType: account.account?.type,
      }),
    );
    const models = await backend.models();
    console.log(JSON.stringify({ availableModels: models.data.length }));
    if (!process.argv.includes("--generate")) return;
    const context = assembleContext({
      mode: "guide",
      path: "paper/results.tex",
      text: "\\section{Results}\nThis is a synthetic demonstration, not a real experiment.",
      offset: 73,
      artifacts: [],
      budget: 4000,
    });
    for await (const event of backend.suggest({
      context,
      prompt: buildPrompt(
        context,
        "Suggest one short next-sentence intention. Do not make empirical claims; there is no evidence in this test.",
      ),
    })) {
      if (event.type === "status") console.log(event.text);
      else {
        const result = validateSuggestion(event.value, "guide");
        console.log(
          JSON.stringify({
            liveCodexPassed: true,
            mode: result.mode,
            title: result.title,
            text: result.text,
          }),
        );
      }
    }
  } finally {
    backend.dispose();
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
