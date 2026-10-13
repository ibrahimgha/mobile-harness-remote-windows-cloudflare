// Hermetic native-driver fixture. This runs under Node, never calls Codex or a model.
const readline = require('node:readline');
let threadId;
let turnId = 'fixture-turn';
const out = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const notify = (method, params) => out({ method, params });
const input = (params) => notify('item/started', { threadId, turnId, item: { type: 'userMessage', clientId: params.clientUserMessageId, content: params.input } });
const finish = (status) => {
  notify('item/completed', { threadId, turnId, item: { type: 'agentMessage', phase: 'final_answer', text: 'Native fixture response' } });
  notify('turn/completed', { threadId, turn: { id: turnId, status } });
};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  const { id, method, params = {} } = message;
  notify('fixture/rpc', { method, params });
  if (method === 'initialize') out({ id, result: {} });
  if (method === 'thread/resume') {
    threadId = params.threadId;
    out(threadId === 'failure-fixture' ? { id, error: { code: -32000, message: 'Fixture refused resume' } } : { id, result: { thread: { id: threadId } } });
  }
  if (method === 'turn/start') {
    out({ id, result: { turn: { id: turnId } } });
    notify('turn/started', { threadId, turn: { id: turnId } });
    input(params);
    notify('item/completed', { threadId, turnId, item: { type: 'agentMessage', phase: 'commentary', text: 'Fixture is running' } });
    // An unrelated child's completion must not finish the root job.
    notify('turn/completed', { threadId: 'subagent-fixture', turn: { id: 'subagent-turn', status: 'completed' } });
    if (threadId === 'disconnect-fixture') setTimeout(() => process.exit(0), 20);
  }
  if (method === 'turn/steer') {
    if (params.expectedTurnId !== turnId) { out({ id, error: { code: -32000, message: 'Turn mismatch' } }); return; }
    input(params);
    out({ id, result: { turnId } });
    setTimeout(() => finish('completed'), 20);
  }
  if (method === 'turn/interrupt') {
    out({ id, result: {} });
    setTimeout(() => finish('interrupted'), 20);
  }
}).on('close', () => process.exit(0));
