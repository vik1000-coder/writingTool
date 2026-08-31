import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { HttpBackend, localEndpoint } from "../src/backends/http";
import { assembleContext, buildPrompt } from "../src/core/context";
test("Grok WRITE uses compact output, no reasoning on the fast profile, and cacheable stable messages", async (t) => {
  const context = assembleContext({
    mode: "write",
    path: "main.tex",
    text: "We show",
    offset: 7,
    artifacts: [],
    budget: 4000,
  });
  const bodies: any[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      assert.equal(
        (init.headers as any)["x-grok-conv-id"],
        "synthetic-session",
      );
      assert.equal(body.reasoning_effort, "none");
      assert.deepEqual(body.response_format.json_schema.schema.required, [
        "insert_text",
        "evidence_ids",
        "citation_keys",
        "claims",
      ]);
      assert.equal(body.messages[0].role, "system");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"insert_text":" a difference.","evidence_ids":[],"citation_keys":[],"claims":[]}',
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            prompt_tokens_details: { cached_tokens: 75 },
          },
        }),
      );
    },
  );
  const backend = new HttpBackend({
    kind: "grok",
    model: "grok-4.3",
    apiKey: "synthetic-key",
    cacheSession: "synthetic-session",
  });
  for (let i = 0; i < 2; i++) {
    const events = [];
    for await (const event of backend.suggest({
      context,
      prompt: buildPrompt(context),
    }))
      events.push(event);
    assert.equal((events.at(-1) as any).usage.cachedInputTokens, 75);
    context.current.before += " more";
  }
  assert.deepEqual(
    bodies[0].messages.slice(0, 2),
    bodies[1].messages.slice(0, 2),
  );
  assert.notDeepEqual(bodies[0].messages[2], bodies[1].messages[2]);
});
test("cloud adapters reject malformed keys, refused/malformed output and oversized responses", async (t) => {
  const context = assembleContext({
    mode: "guide",
    path: "main.tex",
    text: "Text.",
    offset: 5,
    artifacts: [],
    budget: 4000,
  });
  let calls = 0,
    content: string | null = null;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls++;
    const body = url.includes("api.x.ai")
      ? { choices: [{ message: { content } }] }
      : {
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: content }],
            },
          ],
        };
    return new Response(JSON.stringify(body));
  });
  for (const kind of ["grok", "openai"] as const) {
    const consume = async (apiKey = "synthetic-key") => {
      for await (const _ of new HttpBackend({
        kind,
        model: "fixture",
        apiKey,
      }).suggest({ context, prompt: "test" })) {
        /* consume */
      }
    };
    const before = calls;
    await assert.rejects(
      consume("synthetic-secret\ninvalid"),
      (e: Error) =>
        /key/i.test(e.message) && !e.message.includes("synthetic-secret"),
    );
    assert.equal(
      calls,
      before,
      "Malformed key must never enter the HTTP stack",
    );
    content = null;
    await assert.rejects(consume(), /no structured text/);
    content = "not JSON";
    await assert.rejects(consume(), SyntaxError);
    content = "x".repeat(1000001);
    await assert.rejects(consume(), /1 MB limit/);
  }
});
test("Grok uses only xAI, authenticates, requests strict JSON and redacts errors", async (t) => {
  const context = assembleContext({
    mode: "guide",
    path: "main.tex",
    text: "Text.",
    offset: 5,
    artifacts: [],
    budget: 4000,
  });
  let calls = 0,
    status = 200;
  const abort = new AbortController();
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://api.x.ai/v1/chat/completions");
    assert.equal(init.redirect, "error");
    assert.equal((init.headers as any).Authorization, "Bearer test-secret");
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, "grok-4.6");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.messages[0].content, "bounded prompt");
    assert.equal(body.tools, undefined);
    assert.equal(init.signal?.aborted, abort.signal.aborted);
    if (init.signal?.aborted) throw new Error("aborted");
    return new Response(
      status === 200
        ? JSON.stringify({
            choices: [{ message: { content: '{"answer":"ok"}' } }],
          })
        : "test-secret private response",
      { status },
    );
  });
  const consume = async (apiKey?: string) => {
    const backend = new HttpBackend({
      kind: "grok",
      model: "grok-4.6",
      apiKey,
      endpoint: "https://evil.example",
    });
    const events = [];
    for await (const event of backend.suggest({
      context,
      prompt: "bounded prompt",
      signal: abort.signal,
    }))
      events.push(event);
    return events;
  };
  await assert.rejects(consume(), /Set Grok API Key/);
  assert.equal(calls, 0);
  assert.deepEqual((await consume("test-secret")).at(-1), {
    type: "result",
    value: { answer: "ok" },
  });
  status = 401;
  await assert.rejects(
    consume("test-secret"),
    (error: Error) =>
      /Grok.*401/.test(error.message) && !error.message.includes("test-secret"),
  );
  abort.abort();
  await assert.rejects(consume("test-secret"), /aborted/);
});
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
