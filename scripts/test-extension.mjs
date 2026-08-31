import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import { cp, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const root = process.cwd();
await build({
  entryPoints: ["tests/extension/suite.ts"],
  outfile: "dist/test-suite.js",
  bundle: true,
  platform: "node",
  target: "node20",
  external: ["vscode"],
});
const temp = await mkdtemp(path.join(tmpdir(), "research-copilot-test-"));
const workspace = path.join(temp, "workspace");
const userData = path.join(temp, "user-data");
await cp("examples/bridge-study", workspace, { recursive: true });
await mkdir(path.join(userData, "User"), { recursive: true });
await writeFile(
  path.join(userData, "User/settings.json"),
  JSON.stringify({
    "security.workspace.trust.enabled": false,
    "workbench.startupEditor": "none",
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "telemetry.telemetryLevel": "off",
    "editor.accessibilitySupport": "off",
    "editor.inlineSuggest.enabled": true,
    "researchCopilot.backend": "local",
    "researchCopilot.localModel": "fixture",
  }),
);
const localExecutable =
  "/Applications/Visual Studio Code.app/Contents/MacOS/Electron";
try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "dist/test-suite.js"),
    ...(existsSync(localExecutable)
      ? { vscodeExecutablePath: localExecutable }
      : { version: process.env.VSCODE_VERSION || "stable" }),
    launchArgs: [
      workspace,
      "--user-data-dir",
      userData,
      "--extensions-dir",
      path.join(temp, "extensions"),
      "--disable-extensions",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
      "--no-sandbox",
    ],
    extensionTestsEnv: { RESEARCH_TEST_ROOT: workspace },
  });
} finally {
  await rm(temp, { recursive: true, force: true });
}
