import { spawn } from "node:child_process";
import path from "node:path";
const root = process.cwd();
// The CLI opens a separate extension development window without changing installed extensions.
const executable = process.platform === "win32" ? "code.cmd" : "code";
const child = spawn(
  executable,
  [
    "--new-window",
    "--extensionDevelopmentPath=" + root,
    path.join(root, "examples/bridge-study"),
    path.join(root, "examples/bridge-study/paper/results.tex"),
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);
child.on("error", (error) => {
  console.error(
    error.message + "\nAlternatively, open this repo in VS Code and press F5.",
  );
  process.exitCode = 1;
});
