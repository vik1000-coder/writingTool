import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { HttpBackend, localEndpoint } from "../src/backends/http";
import { assembleContext } from "../src/core/context";
test("local backend rejects remote endpoints, credentials and URL tricks", () => {
  assert.equal(
    localEndpoint("http://127.0.0.1:11434/v1/"),
    "http://127.0.0.1:11434/v1",
  );
  for (const url of [
    "http://example.com/v1",
    "http://localhost.example.com",
    "http://localhost@evil.com",
    "file:///tmp/server",
    "http://localhost/v1?redirect=evil",
  ])
    assert.throws(() => localEndpoint(url));
});
test("local backend requests JSON schema, does not follow redirects, and honors cancellation", async () => {
  let requestBody: any;
  let mode = "ok";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    requestBody = JSON.parse(body);
    if (mode === "redirect") {
      res.writeHead(302, { Location: "http://example.com" });
      res.end();
      return;
    }
    if (mode === "hang") return;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: '{"answer":"structured"}' } }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const backend = new HttpBackend({
    kind: "local",
    endpoint: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    model: "test-model",
  });
  const context = assembleContext({
    mode: "guide",
    path: "main.tex",
    text: "Text.",
    offset: 5,
    artifacts: [],
    budget: 4000,
  });
  const consume = async (signal?: AbortSignal) => {
    const events = [];
    for await (const e of backend.suggest({
      context,
      prompt: "bounded prompt",
      signal,
    }))
      events.push(e);
    return events;
  };
  try {
    const events = await consume();
    assert.equal(events.at(-1)?.type, "result");
    assert.equal(requestBody.response_format.json_schema.strict, true);
    assert.equal(requestBody.messages[0].content, "bounded prompt");
    mode = "redirect";
    await assert.rejects(consume(), /fetch failed/);
    mode = "hang";
    const abort = new AbortController();
    const pending = consume(abort.signal);
    setTimeout(() => abort.abort(), 20);
    await assert.rejects(pending, /abort/i);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
