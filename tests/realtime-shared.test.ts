import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from './helpers/config.ts';
import { Upstream, type Fetcher } from '../src/upstream/client.ts';
import { Bridge } from '../src/protocols/cfsm/service.ts';
import { KomariService } from '../src/protocols/komari/service.ts';
import { realtime, type Socket } from '../src/protocols/cfsm/realtime.ts';
import { komariRealtime } from '../src/protocols/komari/realtime.ts';

const now = Date.parse('2026-11-02T12:00:00Z');
const raw = {
  enabled: true, show_name: true, history_days: 7,
  servers: [{ name: 'Synthetic private name', online: true, cpu_pct: 23 }],
};
type Protocol = 'cfsm' | 'komari';
type Loss = 'close' | 'error' | 'handshake' | 'stale';
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

class MockSocket implements Socket {
  sent: unknown[] = [];
  closed = false;
  message?: (data: string) => void;
  closing?: () => void;
  error?: () => void;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.closing?.(); }
  onMessage(callback: (data: string) => void) { this.message = callback; }
  onClose(callback: () => void) { this.closing = callback; }
  onError(callback: () => void) { this.error = callback; }
  receive(value: unknown) { this.message?.(JSON.stringify(value)); }
}

/** Both actual protocol services share exactly one source/cache, as in runtime. */
function shared(fetcher: Fetcher) {
  const config = readConfig({
    MMWX_BASE_URL: 'https://synthetic.invalid',
    BRIDGE_BINDINGS: JSON.stringify([{ id: 'stable', match: { name: raw.servers[0]!.name } }]),
  });
  config.staleMs = 1000;
  config.cacheMs = 60_000;
  const upstream = new Upstream(config, fetcher);
  return { upstream, cfsm: new Bridge(config, upstream), komari: new KomariService(config, upstream) };
}
type Services = ReturnType<typeof shared>;

function open(services: Services, protocol: Protocol, loss?: Loss) {
  const client = new MockSocket(), source = new MockSocket();
  let rejectHandshake!: (error: Error) => void;
  const connect = loss === 'handshake'
    ? () => new Promise<Socket>((_resolve, reject) => { rejectHandshake = reject; })
    : async () => source;
  const stream = protocol === 'cfsm'
    ? realtime(services.cfsm, client, connect)
    : komariRealtime(services.komari, client, connect);
  if (protocol === 'cfsm') client.receive({ type: 'subscribe', scope: 'all', ids: [] });
  return { client, source, stream, failHandshake: () => rejectHandshake(new Error('synthetic handshake failure')) };
}

async function otherApi(services: Services, sourceProtocol: Protocol, history = false) {
  const path = sourceProtocol === 'cfsm'
    ? (history ? '/api/records/load?uuid=stable&hours=1' : '/api/nodes')
    : (history ? '/api/history/all?id=stable&hours=1' : '/api/servers');
  const request = new Request(`http://localhost${path}`);
  const response = await (sourceProtocol === 'cfsm' ? services.komari.api(request) : services.cfsm.api(request));
  assert.ok(response);
  return { status: response.status, body: await response.json() };
}

