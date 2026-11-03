import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { readNodeRuntimeConfig, nodeRequest, isLoopback, isTrustedProxy } from '../src/runtime/node-request.ts';
import { managementConfig, installationUrl } from '../src/management/config.ts';
import { BridgeError } from '../src/core/errors.ts';
import { Admin } from '../src/management/admin.ts';
import { applyThemeCommand, emptyThemeState, type ThemeStore, type ThemeCommand } from '../src/themes/store.ts';

const env = {
  BRIDGE_NODE_MODE: 'proxy', BRIDGE_LISTEN_HOST: '0.0.0.0',
  BRIDGE_ADMIN_ORIGIN: 'https://admin.example.test',
  BRIDGE_DISPLAY_ORIGIN: 'https://monitor.example.test',
  BRIDGE_DISPLAY_DOMAIN: 'themes.example.test',
  BRIDGE_PREVIEW_ORIGIN: 'https://preview.example.test',
  BRIDGE_ADMIN_PASSWORD: 'synthetic-admin-password-for-tests',
};
const management = managementConfig(env);
const runtime = readNodeRuntimeConfig(env);
const local = readNodeRuntimeConfig({});
const localManagement = managementConfig({BRIDGE_ROUTING:'isolated'});
function input(options: { host?: string; peer?: string; url?: string; method?: string; headers?: [string, string][] } = {}): IncomingMessage {
  const entries: [string, string][] = [['Host', options.host ?? 'admin.example.test'], ...(options.headers ?? [])];
  const headers: Record<string, string> = {};
  for (const [key, value] of entries) headers[key.toLowerCase()] = headers[key.toLowerCase()] === undefined ? value : `${headers[key.toLowerCase()]}, ${value}`;
  return { url: options.url ?? '/', method: options.method ?? 'GET', headers, rawHeaders: entries.flat(), socket: { remoteAddress: options.peer ?? '127.0.0.1' } } as IncomingMessage;
}
const forwarded: [string, string][] = [['X-Forwarded-Proto', 'https']];
function rejects(call: () => unknown, status?: number) {
  assert.throws(call, error => error instanceof BridgeError && (status === undefined || error.status === status));
}

test('runtime configuration is explicit, loopback by default, with validated addresses and CIDRs', () => {
  assert.deepEqual([local.mode, local.host, local.port], ['local', '127.0.0.1', 8787]);
  assert.equal(runtime.host, '0.0.0.0');
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) assert.equal(isTrustedProxy(runtime, peer), true);
  for (const peer of ['127.0.0.2', '10.0.0.1', '::2', undefined, '127.0.0.1:123']) assert.equal(isTrustedProxy(runtime, peer), false);
  for (const peer of ['127.9.2.3', '::1', '::ffff:127.0.0.9']) assert.equal(isLoopback(peer), true);
  for (const peer of ['10.0.0.1', '::2', 'localhost', undefined]) assert.equal(isLoopback(peer), false);
  const custom = readNodeRuntimeConfig({ ...env, BRIDGE_TRUSTED_PROXIES: '10.2.0.0/16, 2001:db8::/32' });
  assert.equal(isTrustedProxy(custom, '::ffff:10.2.1.4'), true);
  assert.equal(isTrustedProxy(custom, '10.3.1.4'), false);
  assert.equal(isTrustedProxy(custom, '2001:db8::42'), true);
  assert.equal(isTrustedProxy(custom, '127.0.0.1'), false);
});

test('invalid runtime, unsafe local listeners, development proxy and incomplete HTTPS configuration fail closed', () => {
  for (const overrides of [
    { BRIDGE_NODE_MODE: 'other' }, { BRIDGE_LISTEN_HOST: '0.0.0.0' }, { BRIDGE_LISTEN_HOST: 'example.test' },
    { BRIDGE_LISTEN_PORT: '0' }, { BRIDGE_LISTEN_PORT: '65536' }, { BRIDGE_LISTEN_PORT: '1.5' },
    { BRIDGE_LISTEN_PORT: '' }, { BRIDGE_LISTEN_PORT: '8787junk' },
    { BRIDGE_TRUSTED_PROXIES: '' }, { BRIDGE_TRUSTED_PROXIES: '*' }, { BRIDGE_TRUSTED_PROXIES: '127.0.0.1/33' },
    { BRIDGE_TRUSTED_PROXIES: '::1/129' }, { BRIDGE_TRUSTED_PROXIES: '::1/' }, { BRIDGE_TRUSTED_PROXIES: '::1/128/1' },
    { BRIDGE_TRUSTED_PROXIES: '127.0.0.1,unknown' }, { BRIDGE_TRUSTED_PROXIES: 'localhost' },
  ]) rejects(() => readNodeRuntimeConfig(overrides), 503);
  rejects(() => readNodeRuntimeConfig({ BRIDGE_NODE_MODE: 'proxy' }), 503);
  rejects(() => readNodeRuntimeConfig({ ...env, BRIDGE_DEV_PROXY: 'http://127.0.0.1:8080' }), 503);
  for (const key of ['BRIDGE_ADMIN_ORIGIN', 'BRIDGE_DISPLAY_ORIGIN', 'BRIDGE_PREVIEW_ORIGIN']) {
    rejects(() => readNodeRuntimeConfig({ ...env, [key]: 'http://test.localhost:8787' }), 503);
  }
  rejects(() => nodeRequest(input({ headers: forwarded }), runtime, { ...management, adminOrigin: 'http://admin.localhost:8786' }), 503);
});

