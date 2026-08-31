const readline = require('node:readline');
const send = x => process.stdout.write(JSON.stringify(x) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'crash') process.exit(3);
  if (msg.method === 'hang') return;
  if (msg.method === 'echo') { const raw = JSON.stringify({ id: msg.id, result: msg.params }) + '\n'; process.stdout.write(raw.slice(0, 8)); setTimeout(() => process.stdout.write(raw.slice(8)), 5); return; }
  if (msg.method === 'initialize') send({ id: msg.id, result: { userAgent: 'fixture' } });
  if (msg.method === 'config/read') send({ id: msg.id, result: { config: { mcp_servers: { dangerous: { enabled: true } } } } });
  if (msg.method === 'thread/start') {
    if (msg.params.sandbox !== 'read-only' || msg.params.approvalPolicy !== 'never' || msg.params.config['mcp_servers.dangerous.enabled'] !== false) return send({ id: msg.id, error: { message: 'Unsafe thread configuration' } });
    send({ id: msg.id, result: { thread: { id: 'thread-1' } } });
  }
  if (msg.method === 'turn/start') {
    send({ id: msg.id, result: { turn: { id: 'turn-1' } } });
    if (!msg.params.outputSchema || msg.params.sandboxPolicy.type !== 'readOnly') throw Error('unsafe turn');
    const result = { mode: 'guide', title: 'Next idea', text: 'Explain the result.', insert_text: '', evidence_ids: [], outline_ids: [], citation_keys: [], claims: [], proposal: null, edit: null };
    send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id: 'message-1', phase: 'final_answer', text: JSON.stringify(result) } } });
    send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  }
});
