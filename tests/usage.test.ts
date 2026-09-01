import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSessionUsage,
  emptyUsageSession,
  summarizeUsage,
} from "../src/core/usage";

test("Grok usage prefers reported cost and otherwise estimates cached token pricing", () => {
  const reported = summarizeUsage("grok", "grok-4.3", {
    inputTokens: 1000,
    cachedInputTokens: 250,
    outputTokens: 100,
    costUsd: 0.0042,
  });
  assert.equal(reported.costUsd, 0.0042);
  assert.equal(reported.costKind, "reported");
  assert.equal(reported.totalTokens, 1100);

  const estimated = summarizeUsage("grok", "grok-4.3", {
    inputTokens: 1000,
    cachedInputTokens: 250,
    outputTokens: 100,
  });
  assert.equal(estimated.costKind, "estimated");
  assert.equal(estimated.costUsd, 0.0012375);

  const unavailable = summarizeUsage("codex", "gpt-fixture", {
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 5,
  });
  assert.equal(unavailable.costUsd, undefined);
  assert.equal(unavailable.costKind, "unavailable");
});

test("session usage accumulates requests, tokens, and known costs", () => {
  const first = summarizeUsage("grok", "grok-4.6", {
    inputTokens: 200,
    cachedInputTokens: 0,
    outputTokens: 20,
    costUsd: 0.00052,
  });
  const second = summarizeUsage("grok", "grok-4.3", {
    inputTokens: 100,
    cachedInputTokens: 50,
    outputTokens: 10,
    costUsd: 0.0001,
  });
  const session = addSessionUsage(
    addSessionUsage(emptyUsageSession(), first),
    second,
  );
  assert.deepEqual(session, {
    requests: 2,
    pricedRequests: 2,
    inputTokens: 300,
    cachedInputTokens: 50,
    outputTokens: 30,
    totalTokens: 330,
    costUsd: 0.00062,
  });
});
