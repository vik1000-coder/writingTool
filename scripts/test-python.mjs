import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
const local = path.resolve(
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python =
  process.env.RESEARCH_PYTHON ||
  (existsSync(local)
    ? local
    : process.platform === "win32"
      ? "python"
      : "python3");
const result = spawnSync(
  python,
  ["-m", "unittest", "discover", "-s", "tests/python", "-v"],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status || 0);