test('trusted TLS proxy preserves only configured origins and legal immutable installation authorities', () => {
  const origins = [management.adminOrigin, management.displayOrigin, management.previewOrigin,
    installationUrl(management, 'a'.repeat(32)), installationUrl(management, 'b'.repeat(32), true)];
  for (const origin of origins) {
    const request = nodeRequest(input({ host: new URL(origin).host, peer: '::ffff:127.0.0.1', url: '/api/ws?x=1', headers: forwarded }), runtime, management);
    assert.equal(request.url, `${origin}/api/ws?x=1`);
    assert.equal(request.headers.get('host'), new URL(origin).host);
  }
  const spoofed = nodeRequest(input({ headers: [...forwarded,
    ['X-Forwarded-Host', 'attacker.invalid'], ['Forwarded', 'host=attacker.invalid;proto=http;for=192.0.2.10'],
    ['CF-Connecting-IP', '192.0.2.99'], ['X-Real-IP', '2001:db8::123']] }), runtime, management);
  assert.equal(new URL(spoofed.url).origin, management.adminOrigin);
  assert.equal(spoofed.headers.get('cf-connecting-ip'), '2001:db8::123');
  for (const name of ['x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip']) assert.equal(spoofed.headers.has(name), false);
  const noRealIp = nodeRequest(input({ headers: [...forwarded, ['CF-Connecting-IP', '192.0.2.99']] }), runtime, management);
  assert.equal(noRealIp.headers.get('cf-connecting-ip'), '127.0.0.1');
});

test('HTTP and WebSocket upgrades reject the same untrusted peers, spoofed TLS, authorities and request targets', () => {
  for (const websocket of [false, true]) {
    const base: [string, string][] = websocket ? [...forwarded, ['Connection', 'Upgrade'], ['Upgrade', 'websocket']] : forwarded;
    rejects(() => nodeRequest(input({ peer: '198.51.100.4', headers: base }), runtime, management), 403);
    for (const host of ['unknown.example.test', 'admin.example.test.attacker.test', 't-abc.themes.example.test',
      `p-${'a'.repeat(32)}.themes.example.test`, `t-${'a'.repeat(32)}.preview.example.test`,
      'admin.example.test:8443']) rejects(() => nodeRequest(input({ host, headers: base }), runtime, management), 421);
    for (const host of ['https://admin.example.test', 'user@admin.example.test', 'admin.example.test/path', 'admin.example.test\\evil',
      'admin.example.test,evil.test', 'admin.example.test:0', 'admin.example.test:65536', '[::1', '127.1', 'admin.example.test.', 'admin..example.test', ' admin.example.test']) {
      rejects(() => nodeRequest(input({ host, headers: base }), runtime, management), 400);
    }
    for (const url of ['https://admin.example.test/', '//admin.example.test/', '/\\evil.test/', '/ok#fragment', '/has space', '/bad\npath', '*']) {
      rejects(() => nodeRequest(input({ url, headers: base }), runtime, management), 400);
    }
    rejects(() => nodeRequest(input({ headers: [...base, ['hOsT', 'admin.example.test']] }), runtime, management), 400);
    const upgrade: [string, string][] = websocket ? [['Upgrade', 'websocket']] : [];
    for (const value of ['http', 'https,http', 'https, https', 'HTTPS', 'https://', ' https']) {
      rejects(() => nodeRequest(input({ headers: [...upgrade, ['X-Forwarded-Proto', value]] }), runtime, management), 400);
    }
    rejects(() => nodeRequest(input({ headers: upgrade }), runtime, management), 400);
    rejects(() => nodeRequest(input({ headers: [...base, ['X-Forwarded-Proto', 'https']] }), runtime, management), 400);
    for (const ip of ['198.51.100.1, 198.51.100.2', 'unknown', 'https://198.51.100.1', '198.51.100.1:80', '']) {
      rejects(() => nodeRequest(input({ headers: [...base, ['X-Real-IP', ip]] }), runtime, management), 400);
    }
    rejects(() => nodeRequest(input({ headers: [...base, ['X-Real-IP', '192.0.2.1'], ['x-real-ip', '192.0.2.2']] }), runtime, management), 400);
  }
});

