import test from 'node:test';
import assert from 'node:assert/strict';
import { realtime, type Socket } from '../src/protocols/cfsm/realtime.ts';
import { readConfig } from './helpers/config.ts';
import { Upstream, type Fetcher } from '../src/upstream/client.ts';
import { resolveBindings } from '../src/core/identity.ts';
import { toServer } from '../src/protocols/cfsm/adapter.ts';
import type { Snapshot } from '../src/core/model.ts';
import type { Bridge } from '../src/protocols/cfsm/service.ts';

class MockSocket implements Socket {
  sent: Record<string, unknown>[] = [];
  closed: { code?: number; reason?: string }[] = [];
  message?: (data: string) => void;
  closing?: () => void;
  error?: () => void;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code?: number, reason?: string) { this.closed.push({ code, reason }); this.closing?.(); }
  onMessage(callback: (data: string) => void) { this.message = callback; }
  onClose(callback: () => void) { this.closing = callback; }
  onError(callback: () => void) { this.error = callback; }
  receive(data: unknown) { this.message?.(JSON.stringify(data)); }
}

const bindings = [{ id: 'opaque-a', match: { name: 'A' } }, { id: 'opaque-b', match: { name: 'B' } }];
const snapshot = { enabled: true, show_name: true, servers: [{ name: 'A', online: true, cpu_pct: 0 }, { name: 'B', online: false }] };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function bridge(fetcher: Fetcher = async () => Response.json(snapshot)) {
  const config = readConfig({ MMWX_BASE_URL: 'https://upstream.example.test', MMWX_PROBE_TOKEN: 'synthetic-secret', BRIDGE_BINDINGS: JSON.stringify(bindings) });
  const upstream = new Upstream(config, fetcher);
  return {
    config, upstream,
    servers: (source: Snapshot) => resolveBindings(source, config.bindings).map(({ raw, id }) => toServer(raw, id, source.observedAt, source.showName)),
  } as unknown as Bridge;
}

test('subscription protocol filters samples, preserves explicit offline/zero, and answers ping', async t => {
  const client = new MockSocket(), source = new MockSocket();
  let calls = 0;
  const stream = realtime(bridge(), client, async () => { calls++; return source; });
  t.after(() => stream.close());
  assert.equal(client.sent[0]?.type, 'hello');
  assert.equal(calls, 0);
  client.receive({ type: 'subscribe', scope: 'all', ids: ['opaque-a'] });
  await flush();
  source.receive(snapshot);
  assert.equal(calls, 1);
  const batch = client.sent.find(message => message.type === 'batchUpdate') as { updates: { serverId: string; samples: { data: Record<string, unknown> }[] }[] } | undefined;
  assert.equal(batch?.updates.length, 1);
  assert.equal(batch?.updates[0]?.serverId, 'opaque-a');
  assert.equal(batch?.updates[0]?.samples[0]?.data.cpu, 0);
  assert.equal(batch?.updates[0]?.samples[0]?.data.online, true);
  client.receive({ type: 'ping' });
  assert.equal(client.sent.at(-1)?.type, 'pong');
  assert.equal(JSON.stringify(client.sent).includes('synthetic-secret'), false);
});

test('upstream disconnect reports unavailable, never server-offline samples, then reconnects and resumes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const client = new MockSocket(), first = new MockSocket(), second = new MockSocket();
  let calls = 0;
  const stream = realtime(bridge(), client, async () => ++calls === 1 ? first : second);
  t.after(() => stream.close());
  client.receive({ type: 'subscribe', scope: 'all', ids: [] });
  await flush(); first.receive(snapshot);
  const batchesBefore = client.sent.filter(message => message.type === 'batchUpdate').length;
  first.close();
  assert.equal(client.sent.at(-1)?.status, 'unavailable');
  assert.equal(client.sent.filter(message => message.type === 'batchUpdate').length, batchesBefore);
  t.mock.timers.tick(1001); await flush();
  assert.equal(calls, 2);
  first.receive(snapshot); // messages arriving from the old connection are ignored
  assert.equal(client.sent.filter(message => message.type === 'batchUpdate').length, batchesBefore);
  second.receive(snapshot);
  assert.equal(client.sent.filter(message => message.type === 'batchUpdate').length, batchesBefore + 1);
  stream.close();
  const afterClose = client.sent.length;
  t.mock.timers.tick(100_000); await flush();
  assert.equal(calls, 2);
  assert.equal(client.sent.length, afterClose);
  assert.ok(second.closed.length > 0);
});

