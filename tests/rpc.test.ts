import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { JsonLineClient } from "../src/backends/rpc";
import { CodexBackend } from "../src/backends/codex";
import { assembleContext } from "../src/core/context";
const args = [path.resolve("tests/fixtures/rpc-server.cjs")];
test("JSONL handles split frames, timeout, missing executable and process death", async () => {
  const client = new JsonLineClient(process.execPath, args);
  try {
    assert.deepEqual(await client.request("echo", { nested: ["hello"] }), {
      nested: ["hello"],
    });
    await assert.rejects(
      client.request("hang", {}, { timeoutMs: 20 }),
      /timed out/,
    );
    await assert.rejects(client.request("crash", {}), /exited/);
  } finally {
    client.dispose();
  }
  const missing = new JsonLineClient("/missing/research-copilot-binary", []);
  await assert.rejects(missing.request("test", {}), /ENOENT/);
  missing.dispose();
});
test("Codex protocol handshake enforces readonly sandbox, disables inherited MCP servers, and resolves structured turn", async () => {
  const backend = new CodexBackend({
    executable: process.execPath,
    args,
    cwd: process.cwd(),
  });
  try {
    const context = assembleContext({
      mode: "guide",
      path: "paper.tex",
      text: "Result.",
      offset: 7,
      artifacts: [],
      budget: 4000,
    });
    const events = [];
    for await (const e of backend.suggest({ context, prompt: "guide" }))
      events.push(e);
    assert.equal(events.at(-1)?.type, "result");
    assert.equal(
      (events.at(-1) as { value: { mode: string } }).value.mode,
      "guide",
    );
  } finally {
    backend.dispose();
  }
});
test("Codex cancellation interrupts a pending turn and denies file-change approval", async () => {
  const backend = new CodexBackend({
    executable: process.execPath,
    args: [path.resolve("tests/fixtures/codex-delayed.cjs")],
    cwd: process.cwd(),
  });
  const abort = new AbortController();
  const context = assembleContext({
    mode: "guide",
    path: "paper.tex",
    text: "Result.",
    offset: 7,
    artifacts: [],
    budget: 4000,
  });
  try {
    const pending = (async () => {
      for await (const e of backend.suggest({
        context,
        prompt: "guide",
        signal: abort.signal,
      })) {
        if (e.type === "status" && e.text.startsWith("Reasoning"))
          setTimeout(() => abort.abort(), 50);
      }
    })();
    await assert.rejects(pending, /cancelled/);
  } finally {
    backend.dispose();
  }
});

test("cancellation before turn acknowledgement stops the dedicated Codex helper", async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "research-cancel-"));
  const marker = path.join(dir, "stopped");
  const backend = new CodexBackend({
    executable: process.execPath,
    args: [path.resolve("tests/fixtures/codex-delayed.cjs"), marker],
    cwd: process.cwd(),
  });
  const abort = new AbortController();
  const context = assembleContext({
    mode: "guide",
    path: "paper.tex",
    text: "Result.",
    offset: 7,
    artifacts: [],
    budget: 4000,
  });
  try {
    await assert.rejects(
      (async () => {
        for await (const event of backend.suggest({
          context,
          prompt: "guide",
          signal: abort.signal,
        })) {
          if (event.type === "status" && event.text.startsWith("Reasoning"))
            setTimeout(() => abort.abort(), 30);
        }
      })(),
      /cancelled/,
    );
    let stopped = false;
    for (let n = 0; n < 50 && !stopped; n++) {
      stopped = await fs.readFile(marker, "utf8").then(
        (text) => text === "stopped",
        () => false,
      );
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(stopped, "Cancellation must not leave an unknown turn running");
  } finally {
    backend.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
