import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { JsonLineClient } from '../src/backends/rpc';
import { CodexBackend } from '../src/backends/codex';
import { assembleContext } from '../src/core/context';
const args = [path.resolve('tests/fixtures/rpc-server.cjs')];
test('JSONL handles split frames, timeout, missing executable and process death', async () => {
  const client = new JsonLineClient(process.execPath, args);
  try {
    assert.deepEqual(await client.request('echo', { nested: ['hello'] }), { nested: ['hello'] });
    await assert.rejects(client.request('hang', {}, { timeoutMs: 20 }), /timed out/);
    await assert.rejects(client.request('crash', {}), /exited/);
  } finally { client.dispose(); }
  const missing = new JsonLineClient('/missing/research-copilot-binary', []);
  await assert.rejects(missing.request('test', {}), /ENOENT/);
  missing.dispose();
});
test('Codex protocol handshake enforces readonly sandbox, disables inherited MCP servers, and resolves structured turn', async () => {
  const backend = new CodexBackend({ executable: process.execPath, args, cwd: process.cwd() });
  try {
    const context = assembleContext({ mode: 'guide', path: 'paper.tex', text: 'Result.', offset: 7, artifacts: [], budget: 4000 });
    const events = [];
    for await (const e of backend.suggest({ context, prompt: 'guide' })) events.push(e);
    assert.equal(events.at(-1)?.type, 'result');
    assert.equal((events.at(-1) as { value: { mode: string } }).value.mode, 'guide');
  } finally { backend.dispose(); }
});
