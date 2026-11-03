import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { sourceSocket } from '../src/runtime/source-socket.ts';

function peer() {
  const emitter = new EventEmitter();
  const closes: unknown[][] = [];
  const ws = Object.assign(emitter, { send() {}, close(...args: unknown[]) { closes.push(args); } });
  return { ws, closes, socket: sourceSocket(ws as unknown as WebSocket) };
}

test('source handshake frame survives the promise continuation and retains order', async () => {
  const { ws, socket } = peer(), received: string[] = [];
  const connected = Promise.resolve(socket);
  ws.emit('message', Buffer.from('first'));
  const source = await connected;
  source.onMessage(data => received.push(data));
  ws.emit('message', Buffer.from('second'));
  await Promise.resolve();
  ws.emit('message', Buffer.from('third'));
  assert.deepEqual(received, ['first', 'second', 'third']);
});

test('real upgrade response and first frame in the same TCP write are retained', { timeout: 5000 }, async t => {
  const server = createServer();
  const connections = new Set<import('node:net').Socket>();
  server.on('connection', connection => { connections.add(connection); connection.once('close', () => connections.delete(connection)); });
  t.after(async () => {
    for (const connection of connections) connection.destroy();
    await new Promise<void>(done => server.close(() => done()));
  });
  server.on('upgrade', (request, connection) => {
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const header = Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const payload = Buffer.from('first source snapshot');
    connection.write(Buffer.concat([header, Buffer.from([0x81, payload.length]), payload]));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  t.after(() => client.terminate());
  const adapted = sourceSocket(client);
  const connected = new Promise<ReturnType<typeof sourceSocket>>((done, reject) => {
    client.once('open', () => done(adapted)); client.once('error', reject);
  });
  const source = await connected;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const frame = await new Promise<string>((done, reject) => {
      timer = setTimeout(() => reject(new Error('handshake frame was lost')), 1000);
      source.onMessage(done);
    });
    assert.equal(frame, 'first source snapshot');
  } finally { clearTimeout(timer); }
});

test('early source close/error are delivered after listeners attach', async () => {
  const { ws, socket } = peer(); let closed = 0, failed = 0;
  ws.emit('error', new Error('synthetic error')); ws.emit('close');
  socket.onClose(() => closed++); socket.onError(() => failed++);
  await Promise.resolve();
  assert.equal(closed, 1); assert.equal(failed, 1);
});

test('cancelled source drops buffered frames, including cancellation during replay', async () => {
  for (const cancelBefore of [true, false]) {
    const { ws, socket } = peer(), received: string[] = [];
    ws.emit('message', Buffer.from('one')); ws.emit('message', Buffer.from('two'));
    socket.onMessage(data => { received.push(data); socket.close(1000, 'cancelled'); });
    if (cancelBefore) socket.close(1000, 'cancelled');
    await Promise.resolve();
    ws.emit('message', Buffer.from('late'));
    assert.deepEqual(received, cancelBefore ? [] : ['one']);
  }
});

test('initial source buffer limits both frame count and UTF-8 bytes', async () => {
  for (const oversized of [false, true]) {
    const { ws, socket, closes } = peer(); let failed = 0;
    if (oversized) ws.emit('message', Buffer.alloc(12_000_001, 'x'));
    else for (let i = 0; i < 65; i++) ws.emit('message', Buffer.from('x'));
    socket.onMessage(() => assert.fail('overflowed frames must not be replayed'));
    socket.onError(() => failed++);
    await Promise.resolve();
    assert.deepEqual(closes, [[1009, 'initial source buffer exceeded']]);
    assert.equal(failed, 1);
  }
});
