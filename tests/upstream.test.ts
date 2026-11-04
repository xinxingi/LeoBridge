import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from './helpers/config.ts';
import { Upstream, type Fetcher } from '../src/upstream/client.ts';
import { BridgeError } from '../src/core/errors.ts';

const config = () => readConfig({ MMWX_BASE_URL: 'https://upstream.example.test', MMWX_PROBE_TOKEN: 'synthetic-secret' });
const raw = { enabled: true, show_name: true, servers: [{ name: 'synthetic', online: true }] };
const hasCode = (code: string) => (error: unknown) => error instanceof BridgeError && error.code === code;

test('upstream uses only configured origin, puts token in headers, and rejects redirects', async () => {
  let seen: URL | undefined;
  let options: RequestInit | undefined;
  const client = new Upstream(config(), async (input, init) => {
    seen = new URL(String(input)); options = init;
    return Response.json(raw);
  });
  await client.json('/api/public/probe-series', { server: '0', metric: 'system', range: '1h' });
  assert.equal(seen?.origin, 'https://upstream.example.test');
  assert.equal(seen?.pathname, '/api/public/probe-series');
  assert.equal(seen?.searchParams.get('server'), '0');
  assert.equal(seen?.toString().includes('synthetic-secret'), false);
  assert.equal(new Headers(options?.headers).get('X-MMwx-Probe-Token'), 'synthetic-secret');
  assert.equal(options?.redirect, 'manual');
});

test('HTTP, transport, schema and disabled errors remain distinct without exposing body or secrets', async () => {
  for (const [fetcher, code] of [
    [async () => new Response('synthetic-secret at upstream.example.test', { status: 403 }), 'UPSTREAM_AUTH'],
    [async () => { throw new Error('synthetic-secret at upstream.example.test'); }, 'UPSTREAM_UNAVAILABLE'],
    [async () => new Response('synthetic-secret invalid json'), 'UPSTREAM_SCHEMA'],
    [async () => Response.json({ enabled: true, servers: [null] }), 'UPSTREAM_SCHEMA'],
    [async () => Response.json({ enabled: false, servers: [{ name: 'secret server' }] }), 'PROBE_DISABLED'],
  ] as [Fetcher, string][]) {
    const upstream = new Upstream(config(), fetcher);
    await assert.rejects(upstream.snapshot(), error => {
      assert.ok(hasCode(code)(error));
      const text = String(error);
      assert.equal(text.includes('synthetic-secret'), false);
      assert.equal(text.includes('upstream.example.test'), false);
      assert.equal(text.includes('secret server'), false);
      return true;
    });
  }
});

test('timeout aborts fetch and is reported separately from unavailable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  const upstream = new Upstream({ ...config(), timeoutMs: 50 }, async (_input, init) => {
    signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  const request = upstream.snapshot();
  const result = assert.rejects(request, error => {
    assert.ok(hasCode('UPSTREAM_TIMEOUT')(error));
    assert.equal((error as BridgeError).status, 504);
    return true;
  });
  t.mock.timers.tick(51);
  await result;
  assert.equal(signal?.aborted, true);
});

test('source access errors give actionable guidance without claiming every 404 means an expired token',async()=>{
  for(const status of [401,403,404,500]){
    const upstream=new Upstream(config(),async()=>new Response('synthetic-secret',{status}));
    await assert.rejects(upstream.snapshot(),error=>{
      assert.ok(error instanceof BridgeError);
      assert.equal(error.status,502);
      assert.equal(error.code,status===404?'UPSTREAM_NOT_FOUND':status===500?'UPSTREAM_HTTP':'UPSTREAM_AUTH');
      assert.doesNotMatch(error.message,/synthetic-secret/);
      if(status!==500)assert.match(error.message,/Token 可能已失效.*设置 → 数据源/);
      if(status===404)assert.match(error.message,/主控地址.*独立探针接口/);
      return true;
    });
  }
});

test('native connect, headers, body and socket timeouts become sanitized 504 responses before the bridge deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT']) {
    let signal: AbortSignal | null | undefined;
    const upstream = new Upstream({ ...config(), timeoutMs: 30_000 }, async (_input, init) => {
      signal = init?.signal;
      throw new TypeError('synthetic-secret fetch failed', { cause: { code, message: 'upstream.example.test' } });
    });
    await assert.rejects(upstream.snapshot(), error => {
      assert.ok(error instanceof BridgeError);
      assert.equal(error.code, 'UPSTREAM_TIMEOUT');
      assert.equal(error.status, 504);
      assert.equal(String(error).includes('synthetic-secret'), false);
      assert.equal(String(error).includes('upstream.example.test'), false);
      return true;
    });
    t.mock.timers.tick(30_001);
    assert.equal(signal?.aborted, false, 'native failure should clear the bridge timer');
  }
  const refused = new Upstream(config(), async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  });
  await assert.rejects(refused.snapshot(), error => {
    assert.ok(error instanceof BridgeError);
    assert.equal(error.code, 'UPSTREAM_UNAVAILABLE');
    assert.equal(error.status, 502);
    return true;
  });
});

