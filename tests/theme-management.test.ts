import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Admin } from '../src/management/admin.ts';
import { Site } from '../src/app/site.ts';
import { readConfig } from '../src/core/config.ts';
import { managementConfig, installationUrl, installationFromUrl } from '../src/management/config.ts';
import { applyThemeCommand, commitInstallation, emptyThemeState, sha256, type Installation, type ThemeCommand, type ThemeStore } from '../src/themes/store.ts';
import { FileThemeStore } from '../src/runtime/file-theme-store.ts';
import type { ProtocolApplication } from '../src/app/protocols.ts';

const encoder = new TextEncoder();
const password = 'synthetic-admin-password-for-tests';
const newPassword = 'New-fixture-Password-2026!';
const ids = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];
const ui = async () => new Response('<html>synthetic admin</html>');
const management = () => managementConfig({
  BRIDGE_ADMIN_ORIGIN: 'https://admin.example.test',
  BRIDGE_DISPLAY_ORIGIN: 'https://monitor.example.test',
  BRIDGE_DISPLAY_DOMAIN: 'themes.example.test',
  BRIDGE_PREVIEW_ORIGIN: 'https://preview.example.test',
  BRIDGE_ADMIN_PASSWORD: password,
});
const files = () => [{path: 'index.html', bytes: encoder.encode('<html>synthetic theme</html>'), contentType: 'text/html'}];
function installation(index = 0, overrides: Partial<Installation> = {}): Installation {
  return {
    id: ids[index], title: `Synthetic ${index}`, ecosystem: index ? 'komari' : 'cfsm',
    source: 'https://example.test/synthetic', pinnedVersion: 'synthetic-commit',
    protocolProfile: index ? 'komari-adhesive-v1' : 'cfsm-609cc0b',
    license: {spdx: 'MIT', text: 'Synthetic license fixture', source: 'fixture', sha256: '0'.repeat(64)},
    entry: 'index.html', installedAt: '2026-01-01T00:00:00Z', compatibility: 'verified',
    files: Object.fromEntries(files().map(file => [file.path, {size: file.bytes.length, contentType: file.contentType}])),
    bundled: false, ...overrides,
  };
}
class MemoryStore implements ThemeStore {
  value = emptyThemeState();
  assets = new Map<string, {bytes: Uint8Array; contentType: string}>();
  failPath: string | null = null;
  async state() { return structuredClone(this.value); }
  async command(command: ThemeCommand) { this.value = applyThemeCommand(this.value, command); return this.state(); }
  async putAsset(id: string, path: string, bytes: Uint8Array, contentType: string) {
    if (path === this.failPath) throw new Error('synthetic disk failure');
    this.assets.set(`${id}/${path}`, {bytes, contentType});
  }
  async asset(id: string, path: string) { return this.assets.get(`${id}/${path}`) ?? null; }
}
function request(path: string, options: {method?: string; body?: unknown; cookie?: string; csrf?: string; origin?: string; base?: string} = {}) {
  const method = options.method ?? 'GET';
  const headers = new Headers();
  if (method !== 'GET') { headers.set('content-type', 'application/json'); headers.set('origin', options.origin ?? management().adminOrigin); }
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.csrf) headers.set('x-csrf-token', options.csrf);
  return new Request(`${options.base ?? management().adminOrigin}${path}`, {method, headers, ...(options.body === undefined ? {} : {body: JSON.stringify(options.body)})});
}
async function login(admin: Admin) {
  const response = await admin.handle(request('/manage/api/login', {method: 'POST', body: {username: 'admin', password:(await admin.store.state()).adminCredential?newPassword:password}}));
  assert.equal(response.status, 200);
  let setCookie = response.headers.get('set-cookie')!;
  let body = await response.json() as {csrf: string; mustChangePassword: boolean};
  if(body.mustChangePassword){
    const changed=await admin.handle(request('/manage/api/password',{method:'POST',cookie:setCookie.split(';')[0],csrf:body.csrf,body:{currentPassword:password,newPassword,confirmPassword:newPassword}}));
    assert.equal(changed.status,200);
    const loggedIn=await admin.handle(request('/manage/api/login',{method:'POST',body:{username:'admin',password:newPassword}}));
    assert.equal(loggedIn.status,200);setCookie=loggedIn.headers.get('set-cookie')!;body=await loggedIn.json();
  }
  return {cookie: setCookie.split(';')[0], csrf: body.csrf, setCookie};
}
async function seed(store: ThemeStore, count = 2) {
  for (let index = 0; index < count; index++) await commitInstallation(store, installation(index), files(), index === 0);
}
async function code(response: Response) { return (await response.json() as {code: string}).code; }

