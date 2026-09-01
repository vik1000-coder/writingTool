import { test } from "node:test";
import assert from "node:assert/strict";
import { CompletionCache } from "../src/core/completion-cache";
const snapshot = {
  scope: "project/provider/model",
  uri: "file:///main.tex",
  before: "We observe ",
  after: "\nNext paragraph.",
};
test("WRITE cache reuses exact inputs and only the untyped suffix, never changed surrounding text", () => {
  let now = 0;
  const cache = new CompletionCache<{ sourceHash: string }>({
    now: () => now,
    ttlMs: 100,
    maxEntries: 2,
    maxBytes: 2000,
  });
  cache.put(snapshot, "a difference.", { sourceHash: "current" });
  assert.equal(cache.find(snapshot)?.remaining, "a difference.");
  assert.equal(
    cache.find({ ...snapshot, before: snapshot.before + "a diff" })?.remaining,
    "erence.",
  );
  for (const change of [
    { before: snapshot.before + "another" },
    { after: "changed" },
    { scope: "other model" },
    { uri: "file:///other.tex" },
    { before: snapshot.before + "a difference." },
  ])
    assert.equal(cache.find({ ...snapshot, ...change }), undefined);
  now = 101;
  assert.equal(cache.size, 0, "Expired outputs are removed from memory");
  assert.equal(
    cache.find(snapshot),
    undefined,
    "Expired outputs cannot reappear",
  );
});
test("WRITE cache is bounded by bytes/LRU count, replaces regenerations, and clears completely", () => {
  const cache = new CompletionCache<number>({ maxEntries: 2, maxBytes: 2000 });
  cache.put(snapshot, "first", 1);
  cache.put({ ...snapshot, uri: "b" }, "second", 2);
  cache.find(snapshot);
  cache.put({ ...snapshot, uri: "c" }, "third", 3);
  assert.equal(cache.find({ ...snapshot, uri: "b" }), undefined);
  cache.put(snapshot, "replacement", 4);
  assert.equal(cache.find(snapshot)?.remaining, "replacement");
  assert.equal(cache.find(snapshot)?.data, 4);
  cache.put({ ...snapshot, before: "x".repeat(5000) }, "huge", 5);
  assert.ok(cache.bytes <= 2000);
  assert.ok(cache.size <= 2);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.bytes, 0);
});
test("highlight-focused completions never leak into ordinary cursor completions", () => {
  const cache = new CompletionCache<number>();
  cache.put({ ...snapshot, focus: "selected-a" }, "focused", 1);
  assert.equal(cache.find(snapshot), undefined);
  assert.equal(cache.find({ ...snapshot, focus: "selected-b" }), undefined);
  assert.equal(
    cache.find({ ...snapshot, focus: "selected-a" })?.remaining,
    "focused",
  );
});
