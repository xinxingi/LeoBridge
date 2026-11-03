/** Historical two-theme acceptance: requires fixture installations and initialized admin state.
 * Build: docker build -f deploy/docker/Dockerfile -t leobridge:acceptance .
 * For --amd64: add --platform linux/amd64 and use -t leobridge:acceptance-amd64.
 * Runs only an isolated local Docker Compose project with synthetic data.
 * Does not read .dev.vars, connect to a real controller, publish images, or deploy.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

process.umask(0o077);
const root = resolve(import.meta.dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = resolve(root, 'work/private/docker-acceptance', stamp);
const project = `leobridge-acceptance-${Date.now()}`;
const originalVolume = `${project}-store`, restoredVolume = `${project}-restored`;
const reservationName = `${project}-old-ip`;
assert.ok(process.argv.slice(2).every(argument => argument === '--amd64'), 'Only --amd64 is supported');
const image = process.argv.includes('--amd64') ? 'leobridge:acceptance-amd64' : 'leobridge:acceptance';
const records = [], commands = [];
const admin = 'admin.container.test', display = 'monitor.container.test';
const password = 'Synthetic-container-admin-password-2026!';
const authorization = `Basic ${Buffer.from('synthetic-viewer:synthetic-container-viewer-password').toString('base64')}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
async function run(command, args, allowedFailure = false) {
  const result = await new Promise((accept, reject) => {
    // Shell variables must not override the synthetic Compose fixture.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(BRIDGE_|MMWX_|LEOBRIDGE_|BACKEND_|PROXY_IPV4$|THEME_STORE_VOLUME$|TLS_DIRECTORY$|NGINX_IMAGE$|NODE_IMAGE$)/.test(key)));
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('exit', code => accept({ code, stdout, stderr }));
  });
  commands.push({ command, args, ...result });
  await writeFile(resolve(directory, 'commands.json'), JSON.stringify(commands, null, 2));
  if (result.code !== 0 && !allowedFailure) throw new Error(`${command} ${args[0]} failed (${result.code}); see private commands.json`);
  return result;
}
const docker = (...args) => run('docker', args);
const file = resolve(directory, 'compose.json');
const compose = (...args) => docker('compose', '-p', project, '-f', file, ...args);
const exec = (...args) => compose('exec', '-T', ...args);
function check(name, value, details = {}) { records.push({ case: name, pass: !!value, ...details }); console.log(JSON.stringify(records.at(-1))); assert.ok(value, name); }
async function port() { const server = createServer(); await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); }); const value = server.address().port; await new Promise(accept => server.close(accept)); return value; }
const httpsPort = await port(), httpPort = await port();
let ca, cookie = '', csrf = '', started = false, config;
async function request(host, path, options = {}) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((accept, reject) => {
    const req = httpsRequest({ host: '127.0.0.1', port: httpsPort, servername: host, ca, rejectUnauthorized: true,
      method: body === undefined ? 'GET' : 'POST', path, agent: false,
      headers: { Host: host, ...(options.auth === false ? {} : { Authorization: authorization }),
        ...(host === admin && cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { Origin: `https://${host}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-CSRF-Token': csrf }), ...options.headers } }, res => {
      const parts = []; res.on('data', part => parts.push(part)); res.on('error', reject);
      res.on('end', () => { const bytes = Buffer.concat(parts); let json; try { json = JSON.parse(bytes); } catch {} accept({ status: res.statusCode, headers: res.headers, bytes, json }); });
    });
    req.setTimeout(5000, () => req.destroy(new Error('HTTPS deadline'))); req.on('error', reject); req.end(body);
  });
}
const state = async () => { const response = await request(admin, '/manage/api/state'); assert.equal(response.status, 200); return response.json; };
async function volumeManifest(volume, name) {
  // Read the entire stopped volume without starting the application or following links.
  const script = `const fs=require('fs'),path=require('path'),crypto=require('crypto');const files=[];function walk(prefix=''){for(const name of fs.readdirSync(path.join('/snapshot',prefix)).sort()){const relative=prefix?prefix+'/'+name:name,p=path.join('/snapshot',relative),stat=fs.lstatSync(p);if(stat.isDirectory())walk(relative);else if(stat.isFile()){const bytes=fs.readFileSync(p);files.push({path:relative,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})}else throw Error('Unexpected non-regular entry in volume')}}walk();console.log(JSON.stringify(files))`;
  const result = await docker('run', '--rm', '--network', 'none', '--user', '0', '--entrypoint', 'node', '-v', `${volume}:/snapshot:ro`, image, '-e', script);
  const manifest = JSON.parse(result.stdout);
  await writeFile(resolve(directory, name), JSON.stringify(manifest, null, 2));
  return manifest;
}
async function login() {
  const info=await request(admin,'/manage/api/login-info');
  const initial=info.json.credentialSource==='default';
  const response = await request(admin, '/manage/api/login', { body: { username: 'admin', password:initial?'admin':password } });
  assert.equal(response.status, 200); const setCookie = response.headers['set-cookie'][0];
  cookie = setCookie.split(';')[0]; csrf = response.json.csrf;
  if(initial){
    assert.equal((await request(admin,'/manage/api/password',{body:{currentPassword:'admin',newPassword:password,confirmPassword:password}})).status,200);
    await login();
  }
  check('tls-admin-cookie', /^__Host-/.test(setCookie) && /Secure/.test(setCookie) && /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie) && !/Domain=/i.test(setCookie));
}
async function websocket(host, protocol, authenticate = true) {
  const ws = new WebSocket(`wss://127.0.0.1:${httpsPort}${protocol === 'cfsm' ? '/api/ws' : '/api/rpc2'}`, {
    ca, rejectUnauthorized: true, servername: host, handshakeTimeout: 5000,
    headers: { Host: host, Origin: `https://${host}`, ...(authenticate ? { Authorization: authorization } : {}) },
  });
  return new Promise((accept, reject) => {
    let interval, settled = false, sequence = 0; const values = new Set(); let status;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); clearInterval(interval); if (ws.readyState === 1) ws.close(1000, 'acceptance complete'); else ws.terminate(); error ? reject(error) : accept(result); };
    const timer = setTimeout(() => finish(new Error(`${protocol} WSS timed out`)), 15000);
    ws.on('upgrade', res => { status = res.statusCode; });
    ws.on('unexpected-response', (_req, res) => { res.resume(); finish(authenticate ? new Error(`WSS rejected ${res.statusCode}`) : null, { status: res.statusCode }); });
    ws.on('error', error => { if (!settled) finish(error); });
    ws.on('open', () => {
      if (!authenticate) { finish(new Error('Private WSS accepted without auth')); return; }
      if (protocol === 'cfsm') ws.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids: ['synthetic-1'] }));
      else { const send = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method: 'common:getNodesLatestStatus', params: { uuid: 'synthetic-1' } })); send(); interval = setInterval(send, 400); }
    });
    ws.on('message', bytes => {
      try {
        const item = JSON.parse(bytes);
        if (protocol === 'cfsm' && item.type === 'batchUpdate' && item.transport === 'websocket') values.add(item.updates[0].samples[0].data.cpu);
        if (protocol === 'komari' && item.result?.bridge?.transport === 'websocket') values.add(item.result.cpu);
        if (item.error) throw new Error('RPC returned an error');
        if (values.size >= 2) finish(null, { status, native_values: values.size });
      } catch (error) { finish(error); }
    });
  });
}
try {
  const context = JSON.parse((await docker('context', 'inspect')).stdout)[0];
  assert.ok(context.Endpoints.docker.Host.startsWith('unix://'), 'Use a local Unix-socket Docker context, never a remote engine');
  assert.ok(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith('unix://'), 'Remote DOCKER_HOST is not allowed');
  const imageInfo = JSON.parse((await docker('image', 'inspect', image)).stdout)[0];
  check('image-exists', !!imageInfo.Id, { id: imageInfo.Id, architecture: imageInfo.Architecture, bytes: imageInfo.Size });
  check('image-target-platform', imageInfo.Os === 'linux' && (!process.argv.includes('--amd64') || imageInfo.Architecture === 'amd64'), { os: imageInfo.Os, architecture: imageInfo.Architecture });
  await mkdir(resolve(directory, 'tls'));
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=admin.container.test',
    '-addext', 'subjectAltName=DNS:admin.container.test,DNS:monitor.container.test,DNS:preview.container.test,DNS:*.themes.container.test,DNS:*.preview.container.test',
    '-keyout', resolve(directory, 'tls/privkey.pem'), '-out', resolve(directory, 'tls/fullchain.pem')]);
  ca = await readFile(resolve(directory, 'tls/fullchain.pem'));
  const environment = { LEOBRIDGE_IMAGE: image, TLS_DIRECTORY: resolve(directory, 'tls'),
    BRIDGE_ADMIN_HOST: admin, BRIDGE_DISPLAY_HOST: display, BRIDGE_DISPLAY_DOMAIN: 'themes.container.test', BRIDGE_PREVIEW_HOST: 'preview.container.test',
    BRIDGE_ACCESS: 'private',
    BRIDGE_USERNAME: 'synthetic-viewer', BRIDGE_PASSWORD: 'synthetic-container-viewer-password',
    THEME_STORE_VOLUME: originalVolume,
    BACKEND_SUBNET: '172.30.184.0/24', BACKEND_DYNAMIC_RANGE: '172.30.184.128/25', PROXY_IPV4: '172.30.184.2' };
  const envFile = resolve(directory, 'synthetic.env');
  await writeFile(envFile, Object.entries(environment).map(([key, value]) => `${key}='${value}'`).join('\n'));
  config = JSON.parse((await docker('compose', '--env-file', envFile, '-f', resolve(root, 'tests/fixtures/container-proxy/compose.yaml'), 'config', '--format', 'json')).stdout);
  config.name = project;
  for (const service of Object.values(config.services)) service.restart = 'no';
  config.services.nginx.ports = [{ target: 80, published: String(httpPort), host_ip: '127.0.0.1', protocol: 'tcp' }, { target: 443, published: String(httpsPort), host_ip: '127.0.0.1', protocol: 'tcp' }];
  config.services.app.healthcheck.interval = '1s'; config.services.app.healthcheck.start_period = '5s';
  config.networks.backend.name = `${project}-network`;
  config.services.fixture = { image, command: ['node', '/app/container-fixture.mjs'], read_only: true, cap_drop: ['ALL'],
    volumes: [{ type: 'bind', source: resolve(root, 'scripts/verify-container-fixture.mjs'), target: '/app/container-fixture.mjs', read_only: true }], networks: ['backend'] };
  await writeFile(file, JSON.stringify(config, null, 2));
  started = true;
  await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '60');
  check('nginx-configuration', (await exec('nginx', 'nginx', '-t')).code === 0);
  const redirect = await new Promise((accept, reject) => { const req = httpRequest({ host: '127.0.0.1', port: httpPort, path: '/?check=1', headers: { Host: display } }, res => { res.resume(); accept({ status: res.statusCode, location: res.headers.location }); }); req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('HTTP redirect deadline'))); req.end(); });
  check('http-to-https-redirect', redirect.status === 308 && redirect.location === `https://${display}/?check=1`);
  const appId = (await compose('ps', '-q', 'app')).stdout.trim();
  const inspect = JSON.parse((await docker('inspect', appId)).stdout)[0];
  check('nonroot-readonly-no-host-port', inspect.Config.User === 'node' && inspect.HostConfig.ReadonlyRootfs && !Object.values(inspect.NetworkSettings.Ports ?? {}).some(Boolean));
  const readonly = await exec('app', 'node', '-e', "const fs=require('fs');if(process.getuid()===0)process.exit(2);try{fs.writeFileSync('/app/acceptance-write','x');process.exit(3)}catch(e){if(!['EROFS','EACCES'].includes(e.code))throw e}console.log('denied')");
  check('actual-root-write-denied', readonly.stdout.trim() === 'denied');
  check('health-not-public', (await request(display, '/healthz')).status === 404);
  check('private-root-denied', (await request(display, '/', { auth: false })).status === 401);
  check('admin-denied-before-login', (await request(admin, '/manage/api/state')).status === 401);
  await login();
  const source=await request(admin,'/manage/api/source');
  if(!source.json.configured){
    const checked=await request(admin,'/manage/api/source/check',{body:{version:0,baseUrl:'http://fixture:8791',token:'synthetic-container-token'}});
    assert.equal(checked.status,200);const review=checked.json;
    assert.equal((await request(admin,'/manage/api/source/save',{body:{reviewId:review.reviewId,assignments:review.candidates.map(c=>c.suggestedId),pingKeys:['target-a','','','','','','',''],confirmed:true}})).status,200);
  }
  let current = await state();
  const cfsm = Object.values(current.installations).find(item => item.ecosystem === 'cfsm');
  const komari = Object.values(current.installations).find(item => item.ecosystem === 'komari');
  assert.ok(cfsm && komari, 'This historical two-theme acceptance script requires explicit synthetic fixture installations; the product no longer bundles themes. Use pnpm test:runtime for the self-contained runtime checks.'); const cfsmHost = new URL(current.links[cfsm.id].display).hostname, komariHost = new URL(current.links[komari.id].display).hostname;
  check('initial-root-pinned', (await request(display, '/')).headers.location === `https://${cfsmHost}/`);
  for (const [item, host] of [[cfsm, cfsmHost], [komari, komariHost]]) {
    const html = await request(host, '/');
    check(`${item.ecosystem}-html`, html.status === 200 && html.bytes.toString().includes('<script'));
    const asset = Object.keys(item.files).find(path => path.endsWith('.js'));
    const response = await request(host, `/${asset}`);
    const expected = (await exec('app', 'node', '-e', `console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(${JSON.stringify(`/app/dist/bundled/${item.id}/${asset}`)})).digest('hex'))`)).stdout.trim();
    check(`${item.ecosystem}-asset-hash`, response.status === 200 && createHash('sha256').update(response.bytes).digest('hex') === expected);
    check(`${item.ecosystem}-private-html-asset-api`, (await request(host, '/', { auth: false })).status === 401 && (await request(host, `/${asset}`, { auth: false })).status === 401 && (await request(host, '/__bridge/version', { auth: false })).status === 401);
    const denied = await websocket(host, item.ecosystem, false); check(`${item.ecosystem}-private-wss`, denied.status === 403);
    const stream = await websocket(host, item.ecosystem); check(`${item.ecosystem}-native-wss-changes`, stream.status === 101 && stream.native_values >= 2, stream);
  }
  const servers = await request(cfsmHost, '/api/servers');
  check('synthetic-node-count', servers.status === 200 && servers.json.servers.length === 3 && servers.json.servers.every(s => s.name.startsWith('Synthetic ')));
  for (const hours of [1, 168]) { const response = await request(cfsmHost, `/api/history/all?id=synthetic-1&hours=${hours}`); check(`cfsm-history-${hours}h`, response.status === 200 && response.json.length === 3 && response.json[0].cpu === 0); }
  for (const hours of [1, 168]) for (const ping of [false, true]) {
    const response = await request(komariHost, '/api/rpc2', { body: { jsonrpc: '2.0', id: 1, method: ping ? 'public:getPingRecords' : 'public:getRecordsByUUID', params: { uuid: 'synthetic-1', hours: String(hours), ...(!ping ? { load_type: 'all' } : {}) } } });
    const rows = response.json?.result?.records;
    check(`komari-${ping ? 'ping' : 'system'}-${hours}h`, response.status === 200 && !response.json.error && rows?.length === (ping ? 2 : 3) && rows[0][ping ? 'value' : 'cpu'] === 0);
  }
  const preview = new URL(current.links[komari.id].preview).hostname;
  check('preview-isolation', (await request(preview, '/__bridge/version')).json.preview === true && (await request(preview, '/manage/api/state')).status === 404);
  const rejected = await request(admin, '/manage/api/activate', { body: { id: komari.id, generation: current.generation }, headers: { Origin: `https://${cfsmHost}` } });
  check('foreign-origin-rejected', rejected.status === 403);
  const activated = await request(admin, '/manage/api/activate', { body: { id: komari.id, generation: current.generation } });
  check('activate-komari', activated.status === 200 && activated.json.active === komari.id);
  current = await state();
  const nginxId = (await compose('ps', '-q', 'nginx')).stdout.trim();
  const nginxBefore = JSON.parse((await docker('inspect', nginxId)).stdout)[0];
  const oldAppIp = Object.values(inspect.NetworkSettings.Networks)[0].IPAddress;
  await compose('stop', 'app'); await compose('rm', '-f', 'app');
  // Reserve only this test's old address so the replacement cannot accidentally
  // reuse it and make a stale nginx startup DNS cache appear correct.
  await docker('run', '-d', '--name', reservationName, '--label', `leobridge.acceptance=${project}`,
    '--network', config.networks.backend.name, '--ip', oldAppIp, '--read-only', '--entrypoint', 'node', image, '-e', 'setInterval(()=>{},1000)');
  await compose('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '60', 'app');
  const replacementId = (await compose('ps', '-q', 'app')).stdout.trim();
  const replacement = JSON.parse((await docker('inspect', replacementId)).stdout)[0];
  const newAppIp = Object.values(replacement.NetworkSettings.Networks)[0].IPAddress;
  let recovered = false; const recoveryStart = Date.now();
  while (Date.now() - recoveryStart < 15000) {
    try { const response = await request(display, '/'); if (response.status === 307 && response.headers.location === `https://${komariHost}/`) { recovered = true; break; } } catch {}
    await delay(500);
  }
  const nginxAfter = JSON.parse((await docker('inspect', nginxId)).stdout)[0];
  check('nginx-recovers-after-app-ip-change', oldAppIp !== newAppIp && recovered && nginxBefore.State.StartedAt === nginxAfter.State.StartedAt,
    { app_ip_changed: oldAppIp !== newAppIp, nginx_restarted: nginxBefore.State.StartedAt !== nginxAfter.State.StartedAt, recovery_ms: Date.now() - recoveryStart });
  await docker('rm', '-f', reservationName);
  await compose('restart', 'app', 'nginx'); await delay(1500);
  check('restart-state-and-session-persist', (await state()).active === komari.id && (await request(display, '/')).headers.location === `https://${komariHost}/`);
  await compose('stop', 'nginx', 'app');
  const beforeBackup = await volumeManifest(originalVolume, 'backup-manifest.json');
  assert.ok(beforeBackup.some(file => file.path === 'state.json'));
  for (const id of [cfsm.id, komari.id]) assert.ok(beforeBackup.some(file => file.path.startsWith(`packages/${id}/`) && file.path.endsWith('.js')));
  await docker('run', '--rm', '--network', 'none', '--user', '0', '--entrypoint', 'sh', '-v', `${originalVolume}:/data:ro`, '-v', `${directory}:/backup`, image, '-c', 'umask 077; tar -C /data -czf /backup/theme-store.tgz .');
  check('full-volume-backup', (await readFile(resolve(directory, 'theme-store.tgz'))).length > 0);
  await docker('volume', 'create', '--label', `leobridge.acceptance=${project}`, restoredVolume);
  await docker('run', '--rm', '--network', 'none', '--user', '0', '--entrypoint', 'sh', '-v', `${restoredVolume}:/data`, '-v', `${directory}:/backup:ro`, image, '-c', 'tar -C /data -xzf /backup/theme-store.tgz && chown -R 1000:1000 /data && chmod 700 /data');
  const afterRestore = await volumeManifest(restoredVolume, 'restored-manifest.json');
  check('restored-entire-volume-file-manifest', JSON.stringify(beforeBackup) === JSON.stringify(afterRestore), {
    before_files: beforeBackup.length, after_files: afterRestore.length, includes_state_and_both_theme_scripts: true,
    comparison: 'every relative path, byte length and SHA-256 before application restart',
  });
  config.volumes['theme-store'].name = restoredVolume; config.services.app.image = imageInfo.Id;
  await writeFile(file, JSON.stringify(config, null, 2));
  await compose('up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '60', 'app', 'nginx');
  check('restore-new-volume-pinned-image', (await state()).active === komari.id && (await request(display, '/')).headers.location === `https://${komariHost}/`);
  const restoredAsset = await request(komariHost, '/'); check('restored-package-readable', restoredAsset.status === 200 && restoredAsset.bytes.length > 1000);
  current = await state();
  const rollback = await request(admin, '/manage/api/rollback', { body: { generation: current.generation } });
  check('theme-rollback-after-restore', rollback.status === 200 && rollback.json.active === cfsm.id && (await request(display, '/')).headers.location === `https://${cfsmHost}/`);
  check('old-komari-retains-protocol', (await request(komariHost, '/api/nodes')).json.data.length === 3);
  check('logout', (await request(admin, '/manage/api/logout', { body: {} })).status === 200 && (await request(admin, '/manage/api/state')).status === 401);
} catch (error) {
  records.push({ case: 'run-failed', pass: false, message: String(error.message) }); console.error(error.message); process.exitCode = 1;
} finally {
  if (started) {
    await run('docker', ['rm', '-f', reservationName], true);
    await run('docker', ['compose', '-p', project, '-f', file, 'logs', '--no-color'], true);
    await run('docker', ['compose', '-p', project, '-f', file, 'down', '--volumes', '--remove-orphans'], true);
    for (const volume of [originalVolume, restoredVolume]) await run('docker', ['volume', 'rm', volume], true);
    const containers = await docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`);
    check('test-containers-cleaned', !containers.stdout.trim());
    const volumes = await docker('volume', 'ls', '--format', '{{.Name}}', '--filter', `name=${project}`);
    const networks = await docker('network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`);
    check('test-volumes-and-network-cleaned', !volumes.stdout.trim() && !networks.stdout.trim());
  }
  const summary = { scope: 'local-docker-nginx-synthetic', image, project, ports: { https: httpsPort, http: httpPort }, real_controller_accessed: false,
    cloud_or_vps_deployed: false, image_upgrade_executed: false, image_rollback_executed: false,
    certificate: 'temporary self-signed SAN; validated with explicit test CA', cases: records, all_checks_passed: records.every(item => item.pass) };
  await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ all_checks_passed: summary.all_checks_passed, evidence: directory }));
}