for (const protocol of ['cfsm', 'komari'] as const) {
  for (const loss of ['close', 'error', 'handshake', 'stale'] as const) {
    test(`${protocol} ${loss} preserves another protocol's pending HTTP and guarded history`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
      const pending: ((response: Response) => void)[] = [];
      let snapshots = 0, seriesReads = 0;
      const services = shared(async input => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('probe-series')) {
          seriesReads++;
          return Response.json({ success: true, bucket_sec: 300, series: { cpu_pct: [{ t: now / 1000, value: 23 }] } });
        }
        snapshots++;
        if (snapshots <= 2) return new Promise<Response>(resolve => { pending.push(resolve); });
        return Response.json(raw); // history's required post-read identity check
      });
      const connection = open(services, protocol, loss);
      t.after(() => connection.stream.close());
      await settle();
      const http = otherApi(services, protocol);
      const history = otherApi(services, protocol, true);
      assert.equal(pending.length, 2);
      if (loss === 'handshake') connection.failHandshake();
      else if (loss === 'error') connection.source.error?.();
      else if (loss === 'stale') t.mock.timers.tick(5000);
      else connection.source.close();
      await settle();
      assert.ok(loss === 'handshake' || connection.source.closed, 'the transport fault actually occurred');
      for (const complete of pending) complete(Response.json(raw));
      const [httpResult, historyResult] = await Promise.all([http, history]);
      assert.equal(httpResult.status, 200, JSON.stringify(httpResult.body));
      assert.equal(historyResult.status, 200, JSON.stringify(historyResult.body));
      const rows = protocol === 'cfsm' ? historyResult.body.data.records : historyResult.body;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].cpu, 23);
      assert.equal(snapshots, 3, 'history still performs both identity guards');
      assert.equal(seriesReads, 1);
    });

    test(`${protocol} ${loss} preserves another protocol's fresh shared snapshot`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
      let reads = 0;
      const services = shared(async () => { reads++; throw new Error('unexpected HTTP refresh'); });
      const cached = services.upstream.accept(raw);
      const connection = open(services, protocol, loss);
      t.after(() => connection.stream.close());
      await settle();
      if (loss === 'handshake') connection.failHandshake();
      else if (loss === 'error') connection.source.error?.();
      else if (loss === 'stale') t.mock.timers.tick(5000);
      else connection.source.close();
      await settle();
      const result = await otherApi(services, protocol);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(reads, 0, 'transport failure must not force unrelated viewers to refetch');
      assert.equal(await services.upstream.snapshot(), cached, 'preserve the original observation, not a fabricated refresh');
    });
  }

  test(`${protocol} visibility update wins over another protocol's older HTTP response`, async t => {
    let complete!: (response: Response) => void;
    const services = shared(() => new Promise<Response>(resolve => { complete = resolve; }));
    const connection = open(services, protocol);
    t.after(() => connection.stream.close());
    await settle();
    const pending = otherApi(services, protocol);
    connection.source.receive({ ...raw, show_name: false });
    complete(Response.json(raw));
    const result = await pending;
    assert.equal(result.status, 200);
    assert.equal(JSON.stringify(result.body).includes(raw.servers[0]!.name), false);
    assert.equal((await services.upstream.snapshot()).showName, false);
  });

  for (const failure of ['disabled', 'identity', 'invalid-json'] as const) {
    test(`${protocol} ${failure} prevents another protocol's late HTTP from resurrecting old state`, async t => {
      const pending: ((response: Response) => void)[] = [];
      let historyReads = 0;
      const services = shared(input => {
        if (new URL(String(input)).pathname.endsWith('probe-series')) historyReads++;
        return new Promise<Response>(resolve => { pending.push(resolve); });
      });
      const connection = open(services, protocol);
      t.after(() => connection.stream.close());
      await settle();
      const http = otherApi(services, protocol), history = otherApi(services, protocol, true);
      assert.equal(pending.length, 2);
      if (failure === 'invalid-json') connection.source.message?.('{invalid');
      else connection.source.receive(failure === 'disabled'
        ? { ...raw, enabled: false }
        : { ...raw, servers: [raw.servers[0], raw.servers[0]] });
      assert.equal(connection.source.closed, true);
      for (const complete of pending) complete(Response.json(raw));
      for (const result of await Promise.all([http, history])) {
        assert.equal(result.status, 503);
        assert.equal(result.body.code, 'UPSTREAM_SUPERSEDED');
        assert.equal(JSON.stringify(result.body).includes(raw.servers[0]!.name), false);
      }
      assert.equal(historyReads, 0, 'revoked identity must stop before querying an old positional history index');
    });
  }
}
