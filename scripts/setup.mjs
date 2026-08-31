import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
const python =
  process.env.RESEARCH_PYTHON ||
  (process.platform === "win32" ? "python" : "python3");
const target = path.resolve(
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!existsSync(target)) run(python, ["-m", "venv", ".venv"]);
run(target, ["-m", "ensurepip", "--upgrade"]);
run(target, ["-m", "pip", "install", "-r", "requirements.txt"]);
console.log(
  "\nLocal helper ready. In VS Code open this repository and press F5, or run npm run dev.",
);