test('unconfigured management uses the default password and requires rotation', async () => {
  const admin = new Admin(managementConfig({}), new MemoryStore(), ui);
  assert.equal(admin.config.password,'admin');
  const options={method:'POST',base:admin.config.adminOrigin,origin:admin.config.adminOrigin};
  assert.equal((await admin.handle(request('/admin/api/login',{...options,body:{username:'admin',password:''}}))).status,401);
  const response=await admin.handle(request('/admin/api/login',{...options,body:{username:'admin',password:'admin'}}));
  assert.equal(response.status,200);assert.equal((await response.json()).mustChangePassword,true);
});

test('appearance bootstrap is available before login only on the management origin', async () => {
  const loaded: string[] = [];
  const admin = new Admin(management(), new MemoryStore(), async path => {
    loaded.push(path);
    return new Response('/* appearance bootstrap */', { headers: { 'Content-Type': 'text/javascript' } });
  });
  const response = await admin.handle(request('/appearance.js'));
  assert.equal(response.status, 200);
  assert.deepEqual(loaded, ['appearance.js']);
  assert.match(response.headers.get('content-security-policy')!, /script-src 'self'/);
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal((await admin.handle(request('/appearance.js', { base: management().displayOrigin }))).status, 404);
  assert.equal((await admin.handle(request('/appearance.js', { method: 'POST' }))).status, 405);
  assert.equal((await admin.handle(request('/unknown.js'))).status, 404);
});

