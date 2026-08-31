// A deterministic local fixture for visual QA. This is not a model backend for users.
import { createServer } from "node:http";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
const root = process.cwd();
const work = path.join(root, "test-results/ui-workspace");
const user = path.join(root, "test-results/ui-user-data");
if (!process.argv.includes("--server-only"))
  await cp("examples/bridge-study", work, { recursive: true });
await mkdir(path.join(user, "User"), { recursive: true });
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const packet = JSON.parse(
    JSON.parse(body)
      .messages[0].content.split("CURRENT RESEARCH CONTEXT (JSON):\n")[1]
      .split("\nPRIOR CONVERSATION")[0],
  );
  const pdf = packet.artifacts.find(
    (a) => a.kind === "pdf" && a.locator.page === 2,
  );
  const result = packet.artifacts.find(
    (a) => a.kind === "result" && a.locator.rows?.includes(6),
  );
  const data = {
    mode: packet.mode,
    title:
      packet.mode === "evidence"
        ? "Inspect the synthetic comparison"
        : "Explain when the gap widens",
    text: "Connect the stronger-constraint comparison to the section’s goal. Then acknowledge the runtime tradeoff before drawing an efficiency conclusion.",
    insert_text:
      packet.mode === "write"
        ? "with the comparison becoming clearer under stronger constraints."
        : "",
    evidence_ids: [pdf?.id, result?.id].filter(Boolean),
    source_notes: pdf
      ? [
          {
            artifact_id: pdf.id,
            summary:
              "The synthetic reference contrasts sampling approaches under stronger constraints and notes a runtime tradeoff.",
            relevance:
              "It supports the comparison you are developing here, while reminding you to discuss runtime before claiming efficiency.",
          },
        ]
      : [],
    outline_ids: [],
    citation_keys: [],
    claims: [],
    proposal:
      packet.mode === "visual"
        ? {
            type: "figure",
            purpose:
              "Compare effective sample size and runtime across constraint strengths.",
            placement: "After the comparison paragraph.",
            data_ids: result ? [result.id] : [],
            existing_artifact_ids: [],
            panels: ["A · Effective sample size", "B · Runtime"],
          }
        : null,
    edit:
      packet.mode === "chat"
        ? {
            path: "paper/results.tex",
            original:
              "The synthetic results suggest a difference in effective sample size.",
            replacement:
              "The synthetic comparison motivates a closer look at effective sample size.",
          }
        : null,
  };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(data) } }],
    }),
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
await mkdir(path.join(work, ".vscode"), { recursive: true });
await writeFile(
  path.join(work, ".vscode/settings.json"),
  JSON.stringify({
    "researchCopilot.backend": "local",
    "researchCopilot.localEndpoint": `http://127.0.0.1:${server.address().port}/v1`,
    "researchCopilot.localModel": "synthetic-ui-fixture",
  }),
);
await writeFile(
  path.join(user, "User/settings.json"),
  JSON.stringify({
    "security.workspace.trust.enabled": false,
    "workbench.startupEditor": "none",
    "telemetry.telemetryLevel": "off",
    "window.title": "Research Copilot — synthetic UI fixture",
    "researchCopilot.backend": "local",
    "researchCopilot.localEndpoint": `http://127.0.0.1:${server.address().port}/v1`,
    "researchCopilot.localModel": "synthetic-ui-fixture",
    "workbench.colorTheme": "Default Light Modern",
  }),
);
const child = process.argv.includes("--server-only")
  ? undefined
  : spawn(
      "code",
      [
        "--new-window",
        "--user-data-dir",
        user,
        "--extensions-dir",
        path.join(root, "test-results/ui-extensions"),
        "--disable-extensions",
        "--extensionDevelopmentPath",
        root,
        work,
        path.join(work, "paper/results.tex"),
      ],
      { stdio: "inherit" },
    );
console.log(
  "Synthetic UI fixture running locally; stop this process after visual QA.",
);
process.on("SIGINT", () => {
  server.close();
  child?.kill();
  process.exit();
});