test('stale upstream data triggers an explicit stale status and closes the stalled connection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const client = new MockSocket(), source = new MockSocket();
  const stream = realtime(bridge(), client, async () => source);
  t.after(() => stream.close());
  client.receive({ type: 'subscribe', scope: 'opaque-b', ids: [] });
  await flush(); source.receive(snapshot);
  t.mock.timers.tick(50_001);
  assert.ok(client.sent.some(message => message.type === 'bridgeStatus' && message.status === 'stale'));
  assert.ok(source.closed.length > 0);
  const batches = client.sent.filter(message => message.type === 'batchUpdate');
  assert.equal(batches.length, 1);
  const updates = batches[0]?.updates as { samples: { data: Record<string, unknown> }[] }[];
  assert.equal(updates[0]?.samples[0]?.data.online, false);
});

test('closing viewer during a pending handshake closes late upstream and cancels all retry work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const client = new MockSocket(), source = new MockSocket();
  let complete!: (socket: Socket) => void;
  let calls = 0;
  const stream = realtime(bridge(), client, () => { calls++; return new Promise(resolve => { complete = resolve; }); });
  client.receive({ type: 'subscribe', scope: 'all', ids: [] });
  stream.close();
  complete(source); await flush();
  assert.deepEqual(source.closed, [{ code: 1000, reason: 'cancelled' }]);
  t.mock.timers.tick(1_000_000); await flush();
  assert.equal(calls, 1);
});

test('identity ambiguity in a pushed snapshot emits no samples and enters unavailable state', async t => {
  const client = new MockSocket(), source = new MockSocket();
  const stream = realtime(bridge(), client, async () => source);
  t.after(() => stream.close());
  client.receive({ type: 'subscribe', scope: 'all', ids: [] }); await flush();
  source.receive({ ...snapshot, servers: [{ name: 'A', online: true }, { name: 'A', online: true }] });
  assert.equal(client.sent.some(message => message.type === 'batchUpdate'), false);
  assert.ok(client.sent.some(message => message.type === 'bridgeStatus' && message.code === 'IDENTITY_CONFLICT'));
  assert.ok(source.closed.length > 0);
});

test('missing subscription and invalid messages are bounded and cleaned up', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const input of [null, [], {}, { type: 'subscribe', scope: 'missing', ids: [] }, { type: 'subscribe', scope: 'all', ids: ['missing'] }]) {
    const client = new MockSocket();
    let calls = 0;
    const stream = realtime(bridge(), client, async () => { calls++; return new MockSocket(); });
    assert.doesNotThrow(() => client.receive(input));
    assert.equal(client.closed.at(-1)?.code, 1008);
    assert.equal(calls, 0);
    stream.close();
  }
  const client = new MockSocket();
  const stream = realtime(bridge(), client, async () => new MockSocket());
  t.mock.timers.tick(10_001);
  assert.equal(client.closed.at(-1)?.code, 1008);
  stream.close();
});