test('login cookie is host-only, secure and HttpOnly; state never exposes session hashes or CSRF', async () => {
  const store = new MemoryStore();
  const admin = new Admin(management(), store, ui);
  assert.equal((await admin.handle(request('/manage/api/state'))).status, 401);
  const session = await login(admin);
  assert.match(session.setCookie, /^__Host-leobridge_admin=[a-f0-9]{64};/);
  for (const attribute of ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure']) assert.ok(session.setCookie.includes(attribute));
  assert.doesNotMatch(session.setCookie, /Domain=/i);
  const raw = session.cookie.split('=')[1];
  assert.deepEqual(Object.keys((await store.state()).sessions), [await sha256(raw)]);
  const response = await admin.handle(request('/manage/api/state', session));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  const text = await response.text();
  assert.ok(!text.includes('sessions') && !text.includes(raw) && !text.includes(session.csrf));
  for (const base of [management().displayOrigin, installationUrl(management(), ids[0], true)]) {
    assert.equal((await admin.handle(request('/manage/api/state', {...session, base}))).status, 404);
  }
});

test('origin and CSRF checks precede mutations, and logout invalidates a copied cookie server-side', async () => {
  const store = new MemoryStore(); await seed(store);
  const admin = new Admin(management(), store, ui), session = await login(admin);
  const before = await store.state();
  const mutation = {method: 'POST', body: {id: ids[1], generation: before.generation}, cookie: session.cookie};
  for (const origin of [management().displayOrigin, installationUrl(management(), ids[1], true), 'null']) {
    const response = await admin.handle(request('/manage/api/activate', {...mutation, csrf: session.csrf, origin}));
    assert.equal(response.status, 403); assert.equal(await code(response), 'ORIGIN_REJECTED');
  }
  for (const csrf of [undefined, 'incorrect']) {
    const response = await admin.handle(request('/manage/api/activate', {...mutation, csrf}));
    assert.equal(response.status, 403); assert.equal(await code(response), 'CSRF_REJECTED');
  }
  assert.equal((await store.state()).active, before.active);
  assert.equal((await store.state()).generation, before.generation);
  const logout = await admin.handle(request('/manage/api/logout', {...session, method: 'POST', body: {}}));
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
  assert.deepEqual((await store.state()).sessions, {});
  assert.equal((await admin.handle(request('/manage/api/session', session))).status, 401);
  assert.equal((await admin.handle(request('/manage/api/activate', {...mutation, csrf: session.csrf}))).status, 401);
});

test('expired sessions and incorrect passwords cannot authorize administration', async () => {
  const store = new MemoryStore(), admin = new Admin(management(), store, ui);
  const failed = await admin.handle(request('/manage/api/login', {method: 'POST', body: {username: 'admin', password: 'wrong'}}));
  assert.equal(failed.status, 401); assert.equal(failed.headers.get('set-cookie'), null);
  const session = await login(admin);
  Object.values(store.value.sessions)[0].expires = Date.now() - 1;
  assert.equal((await admin.handle(request('/manage/api/state', session))).status, 401);
});

test('activation uses a generation precondition and unverified packages require explicit acknowledgement', async () => {
  const store = new MemoryStore(); await seed(store, 1);
  await commitInstallation(store, installation(1, {compatibility: 'unverified'}), files());
  const admin = new Admin(management(), store, ui), session = await login(admin);
  const generation = (await store.state()).generation;
  const activate = (body: unknown) => admin.handle(request('/manage/api/activate', {...session, method: 'POST', body}));
  const pending = await activate({id: ids[1], generation});
  assert.equal(pending.status, 409); assert.equal(await code(pending), 'PREVIEW_REQUIRED');
  assert.equal((await activate({id: ids[1], generation, acknowledgeUnverified: true})).status, 200);
  const stale = await activate({id: ids[0], generation});
  assert.equal(stale.status, 409); assert.equal(await code(stale), 'REVISION_CONFLICT');
  assert.equal((await store.state()).active, ids[1]);
  const rollback = await admin.handle(request('/manage/api/rollback', {...session, method: 'POST', body: {generation: generation + 1}}));
  assert.equal(rollback.status, 200); assert.equal((await store.state()).active, ids[0]);
});

test('asset write failure leaves the active version and published metadata untouched', async () => {
  const store = new MemoryStore(); await seed(store, 1);
  const before = await store.state(); store.failPath = 'second.js';
  const candidate = installation(1);
  candidate.files['second.js'] = {size: 1, contentType: 'text/javascript'};
  await assert.rejects(commitInstallation(store, candidate, [...files(), {path: 'second.js', bytes: encoder.encode('x'), contentType: 'text/javascript'}]), /synthetic disk failure/);
  assert.deepEqual(await store.state(), before);
});

test('incomplete or inconsistent packages cannot publish missing entry assets', async () => {
  const variants = [
    [],
    [files()[0], files()[0]],
    [{...files()[0], bytes: encoder.encode('incorrect length')}],
    [{...files()[0], contentType: 'application/javascript'}],
  ];
  for (const candidateFiles of variants) {
    const store = new MemoryStore(); await seed(store, 1);
    const before = await store.state();
    await assert.rejects(commitInstallation(store, installation(1), candidateFiles));
    assert.deepEqual(await store.state(), before);
  }
});

test('file store serializes competing generations and refuses to overwrite installed bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'leobridge-theme-test-'));
  try {
    const first = new FileThemeStore(root), second = new FileThemeStore(root);
    await seed(first, 3);
    const generation = (await first.state()).generation;
    const results = await Promise.allSettled([
      first.command({type: 'activate', id: ids[1], expectedGeneration: generation}),
      second.command({type: 'activate', id: ids[2], expectedGeneration: generation}),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.code, 'REVISION_CONFLICT');
    assert.equal((await first.state()).generation, generation + 1);
    assert.equal((await first.state()).previous, ids[0]);
    await assert.rejects(first.putAsset(ids[0], 'index.html', encoder.encode('replacement'), 'text/html'), {code: 'IMMUTABLE_CONFLICT'});
    assert.equal(new TextDecoder().decode((await second.asset(ids[0], 'index.html'))!.bytes), '<html>synthetic theme</html>');
    await assert.rejects(first.putAsset(ids[0], '../escape', encoder.encode('x'), 'text/plain'), {code: 'INVALID_PATH'});
  } finally { await rm(root, {recursive: true, force: true}); }
});

function fakeProtocol(name: string): ProtocolApplication {
  return {
    fetch: async request => new URL(request.url).pathname === '/api/protocol' ? Response.json({protocol: name}) : null,
    websocketPaths: [name === 'cfsm' ? '/api/ws' : '/api/rpc2'],
    openRealtime: () => ({close() {}}),
  };
}
async function siteFixture(access: 'public' | 'private' = 'public') {
  const store = new MemoryStore(); await seed(store);
  const site = new Site(readConfig({MMWX_BASE_URL: 'https://synthetic-upstream.invalid', BRIDGE_ACCESS: access,
    BRIDGE_USERNAME: 'viewer', BRIDGE_PASSWORD: 'synthetic-viewer-password'}), management(), store, ui);
  site.protocols['cfsm-609cc0b'] = fakeProtocol('cfsm');
  site.protocols['komari-adhesive-v1'] = fakeProtocol('komari');
  return {store, site};
}

test('switching active pointer preserves protocol and assets on old installation hostnames', async () => {
  const {site, store} = await siteFixture();
  const config = management(), original = installationUrl(config, ids[0]), next = installationUrl(config, ids[1]);
  const rootRequest = new Request(`${config.displayOrigin}/server?id=synthetic`);
  assert.equal((await site.fetch(rootRequest)).headers.get('location'), `${original}/server?id=synthetic`);
  await store.command({type: 'activate', id: ids[1], expectedGeneration: (await store.state()).generation});
  assert.equal((await site.fetch(rootRequest)).headers.get('location'), `${next}/server?id=synthetic`);
  for (const [origin, protocol] of [[original, 'cfsm'], [next, 'komari']]) {
    assert.deepEqual(await (await site.fetch(new Request(`${origin}/api/protocol`))).json(), {protocol});
    const asset = await site.fetch(new Request(`${origin}/`));
    assert.equal(asset.status, 200); assert.equal(await asset.text(), '<html>synthetic theme</html>');
    assert.equal(asset.headers.get('set-cookie'), null);
    assert.equal((await site.fetch(new Request(`${origin}/missing.js`, {headers: {accept: 'text/html'}}))).status, 404);
  }
});

test('preview has a separate origin and cannot reach admin endpoints or cross-origin WebSockets', async () => {
  const {site} = await siteFixture(), config = management();
  const display = installationUrl(config, ids[0]), preview = installationUrl(config, ids[0], true);
  assert.notEqual(new URL(display).hostname, new URL(preview).hostname);
  assert.notEqual(new URL(preview).hostname, new URL(config.adminOrigin).hostname);
  for (const [origin, isPreview] of [[display, false], [preview, true]] as const) {
    const info = await (await site.fetch(new Request(`${origin}/__bridge/version`))).json() as {preview: boolean};
    assert.equal(info.preview, isPreview);
    const session = await login(site.admin);
    assert.equal((await site.fetch(request('/manage/api/state', {...session, base: origin}))).status, 404);
    assert.equal((await site.fetch(request('/admin', {...session, base: origin}))).status, 404);
    assert.equal(await site.websocket(new Request(`${origin}/api/ws`, {headers: {origin: config.adminOrigin}})), null);
    assert.equal(await site.websocket(new Request(`${origin}/api/ws`, {headers: {origin}})), site.protocols['cfsm-609cc0b']);
  }
  assert.equal(installationFromUrl(config, new URL(`${display}:8443/`)), null);
  assert.equal(installationFromUrl(config, new URL(display.replace('https:', 'http:'))), null);
  assert.equal((await site.fetch(new Request('https://unrelated.example.test/'))).status, 404);
});

test('private display requires independent viewer authentication even with an admin cookie', async () => {
  const {site} = await siteFixture('private'), session = await login(site.admin);
  const display = installationUrl(management(), ids[0]);
  assert.equal((await site.fetch(request('/', {...session, base: display}))).status, 401);
  assert.equal(await site.websocket(request('/api/ws', {...session, base: display})), null);
  const headers = {authorization: `Basic ${Buffer.from('viewer:synthetic-viewer-password').toString('base64')}`};
  assert.equal((await site.fetch(new Request(display, {headers}))).status, 200);
});

test('management rejects same-host isolation and non-local cleartext configuration', () => {
  assert.throws(() => managementConfig({BRIDGE_ADMIN_ORIGIN: 'http://localhost:8786', BRIDGE_DISPLAY_ORIGIN: 'http://localhost:8787'}), {code: 'ORIGIN_ISOLATION'});
  assert.throws(() => managementConfig({BRIDGE_ADMIN_ORIGIN: 'http://admin.example.test'}), {code: 'MANAGEMENT_CONFIGURATION'});
  assert.throws(() => managementConfig({BRIDGE_ADMIN_ORIGIN: 'https://admin.preview.localhost'}), {code: 'ORIGIN_ISOLATION'});
});

test('single origin defaults to root theme and /admin, with namespaced resources and path-scoped login', async () => {
  const config=managementConfig({BRIDGE_ORIGIN:'https://single.example.test',BRIDGE_ADMIN_PASSWORD:password});
  assert.equal(config.routing,'single'); assert.equal(config.adminOrigin,config.displayOrigin);
  const store=new MemoryStore();await seed(store);
  const loaded:string[]=[];
  const site=new Site(readConfig({MMWX_BASE_URL:'https://synthetic.invalid',BRIDGE_ACCESS:'public'}),config,store,async path=>{loaded.push(path);return ui();});
  site.protocols['cfsm-609cc0b']=fakeProtocol('cfsm');
  site.protocols['komari-adhesive-v1']=fakeProtocol('komari');
  const call=(path:string,options:Parameters<typeof request>[1]={})=>site.fetch(request(path,{base:config.displayOrigin,origin:config.displayOrigin,...options}));
  assert.equal(await (await call('/')).text(),'<html>synthetic theme</html>');
  assert.equal((await call('/')).headers.get('location'),null);
  assert.equal((await call('/')).headers.get('cache-control'),'no-store');
  assert.deepEqual(await (await call('/api/protocol')).json(),{protocol:'cfsm'});
  assert.equal((await call('/admin')).headers.get('location'),'/admin/');
  assert.equal((await call('/admin/')).status,200);
  assert.equal((await call('/admin/appearance.js')).status,200);
  assert.deepEqual(loaded,['index.html','appearance.js']);
  assert.equal((await call('/admin/missing.js')).status,404);
  assert.equal((await call('/manage/api/state')).status,404);
  assert.equal((await call('/admin/api/state')).status,401);
  const response=await call('/admin/api/login',{method:'POST',body:{username:'admin',password}});
  assert.equal(response.status,200);
  const setCookie=response.headers.get('set-cookie')!;
  assert.match(setCookie,/^__Secure-leobridge_admin_path=/);assert.match(setCookie,/Path=\/admin;/);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);
  let cookie=setCookie.split(';')[0],{csrf}=await response.json() as {csrf:string};
  assert.equal((await call('/admin/api/state',{cookie})).status,403);
  assert.equal((await call('/admin/api/password',{method:'POST',cookie,csrf,body:replacement(password,newPassword)})).status,200);
  const relogin=await call('/admin/api/login',{method:'POST',body:{username:'admin',password:newPassword}});
  assert.equal(relogin.status,200);cookie=relogin.headers.get('set-cookie')!.split(';')[0];csrf=(await relogin.json()).csrf;
  const state=await (await call('/admin/api/state',{cookie})).json() as any;
  assert.equal(state.links[state.active].display,config.displayOrigin);
  let changes=0;site.onActiveThemeChange=()=>changes++;
  const body={id:ids[1],generation:state.generation};
  assert.equal((await call('/admin/api/activate',{method:'POST',cookie,body})).status,403);
  assert.equal((await call('/admin/api/activate',{method:'POST',cookie,csrf,body,origin:'https://other.invalid'})).status,403);
  assert.equal(changes,0);
  assert.equal((await call('/admin/api/activate',{method:'POST',cookie,csrf,body})).status,200);
  assert.equal(changes,1);
  assert.deepEqual(await (await call('/api/protocol')).json(),{protocol:'komari'});
  const rootWs=new Request(config.displayOrigin+'/api/rpc2',{headers:{origin:config.displayOrigin}});
  assert.equal(await site.websocket(rootWs),site.protocols['komari-adhesive-v1']);
  assert.equal(await site.websocket(new Request(rootWs.url,{headers:{origin:'https://other.invalid'}})),null);
  const preview=installationUrl(config,ids[0],true);
  assert.equal((await site.fetch(new Request(preview+'/admin/api/state',{headers:{cookie}}))).status,404);
  assert.equal((await call('/admin/api/logout',{method:'POST',cookie,csrf,body:{}})).status,200);
  assert.equal((await call('/admin/api/state',{cookie})).status,401);
});