test('successful requests clear timeout; concurrent reads coalesce and expired data is not served after failure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 100_000;
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  let fail = false;
  const upstream = new Upstream({ ...config(), cacheMs: 100, timeoutMs: 50 }, async (_input, init) => {
    calls++; signal = init?.signal;
    if (fail) throw new Error('offline upstream');
    return Response.json(raw);
  }, () => now);
  const [first, second] = await Promise.all([upstream.snapshot(), upstream.snapshot()]);
  assert.equal(first, second);
  assert.equal(calls, 1);
  t.mock.timers.tick(60);
  assert.equal(signal?.aborted, false);
  await upstream.snapshot();
  assert.equal(calls, 1);
  now += 101; fail = true;
  await assert.rejects(upstream.snapshot(), hasCode('UPSTREAM_UNAVAILABLE'));
  fail = false;
  await upstream.snapshot();
  assert.equal(calls, 4);
  await upstream.snapshot(true);
  assert.equal(calls, 5);
  upstream.invalidate();
  await upstream.snapshot();
  assert.equal(calls, 6);
});

test('invalid WebSocket snapshots cannot silently replace valid cache and disabled probes invalidate it', async () => {
  let calls = 0;
  const upstream = new Upstream(config(), async () => { calls++; return Response.json(raw); });
  upstream.accept(raw);
  assert.throws(() => upstream.accept({ enabled: true, servers: 'invalid' }), hasCode('UPSTREAM_SCHEMA'));
  assert.throws(() => upstream.accept({ enabled: false }), hasCode('PROBE_DISABLED'));
  await upstream.snapshot();
  assert.equal(calls, 1);
});

test('late HTTP snapshots cannot restore a name or server removed by a newer source update', async () => {
  for (const fresh of [false, true]) for (const newer of [{ ...raw, show_name: false }, { ...raw, servers: [] }]) {
    let time = 100_000;
    let complete!: (response: Response) => void;
    const upstream = new Upstream(config(), () => new Promise(resolve => { complete = resolve; }), () => time);
    const pending = upstream.snapshot(fresh);
    time += 100;
    const accepted = upstream.accept(newer);
    time += 100;
    complete(Response.json(raw));
    assert.equal(await pending, accepted);
    const cached = await upstream.snapshot();
    assert.equal(cached, accepted);
    assert.equal(cached.observedAt, 100_100, 'a discarded HTTP response must not restamp the newer snapshot');
    assert.equal(cached.showName, newer.show_name);
    assert.equal(cached.servers.length, newer.servers.length);
  }
});

test('disabled or invalidated source state rejects late HTTP and never repopulates the cache', async () => {
  for (const disable of [false, true]) {
    let complete!: (response: Response) => void;
    let reads = 0;
    const upstream = new Upstream(config(), () => {
      reads++;
      return new Promise(resolve => { complete = resolve; });
    });
    const pending = upstream.snapshot();
    if (disable) assert.throws(() => upstream.accept({ enabled: false }), hasCode('PROBE_DISABLED'));
    else upstream.invalidate();
    complete(Response.json(raw));
    await assert.rejects(pending, error => {
      assert.ok(hasCode('UPSTREAM_SUPERSEDED')(error));
      assert.equal((error as BridgeError).status, 503);
      return true;
    });
    const retry = upstream.snapshot();
    assert.equal(reads, 2, 'no stale snapshot may satisfy the next request');
    complete(Response.json({ ...raw, show_name: false }));
    assert.equal((await retry).showName, false);
  }
});

test('manual redirect responses are refused without following Location or exposing credentials', async () => {
  const seen: string[] = [];
  const upstream = new Upstream(config(), async (input, init) => {
    seen.push(String(input));
    assert.equal(init?.redirect, 'manual');
    return new Response('synthetic-secret redirect body', { status: 302, headers: { Location: 'https://other.invalid/' } });
  });
  await assert.rejects(upstream.snapshot(), error => {
    assert.ok(hasCode('UPSTREAM_HTTP')(error));
    assert.equal((error as BridgeError).status, 502);
    assert.equal(String(error).includes('synthetic-secret'), false);
    assert.equal(String(error).includes('other.invalid'), false);
    return true;
  });
  assert.deepEqual(seen, ['https://upstream.example.test/api/public/probe-servers']);
});

test('a transport failure before headers retries once inside the existing deadline; HTTP rejection never retries', async () => {
  const cfg = readConfig({ MMWX_BASE_URL:'https://upstream.example.test' });
  let calls=0;
  const client=new Upstream(cfg,async()=>{calls++;if(calls===1)throw new TypeError('synthetic connection reset');return Response.json({enabled:true,servers:[]});});
  assert.equal((await client.snapshot()).servers.length,0);
  assert.equal(calls,2);
  calls=0;
  await assert.rejects(new Upstream(cfg,async()=>{calls++;return new Response('denied',{status:404});}).snapshot(),error=>(error as {status?:number}).status===502);
  assert.equal(calls,1);
});