test('invalid upstream JSON and disabled probes never produce success samples and close their source', async t => {
  for (const data of ['{invalid JSON synthetic-secret', JSON.stringify({ enabled: false })]) {
    const client = new MockSocket(), source = new MockSocket();
    const stream = realtime(bridge(), client, async () => source);
    t.after(() => stream.close());
    client.receive({ type: 'subscribe', scope: 'all', ids: [] }); await flush();
    assert.doesNotThrow(() => source.message?.(data));
    assert.equal(client.sent.some(message => message.type === 'batchUpdate'), false);
    assert.equal(client.sent.at(-1)?.status, 'unavailable');
    if (data.includes('enabled')) assert.ok(client.sent.some(message => message.code === 'PROBE_DISABLED'));
    assert.ok(source.closed.length > 0);
    assert.equal(JSON.stringify(client.sent).includes('synthetic-secret'), false);
    stream.close();
  }
});

test('failed handshakes retry with backoff and viewer closure cancels the next retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const client = new MockSocket();
  let calls = 0;
  const stream = realtime(bridge(), client, async () => { calls++; throw new Error('synthetic-secret transport failure'); });
  client.receive({ type: 'subscribe', scope: 'all', ids: [] }); await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(999); await flush(); assert.equal(calls, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(calls, 2);
  t.mock.timers.tick(1999); await flush(); assert.equal(calls, 2);
  stream.close();
  t.mock.timers.tick(100_000); await flush(); assert.equal(calls, 2);
  assert.equal(JSON.stringify(client.sent).includes('synthetic-secret'), false);
});

test('silent upstream falls back after 15 seconds with fresh HTTP samples and stops polling when WS resumes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  let reads = 0;
  const instance = bridge(async () => { reads++; return Response.json(snapshot); });
  const client = new MockSocket(), source = new MockSocket();
  const stream = realtime(instance, client, async () => source);
  t.after(() => stream.close());
  client.receive({ type: 'subscribe', scope: 'all', ids: [] }); await flush();
  t.mock.timers.tick(14_999); await settle();
  assert.equal(reads, 0);
  t.mock.timers.tick(1); await settle();
  assert.equal(reads, 1);
  const first = client.sent.find(message => message.type === 'batchUpdate');
  assert.equal(first?.transport, 'poll');
  assert.equal(first?.ts, 115_000);
  const updates = first?.updates as { samples: { ts: number; data: Record<string, unknown> }[] }[];
  assert.equal(updates[0]?.samples[0]?.ts, 115_000);
  assert.equal(updates[0]?.samples[0]?.data.observed_at, 115_000);
  assert.equal(updates[1]?.samples[0]?.data.online, false);
  assert.ok(client.sent.some(message => message.type === 'bridgeStatus' && message.status === 'ok' && message.transport === 'poll'));
  t.mock.timers.tick(5000); await settle();
  assert.equal(reads, 2);
  t.mock.timers.tick(1); source.receive(snapshot);
  assert.equal(client.sent.at(-1)?.transport, 'websocket');
  assert.equal(client.sent.at(-1)?.ts, 120_001);
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(10_000); source.receive(snapshot); await settle();
    assert.equal(reads, 2);
  }
  assert.equal(JSON.stringify(client.sent).includes('synthetic-secret'), false);
});

test('HTTP fallback never replays a cached snapshot or relabels its observation time', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  let reads = 0;
  const instance = bridge(async () => { reads++; return Response.json(snapshot); });
  instance.config.cacheMs = 60_000;
  const client = new MockSocket(), source = new MockSocket();
  const stream = realtime(instance, client, async () => source);
  t.after(() => stream.close());
  client.receive({ type: 'subscribe', scope: 'all', ids: [] }); await flush();
  source.receive(snapshot);
  t.mock.timers.tick(15_000); await settle();
  t.mock.timers.tick(5000); await settle();
  assert.equal(reads, 0);
  const batches = client.sent.filter(message => message.type === 'batchUpdate');
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.ts, 100_000);
  assert.equal(batches[0]?.transport, 'websocket');
  assert.equal((await instance.upstream.snapshot()).observedAt, 100_000);
});