async function rawLogin(admin:Admin,password=admin.config.password){
  const response=await admin.handle(request('/manage/api/login',{method:'POST',body:{username:'admin',password}}));
  const body=await response.json();
  return {response,data:body,cookie:response.headers.get('set-cookie')?.split(';')[0],csrf:body.csrf};
}
const replacement=(currentPassword:string,newPassword='Fresh-fixture-Secret-2026!')=>({currentPassword,newPassword,confirmPassword:newPassword});

test('bootstrap sessions, including legacy sessions, cannot bypass mandatory rotation',async()=>{
  const store=new MemoryStore(),admin=new Admin({...management(),password:'admin'},store,ui);
  const session=await rawLogin(admin);
  assert.equal(session.data.mustChangePassword,true);
  const resumed=new Admin(admin.config,store,ui);
  assert.equal((await (await resumed.handle(request('/manage/api/session',session))).json()).mustChangePassword,true);
  // Old deployments had no credentialVersion. They must also enter the restricted flow.
  delete Object.values(store.value.sessions)[0].credentialVersion;
  for(const path of ['state','catalog?ecosystem=cfsm','install','activate','rollback']){
    const response=await resumed.handle(request(`/manage/api/${path}`,{...session,...(['install','activate','rollback'].includes(path)?{method:'POST',body:{}}:{})}));
    assert.equal(response.status,403);assert.equal(await code(response),'PASSWORD_CHANGE_REQUIRED');
  }
  const loggedOut=await resumed.handle(request('/manage/api/logout',{...session,method:'POST',body:{}}));
  assert.equal(loggedOut.status,200);
});