test('local requests ignore forwarded values and preserve listener-port routing for both protocols', () => {
  for (const [host, port] of [['127.0.0.1:8787', 8787], ['admin.localhost:8786', 8786], ['[::1]:8787', 8787],
    [`t-${'a'.repeat(32)}.display.localhost:8787`, 8787], [`p-${'b'.repeat(32)}.preview.localhost:8789`, 8789]] as const) {
    for (const websocket of [false, true]) {
      const headers: [string, string][] = [['X-Forwarded-Proto', 'https'], ['X-Forwarded-Proto', 'http'],
        ['X-Real-IP', 'attacker'], ['X-Forwarded-Host', 'evil.test'], ['CF-Connecting-IP', '192.0.2.1']];
      if (websocket) headers.push(['Upgrade', 'websocket']);
      const request = nodeRequest(input({ host, headers, url: '/api/ws', peer: '::ffff:127.0.0.1' }), local, localManagement, undefined, port);
      assert.equal(request.url, `http://${host}/api/ws`);
      assert.equal(request.headers.get('cf-connecting-ip'), '::ffff:127.0.0.1');
      assert.equal(request.headers.has('x-forwarded-proto'), false);
      rejects(() => nodeRequest(input({ host, headers }), local, localManagement, undefined, port + 1), 400);
    }
  }
  rejects(() => nodeRequest(input({ host: 'evil.test:8787' }), local, localManagement), 400);
});

class MemoryStore implements ThemeStore {
  value = emptyThemeState();
  async state() { return structuredClone(this.value); }
  async command(command: ThemeCommand) { this.value = applyThemeCommand(this.value, command); return this.state(); }
  async putAsset() { throw new Error('not used'); }
  async asset() { return null; }
}

test('TLS proxy requests reach real admin origin checks and produce a Secure host-only session cookie', async () => {
  const admin = new Admin(management, new MemoryStore(), async () => new Response('synthetic'));
  const body = Buffer.from(JSON.stringify({ username: 'admin', password: env.BRIDGE_ADMIN_PASSWORD }));
  const request = nodeRequest(input({ method: 'POST', url: '/manage/api/login', headers: [...forwarded,
    ['Origin', management.adminOrigin], ['Content-Type', 'application/json']] }), runtime, management, body);
  const response = await admin.handle(request);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /^__Host-leobridge_admin=[a-f0-9]{64};/);
  assert.match(cookie, /; Secure(?:;|$)/);
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; HttpOnly/);
  assert.doesNotMatch(cookie, /Domain=/i);
});

test('spoofing CF-Connecting-IP cannot reset admin login throttling through the trusted proxy', async () => {
  const admin = new Admin(management, new MemoryStore(), async () => new Response('synthetic'));
  for (let index = 0; index < 11; index++) {
    const request = nodeRequest(input({ method: 'POST', url: '/manage/api/login', headers: [...forwarded,
      ['Origin', management.adminOrigin], ['Content-Type', 'application/json'], ['CF-Connecting-IP', `192.0.2.${index + 1}`]] }),
    runtime, management, Buffer.from(JSON.stringify({ username: 'admin', password: 'wrong' })));
    const response = await admin.handle(request);
    assert.equal(response.status, index < 10 ? 401 : 429);
  }
});

test('single listener accepts only configured origins; direct HTTP requires explicit access and admin credentials',()=>{
  const config=managementConfig({});
  assert.equal(config.routing,'single');assert.equal(config.displayOrigin,'http://127.0.0.1:8787');
  assert.equal(new URL(config.previewOrigin).port,'8787');
  assert.equal(nodeRequest(input({host:'127.0.0.1:8787',url:'/admin/'}),local,config).url,'http://127.0.0.1:8787/admin/');
  rejects(()=>nodeRequest(input({host:'admin.localhost:8786'}),local,config),421);
  const values={BRIDGE_ROUTING:'single',BRIDGE_NODE_MODE:'direct',BRIDGE_ORIGIN:'http://192.0.2.42:8080',BRIDGE_LISTEN_PORT:'8080',BRIDGE_LISTEN_HOST:'0.0.0.0',BRIDGE_ACCESS:'public',BRIDGE_ADMIN_PASSWORD:'synthetic-admin-password'};
  const direct=readNodeRuntimeConfig(values),site=managementConfig(values);
  assert.equal(direct.port,8080);
  const req=nodeRequest(input({host:'192.0.2.42:8080',peer:'198.51.100.7',url:'/admin/api/session',headers:[['X-Real-IP','192.0.2.1'],['X-Forwarded-Proto','https']]}),direct,site);
  assert.equal(req.headers.get('cf-connecting-ip'),'198.51.100.7');assert.equal(new URL(req.url).protocol,'http:');
  rejects(()=>nodeRequest(input({host:'other.invalid:8080'}),direct,site),421);
  for(const overrides of [{BRIDGE_ACCESS:'local'},{BRIDGE_ADMIN_PASSWORD:''},{BRIDGE_ROUTING:'isolated'}])rejects(()=>readNodeRuntimeConfig({...values,...overrides}),503);
});