test('simultaneous fallback viewers share one pending upstream HTTP read', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  let reads = 0;
  let complete!: (response: Response) => void;
  const instance = bridge(() => { reads++; return new Promise(resolve => { complete = resolve; }); });
  const clients = [new MockSocket(), new MockSocket()];
  const streams = clients.map(client => realtime(instance, client, async () => new MockSocket()));
  t.after(() => streams.forEach(stream => stream.close()));
  clients.forEach(client => client.receive({ type: 'subscribe', scope: 'all', ids: [] })); await flush();
  t.mock.timers.tick(15_000); await flush();
  assert.equal(reads, 1);
  // A second watchdog tick cannot start another request while the first is pending.
  t.mock.timers.tick(5000); await flush(); assert.equal(reads, 1);
  complete(Response.json(snapshot)); await settle();
  for (const client of clients) {
    const batches = client.sent.filter(message => message.type === 'batchUpdate');
    assert.equal(batches.length, 1);
    assert.equal(batches[0]?.transport, 'poll');
    assert.equal(batches[0]?.ts, 120_000);
  }
});

test('closing a viewer suppresses both success and error from an outstanding fallback request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  for (const fail of [false, true]) {
    let complete!: (response: Response) => void;
    let reject!: (error: Error) => void;
    const instance = bridge(() => new Promise((resolve, rejectRequest) => { complete = resolve; reject = rejectRequest; }));
    const client = new MockSocket();
    const stream = realtime(instance, client, async () => new MockSocket());
    client.receive({ type: 'subscribe', scope: 'all', ids: [] }); await flush();
    t.mock.timers.tick(15_000); await flush();
    stream.close();
    const count = client.sent.length;
    if (fail) reject(new Error('synthetic-secret late HTTP error'));
    else complete(Response.json(snapshot));
    await settle();
    assert.equal(client.sent.length, count);
    assert.equal(client.sent.some(message => message.type === 'batchUpdate'), false);
  }
});

test('a WebSocket recovery supersedes a pending HTTP result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  let complete!: (response: Response) => void;
  const instance = bridge(() => new Promise(resolve => { complete = resolve; }));
  const client = new MockSocket(), source = new MockSocket();
  const stream = realtime(instance, client, async () => source);
  t.after(() => stream.close());
  client.receive({ type: 'subscribe', scope: 'all', ids: [] }); await flush();
  t.mock.timers.tick(15_000); await flush();
  t.mock.timers.tick(1); source.receive(snapshot);
  complete(Response.json({ ...snapshot, servers: snapshot.servers.map(server => ({ ...server, cpu_pct: 99 })) }));
  await settle();
  const batches = client.sent.filter(message => message.type === 'batchUpdate');
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.transport, 'websocket');
  const updates = batches[0]?.updates as { samples: { data: Record<string, unknown> }[] }[];
  assert.equal(updates[0]?.samples[0]?.data.cpu, 0);
});

test('fallback failures and identity ambiguity stay unavailable without publishing false offline or leaking secrets', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  for (const [fetcher, expectedCode] of [
    [async () => { throw new Error('synthetic-secret https://upstream.example.test'); }, 'UPSTREAM_UNAVAILABLE'],
    [async () => Response.json({ ...snapshot, servers: [{ name: 'A' }, { name: 'A' }] }), 'IDENTITY_CONFLICT'],
    [async () => Response.json({ enabled: false }), 'PROBE_DISABLED'],
  ] as [Fetcher, string][]) {
    const instance = bridge(fetcher), client = new MockSocket();
    const stream = realtime(instance, client, async () => new MockSocket());
    client.receive({ type: 'subscribe', scope: 'all', ids: [] }); await flush();
    t.mock.timers.tick(15_000); await settle();
    assert.equal(client.sent.some(message => message.type === 'batchUpdate'), false);
    assert.ok(client.sent.some(message => message.type === 'bridgeStatus' && message.status === 'unavailable' && message.code === expectedCode));
    assert.equal(JSON.stringify(client.sent).includes('synthetic-secret'), false);
    assert.equal(JSON.stringify(client.sent).includes('upstream.example.test'), false);
    stream.close();
  }
});