test('password changes enforce origin, CSRF, current password, strength and confirmation on the server',async()=>{
  const store=new MemoryStore(),admin=new Admin({...management(),password:'admin'},store,ui),session=await rawLogin(admin);
  const change=(body:unknown,options={})=>admin.handle(request('/manage/api/password',{...session,method:'POST',body,...options}));
  assert.equal(await code(await change(replacement('admin'),{origin:management().displayOrigin})),'ORIGIN_REJECTED');
  assert.equal(await code(await change(replacement('admin'),{csrf:'wrong'})),'CSRF_REJECTED');
  assert.equal(await code(await change(replacement('wrong'))),'CURRENT_PASSWORD');
  for(const weak of ['admin','Short1!','lowercase-only-123!','UPPERCASE-ONLY-123!','No-Numbers-Here!','MissingSymbols123','Password123!','A1!a'.repeat(33)]){
    assert.equal(await code(await change(replacement('admin',weak))),'WEAK_PASSWORD');
  }
  // Policy validation failures consume the same bounded attempt budget.
  assert.equal((await change({...replacement('admin'),confirmPassword:'different'})).status,400);
  assert.equal(await code(await change(replacement('admin'))),'LOGIN_THROTTLED');
  assert.equal(store.value.adminCredential,undefined);
  const another=await rawLogin(admin);
  const mismatch=await admin.handle(request('/manage/api/password',{...another,method:'POST',body:{...replacement('admin'),confirmPassword:'different'}}));
  assert.equal(await code(mismatch),'PASSWORD_MISMATCH');
});

