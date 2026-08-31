const readline = require('node:readline');
const send = x => process.stdout.write(JSON.stringify(x) + '\n');
if (process.argv[2]) process.on('SIGTERM', () => {
  require('node:fs').writeFileSync(process.argv[2], 'stopped');
  process.exit(0);
});
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({id:m.id,result:{}});
  if (m.method === 'config/read') send({id:m.id,result:{config:{}}});
  if (m.method === 'thread/start') send({id:m.id,result:{thread:{id:'slow'}}});
  if (m.method === 'turn/start') {
    if (process.argv[2]) return; // Simulate starting inference without acknowledging its ID.
    send({id:m.id,result:{turn:{id:'turn'}}});
    send({id:900,method:'item/fileChange/requestApproval',params:{threadId:'slow',turnId:'turn'}});
  }
  if (m.id === 900) {
    if (m.result.decision !== 'decline') throw new Error('Edit was not denied');
    send({method:'fixture/denied',params:{}});
  }
  if (m.method === 'turn/interrupt') {
    send({id:m.id,result:{}});
    send({method:'turn/completed',params:{threadId:'slow',turn:{id:'turn',status:'interrupted'}}});
  }
});
