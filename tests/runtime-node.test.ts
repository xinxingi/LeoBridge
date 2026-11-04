import { emptyThemeState } from '../src/themes/store.ts';
import { hashPassword } from '../src/management/password.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import type { Installation } from '../src/themes/store.ts';

const root = resolve(import.meta.dirname, '..');
const cfsmId = 'a'.repeat(32), komariId = 'b'.repeat(32);
const adminHost = 'admin.example.test', displayHost = 'monitor.example.test';
const cfsmHost = `t-${cfsmId}.themes.example.test`, komariHost = `t-${komariId}.themes.example.test`;
const password = 'synthetic-node-runtime-password';
async function listen(server: Server): Promise<number> {
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); accept(); }); });
  const address = server.address(); assert.ok(address && typeof address !== 'string'); return address.port;
}
async function close(server: Server) {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
}
async function until(check: () => boolean | Promise<boolean>, message: string, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() >= deadline) assert.fail(message);
    await delay(20);
  }
}
type Reply = { status: number; headers: import('node:http').IncomingHttpHeaders; text: string; json: any };
function request(port: number, host: string, path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; forwarded?: string | null } = {}): Promise<Reply> {
  return new Promise((accept, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET', agent: false,
      headers: { Host: host, ...(options.forwarded === null ? {} : { 'X-Forwarded-Proto': options.forwarded ?? 'https' }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }), ...options.headers } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString(); let json: unknown;
        try { json = JSON.parse(text); } catch { /* static asset or empty redirect */ }
        accept({ status: response.statusCode!, headers: response.headers, text, json });
      });
    });
    req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('local request timeout'))); req.end(body);
  });
}