test('password rotation is durable, stores only a salted hash and revokes every old session',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bridge-password-'));
  try{
    const store=new FileThemeStore(root),config={...management(),password:'admin'},admin=new Admin(config,store,ui);
    await seed(store);
    const first=await rawLogin(admin),second=await rawLogin(admin),before=await store.state(),body=replacement('admin');
    const changed=await admin.handle(request('/manage/api/password',{...first,method:'POST',body}));
    assert.equal(changed.status,200);assert.match(changed.headers.get('set-cookie')!,/Max-Age=0/);
    const saved=await store.state();
    assert.equal(saved.generation,before.generation);assert.equal(saved.active,before.active);
    assert.equal(saved.adminCredential?.iterations,600000);assert.equal(saved.adminCredential?.version,1);
    assert.match(saved.adminCredential!.salt,/^[a-f0-9]{32}$/);assert.match(saved.adminCredential!.hash,/^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(saved).includes(body.newPassword));assert.ok(!JSON.stringify(saved).includes('"admin"'));
    const restarted=new Admin({...config,password:'Other-bootstrap-password-2026'},new FileThemeStore(root),ui);
    for(const session of [first,second])assert.equal((await restarted.handle(request('/manage/api/session',session))).status,401);
    for(const old of ['admin','Other-bootstrap-password-2026'])assert.equal((await rawLogin(restarted,old)).response.status,401);
    const current=await rawLogin(restarted,body.newPassword);assert.equal(current.response.status,200);assert.equal(current.data.mustChangePassword,false);
    const publicResponse=await restarted.handle(request('/manage/api/state',current)),text=await publicResponse.text();
    assert.equal(publicResponse.status,200);
    for(const secret of ['adminCredential','sessions',saved.adminCredential!.hash,saved.adminCredential!.salt])assert.ok(!text.includes(secret));
    const unchanged=await restarted.handle(request('/manage/api/password',{...current,method:'POST',body:replacement(body.newPassword,body.newPassword)}));
    assert.equal(await code(unchanged),'PASSWORD_UNCHANGED');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('concurrent rotations have exactly one winner and stale login commits are rejected',async()=>{
  const store=new MemoryStore(),admin=new Admin(management(),store,ui),first=await rawLogin(admin),second=await rawLogin(admin);
  const responses=await Promise.all([first,second].map((session,index)=>admin.handle(request('/manage/api/password',{...session,method:'POST',body:replacement(password,`Concurrent-fixture-${index}-2026!`)}))));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,401]);
  assert.equal(store.value.adminCredential?.version,1);assert.deepEqual(store.value.sessions,{});
  await assert.rejects(store.command({type:'session',id:'stale',session:{csrf:'old',expires:Date.now()+60000,credentialVersion:0}}),/密码已变更/);
  const winner=responses.findIndex(r=>r.status===200);
  assert.equal((await rawLogin(admin,`Concurrent-fixture-${winner}-2026!`)).response.status,200);
  assert.equal((await rawLogin(admin,`Concurrent-fixture-${1-winner}-2026!`)).response.status,401);
});
