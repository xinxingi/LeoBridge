import test from 'node:test';
import assert from 'node:assert/strict';

test('paused and replaced sockets cannot cancel requests on the new connection', async () => {
  const sockets = [];
  class FakeSocket {
    readyState = 0;
    sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
  }
  globalThis.window = {location: {protocol:'http:', host:'theme.localhost'}};
  globalThis.document = {visibilityState:'visible'};
  globalThis.WebSocket = FakeSocket;
  const {rpc2} = await import('../src/lib/rpc2.ts');
  const old = sockets[0]; old.open();
  rpc2.pause();
  assert.equal(old.readyState, 3);
  rpc2.resume();
  const active = sockets[1]; active.open();
  const response = rpc2.call('common:getNodesLatestStatus');
  const request = active.sent.at(-1);
  old.onclose?.();
  active.onmessage({data:JSON.stringify({jsonrpc:'2.0',id:request.id,result:{node:{cpu:0}}})});
  assert.deepEqual(await response,{node:{cpu:0}});
  rpc2.pause();
  delete globalThis.window; delete globalThis.document; delete globalThis.WebSocket;
});