test('Node proxy subprocess: isolated origins, both native protocols, persisted activation and bounded shutdown (synthetic only)', { timeout: 45_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leobridge-node-runtime-'));
  const assets = join(directory, 'bundled'), store = join(directory, 'store'), envFile = join(directory, 'runtime.env');
  const children: ChildProcess[] = [], downstream = new Set<WebSocket>();
  const sourceWs = new WebSocketServer({ noServer: true });
  const historyRequests: URL[] = [];
  const snapshot = JSON.parse(await readFile(join(root, 'docs/fixtures/snapshot-basic.json'), 'utf8'));
  snapshot.history_days = 7;
  const sampleTime = Math.floor(Date.now() / 300_000) * 300;
  // Real HTTP responses from a local synthetic source; no upstream histories are read.
  const systemFixture = { success: true, bucket_sec: 300, series: {
    cpu_pct: [{ t: sampleTime - 300, value: 0 }, { t: sampleTime, value: 12.5 }],
    mem_used: [{ t: sampleTime, value: 1073741824 }],
  } };
  let rejectedSourceAuth = 0, sourceFrames = 0;
  const upstream = createServer((req, res) => {
    if (req.headers['x-mmwx-probe-token'] !== 'synthetic-probe-token') { rejectedSourceAuth++; res.writeHead(401); res.end(); return; }
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/public/probe-servers') res.end(JSON.stringify(snapshot));
    else if (url.pathname === '/api/public/probe-series') { historyRequests.push(url); res.end(JSON.stringify(systemFixture)); }
    else { res.writeHead(404); res.end('{}'); }
  });
  upstream.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/public/probe-ws' || req.headers['x-mmwx-probe-token'] !== 'synthetic-probe-token') {
      rejectedSourceAuth++; socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
    }
    sourceWs.handleUpgrade(req, socket, head, ws => sourceWs.emit('connection', ws));
  });
  sourceWs.on('connection', socket => {
    const timer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const frame = structuredClone(snapshot); frame.servers[0].cpu_pct = ++sourceFrames % 100;
      socket.send(JSON.stringify(frame));
    }, 60);
    socket.once('close', () => clearInterval(timer));
  });
  t.after(async () => {
    for (const socket of downstream) socket.terminate();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(accept => child.once('exit', () => accept()))));
    for (const socket of sourceWs.clients) socket.terminate();
    await new Promise<void>(accept => sourceWs.close(() => accept()));
    await close(upstream); await rm(directory, { recursive: true, force: true });
  });
  const upstreamPort = await listen(upstream);
  const reservation = createServer(); const port = await listen(reservation); await close(reservation);
  await mkdir(assets, { recursive: true });
  const definitions: Installation[] = [];
  for (const [id, ecosystem, protocolProfile] of [[cfsmId, 'cfsm', 'cfsm-609cc0b'], [komariId, 'komari', 'komari-adhesive-v1']] as const) {
    const files = { 'index.html': `<html><body>Synthetic ${ecosystem} runtime fixture</body></html>`, 'app.js': `globalThis.syntheticTheme=${JSON.stringify(ecosystem)};` };
    await mkdir(join(assets, id));
    for (const [path, bytes] of Object.entries(files)) await writeFile(join(assets, id, path), bytes);
    definitions.push({ id, title: `Synthetic ${ecosystem}`, ecosystem, protocolProfile, source: 'local synthetic test fixture', pinnedVersion: 'synthetic-1',
      license: { spdx: 'MIT', text: 'Synthetic fixture', source: 'test', sha256: '0'.repeat(64) }, entry: 'index.html', installedAt: new Date().toISOString(),
      compatibility: 'verified', bundled: true, files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, { size: Buffer.byteLength(bytes), contentType: path.endsWith('.html') ? 'text/html' : 'text/javascript' }])) });
  }
  await writeFile(join(assets, 'index.json'), JSON.stringify(definitions));
  await mkdir(join(assets, '_management')); await writeFile(join(assets, '_management/index.html'), '<html>Synthetic admin fixture</html>');
  const configuration = {
    BRIDGE_NODE_MODE: 'proxy', BRIDGE_LISTEN_HOST: '127.0.0.1', BRIDGE_LISTEN_PORT: String(port), BRIDGE_ACCESS: 'public',
    BRIDGE_ADMIN_ORIGIN: `https://${adminHost}`, BRIDGE_DISPLAY_ORIGIN: `https://${displayHost}`, BRIDGE_DISPLAY_DOMAIN: 'themes.example.test',
    BRIDGE_PREVIEW_ORIGIN: 'https://preview.example.test', BRIDGE_ASSETS_DIR: assets, BRIDGE_THEME_STORE: store,
  };
  await mkdir(store,{recursive:true});
  await writeFile(join(store,'state.json'),JSON.stringify({...emptyThemeState(),adminCredential:await hashPassword(password,1),source:{version:1,baseUrl:`http://127.0.0.1:${upstreamPort}`,token:'synthetic-probe-token',bindings:snapshot.servers.map((server:{name:string})=>({id:server.name,match:{name:server.name}})),pingTargets:{}}}),{mode:0o600});
  await writeFile(envFile, Object.entries(configuration).map(([key, value]) => `${key}='${value}'`).join('\n'), { mode: 0o600 });
  async function launch(overrides:Record<string,string>={}) {
    // Whitelist the child environment: no inherited .dev.vars or network proxy settings.
    const entry = process.env.BRIDGE_TEST_BUILT_NODE === '1' ? ['dist/node.js'] : ['--import', 'tsx', 'src/runtime/node.ts'];
    const child = spawn(process.execPath, entry, {
      cwd: root, env: { BRIDGE_ENV_FILE: envFile, BRIDGE_NODE_MODE: 'proxy', NODE_NO_WARNINGS: '1', ...overrides }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child); let output = '', exited = false;
    child.stdout.on('data', data => { output = (output + data.toString()).slice(-12_000); });
    child.stderr.on('data', data => { output = (output + data.toString()).slice(-12_000); });
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
      child.once('error', reject); child.once('exit', (code, signal) => { exited = true; accept({ code, signal }); });
    });
    await until(async () => {
      assert.equal(exited, false, `Node exited before readiness: ${output}`);
      try { return (await request(port, 'localhost', '/healthz', { forwarded: null })).status === 200; } catch { return false; }
    }, 'Node did not become ready');
    return { child, exit, logs: () => output };
  }
  async function stop(process: Awaited<ReturnType<typeof launch>>) {
    const start = Date.now(); process.child.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_accept, reject) => { timer = setTimeout(() => reject(new Error('Node did not drain within 7 seconds')), 7000); });
    const result = await Promise.race([process.exit, deadline]).finally(() => clearTimeout(timer));
    assert.deepEqual(result, { code: 0, signal: null }, process.logs());
    assert.ok(Date.now() - start < 7000);
    await until(() => sourceWs.clients.size === 0, 'upstream WebSockets leaked after shutdown');
  }
  const rejected=await launch({BRIDGE_TRUSTED_PROXIES:'192.0.2.1/32'});
  for(let i=0;i<2;i++)assert.equal((await request(port,displayHost,'/?synthetic-secret-path',{headers:{Cookie:'synthetic-secret-cookie','X-Real-IP':'198.51.100.42'}})).json.code,'UNTRUSTED_PROXY');
  await stop(rejected);
  assert.equal(rejected.logs().split('UNTRUSTED_PROXY:').length-1,1);
  assert.match(rejected.logs(),/peer=127\.0\.0\.1/);
  assert.doesNotMatch(rejected.logs(),/synthetic-secret|198\.51\.100\.42|synthetic-probe-token/);
  let running = await launch();
  assert.equal((await request(port, displayHost, '/', { forwarded: null })).status, 400);
  assert.equal((await request(port, displayHost, '/', { forwarded: 'http' })).status, 400);
  assert.equal((await request(port, 'unknown.example.test', '/')).status, 421);
  for (const [host, forwarded] of [[cfsmHost, null], [cfsmHost, 'http'], ['unknown.example.test', 'https']] as const) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, { headers: { Host: host, Origin: `https://${host}`, ...(forwarded ? { 'X-Forwarded-Proto': forwarded } : {}) }, handshakeTimeout: 3000 });
    downstream.add(socket);
    const status = await new Promise<number>((accept, reject) => {
      socket.once('open', () => reject(new Error('untrusted WebSocket upgrade accepted')));
      socket.once('unexpected-response', (_request, response) => { response.resume(); accept(response.statusCode!); socket.terminate(); });
      socket.on('error', error => { if (socket.readyState !== WebSocket.CLOSING) reject(error); });
    });
    assert.equal(status, 403, 'upgrade uses the same trusted-TLS and Host policy');
  }
  let response = await request(port, displayHost, '/?retained=1');
  assert.equal(response.status, 307); assert.equal(response.headers.location, `https://${cfsmHost}/?retained=1`);
  response = await request(port, cfsmHost, '/'); assert.match(response.text, /Synthetic cfsm runtime fixture/);
  response = await request(port, cfsmHost, '/app.js'); assert.match(response.text, /"cfsm"/);
  response = await request(port, `p-${cfsmId}.preview.example.test`, '/__bridge/version');
  assert.equal(response.status, 200); assert.equal(response.json.preview, true); assert.equal(response.json.id, cfsmId);
  assert.equal((await request(port, cfsmHost, '/manage/api/state')).status, 404);
  assert.equal((await request(port, adminHost, '/manage/api/state')).status, 401);
  const adminHeaders = { Origin: `https://${adminHost}` };
  response = await request(port, adminHost, '/manage/api/login', { method: 'POST', headers: adminHeaders, body: { username: 'admin', password } });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.mustChangePassword,false);
  const initialSession={...adminHeaders,Cookie:response.headers['set-cookie']![0]!.split(';')[0]!, 'X-CSRF-Token':response.json.csrf};
  assert.equal((await request(port,adminHost,'/manage/api/state',{headers:initialSession})).status,200);
  const newPassword='Runtime-fixture-New-2026!';
  response=await request(port,adminHost,'/manage/api/password',{method:'POST',headers:initialSession,body:{currentPassword:password,newPassword,confirmPassword:newPassword}});
  assert.equal(response.status,200,response.text);
  assert.equal((await request(port,adminHost,'/manage/api/session',{headers:initialSession})).status,401);
  response=await request(port,adminHost,'/manage/api/login',{method:'POST',headers:adminHeaders,body:{username:'admin',password:newPassword}});
  assert.equal(response.status,200,response.text);assert.equal(response.json.mustChangePassword,false);
  const setCookie = response.headers['set-cookie']![0]!;
  assert.match(setCookie, /^__Host-leobridge_admin=/); assert.match(setCookie, /; Secure/); assert.match(setCookie, /; HttpOnly/); assert.doesNotMatch(setCookie, /Domain=/i);
  const session = { ...adminHeaders, Cookie: setCookie.split(';')[0]!, 'X-CSRF-Token': response.json.csrf };
  const state = await request(port, adminHost, '/manage/api/state', { headers: session });
  assert.equal(state.json.active, cfsmId); assert.equal(Object.keys(state.json.installations).length, 2); assert.equal(state.json.sessions, undefined);
  response = await request(port, cfsmHost, '/api/history/all?id=fixture-online&hours=1');
  assert.equal(response.status, 200, response.text);
  assert.deepEqual(response.json.map((row: { timestamp: number; cpu: number }) => [row.timestamp, row.cpu]), [[(sampleTime - 300) * 1000, 0], [sampleTime * 1000, 12.5]]);
  assert.equal(response.json[1].ram_used, 1024);
  assert.equal(historyRequests.length, 1); assert.equal(historyRequests[0]!.searchParams.get('server'), '0');
  assert.equal(historyRequests[0]!.searchParams.get('metric'), 'system'); assert.equal(historyRequests[0]!.searchParams.get('range'), '1h');

  async function openSocket(host: string, path: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { Host: host, Origin: `https://${host}`, 'X-Forwarded-Proto': 'https' }, handshakeTimeout: 3000 });
    downstream.add(socket); const messages: any[] = []; const errors: Error[] = [];
    socket.on('message', data => messages.push(JSON.parse(data.toString()))); socket.on('error', error => errors.push(error));
    await new Promise<void>((accept, reject) => { socket.once('open', accept); socket.once('error', reject); });
    return { socket, messages, errors };
  }
  const cfsm = await openSocket(cfsmHost, '/api/ws');
  cfsm.socket.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids: ['fixture-online'] }));
  await until(() => cfsm.messages.filter(message => message.type === 'batchUpdate' && message.transport === 'websocket').length >= 2, 'CFSM native updates missing');
  const batches = cfsm.messages.filter(message => message.type === 'batchUpdate');
  assert.notEqual(batches[0].updates[0].samples[0].data.cpu, batches[1].updates[0].samples[0].data.cpu);
  response = await request(port, adminHost, '/manage/api/activate', { method: 'POST', headers: session, body: { id: komariId, generation: state.json.generation } });
  assert.equal(response.status, 200, response.text); const generation = response.json.generation;
  assert.equal((await request(port, displayHost, '/')).headers.location, `https://${komariHost}/`);
  assert.equal((await request(port, cfsmHost, '/api/servers')).json.servers.length, 3, 'old version keeps CFSM protocol after activation');
  assert.equal((await request(port, komariHost, '/api/nodes')).json.data.length, 3);
  const komari = await openSocket(komariHost, '/api/rpc2');
  let rpcId = 0;
  await until(async () => {
    komari.socket.send(JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'common:getNodesLatestStatus', params: { uuid: 'fixture-online' } }));
    return new Set(komari.messages.filter(message => message.result?.bridge?.transport === 'websocket').map(message => message.result.cpu)).size >= 2;
  }, 'Komari native observations and metric changes missing');
  assert.equal(komari.messages.some(message => message.error), false);
  assert.equal(cfsm.errors.length + komari.errors.length, 0);
  assert.equal(sourceWs.clients.size, 2, 'one actual source connection per open viewer');
  response = await request(port, adminHost, '/manage/api/logout', { method: 'POST', headers: session, body: {} }); assert.equal(response.status, 200);
  assert.equal((await request(port, adminHost, '/manage/api/state', { headers: session })).status, 401);
  await stop(running);
  await until(() => cfsm.socket.readyState === WebSocket.CLOSED && komari.socket.readyState === WebSocket.CLOSED, 'viewer sockets not closed on shutdown');
  running = await launch();
  assert.equal((await request(port, displayHost, '/')).headers.location, `https://${komariHost}/`, 'restart must not reseed active CFSM over saved selection');
  assert.equal((await request(port, komariHost, '/app.js')).status, 200);
  const persisted = JSON.parse(await readFile(join(store, 'state.json'), 'utf8'));
  assert.equal(persisted.active, komariId); assert.equal(persisted.previous, cfsmId); assert.equal(persisted.generation, generation);
  assert.equal(Object.keys(persisted.sessions).length, 0, 'logout persists across restart');
  assert.equal(rejectedSourceAuth, 0); assert.ok(sourceFrames >= 4);
  await stop(running);
});
