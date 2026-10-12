import { createInterface } from 'node:readline';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'test' } });
  if (message.method === 'echo')
    setTimeout(() => send({ id: message.id, result: message.params }), message.params.delay || 0);
  if (message.method === 'approval') {
    send({
      id: 'server-7',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread', command: 'git status' },
    });
    send({ id: message.id, result: {} });
  }
  if (message.id === 'server-7')
    send({
      method: 'serverRequest/resolved',
      params: { requestId: message.id, threadId: 'thread' },
    });
  if (message.method === 'fail')
    send({ id: message.id, error: { code: -123, message: 'Access denied' } });
  if (message.method === 'exit') process.exit(1);
});
