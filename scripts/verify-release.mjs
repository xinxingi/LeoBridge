/** Smoke-test actual distribution artifacts against isolated synthetic state. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdtemp, readFile, readdir, rm, mkdir, symlink, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const [mode, artifact] = process.argv.slice(2);
assert.ok(['package', 'image'].includes(mode) && artifact, 'Usage: node scripts/verify-release.mjs package <archive> | image <image>');
const temp = await mkdtemp(join(tmpdir(), 'leobridge-release-check-'));
const reservation = createServer();
await new Promise(done => reservation.listen(0, '127.0.0.1', done));
const port = reservation.address().port;
await new Promise(done => reservation.close(done));
const origin = `http://127.0.0.1:${port}`;
const run = (file, args, options = {}) => exec(file, args, { timeout: 60_000, maxBuffer: 1024 * 1024, ...options });
let start, restart, stop, logs, stateDirectory;
let started = false;
try {
  if (mode === 'package') {
    const archive = resolve(artifact);
    const expected = (await readFile(archive + '.sha256', 'utf8')).trim();
    assert.equal(expected, `${createHash('sha256').update(await readFile(archive)).digest('hex')}  ${basename(archive)}`);
    await run('tar', ['-xzf', archive, '-C', temp]);
    const directories = await readdir(temp);
    assert.equal(directories.length, 1);
    const root = join(temp, directories[0]);
    stateDirectory=join(root,'data');
    const metadata = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'));
    assert.equal(metadata.platform, process.platform); assert.equal(metadata.arch, process.arch);
    for (const path of ['.dev.vars', 'src', 'work', 'runtime/bin/npm', 'runtime/bin/pnpm']) {
      await assert.rejects(access(join(root, path)), { code: 'ENOENT' });
    }
    const bin = join(temp, 'tools'); await mkdir(bin);
    // The launcher gets only shell utilities; Node/npm/pnpm are not on its PATH.
    await symlink('/bin/bash', join(bin, 'bash'));
    await symlink('/usr/bin/dirname', join(bin, 'dirname'));
    const env = { PATH: bin, BRIDGE_LISTEN_PORT: String(port), BRIDGE_ORIGIN: origin };
    const command = action => run('/bin/bash', [join(root, 'leobridge.sh'), action, '--quiet'], { cwd: root, env });
    start = async () => {
      const check=await run(join(root,'runtime/bin/node'),[join(root,'dist/node.js'),'--check-config'],{cwd:root,env});
      assert.equal(JSON.parse(check.stdout).valid,true);
      await command('start'); await command('status');
    };
    restart = async () => { await command('restart'); await command('status'); };
    stop = () => command('stop');
    logs = async () => (await readFile(join(root, 'work/local/service.log'), 'utf8')).slice(-12_000);
  } else {
    const name = 'leobridge-release-' + randomBytes(6).toString('hex');
    // Exercise the shipped Compose template, not a second hand-maintained docker run.
    const template=await readFile(new URL('../deploy/docker/compose.yaml',import.meta.url),'utf8');
    assert.ok(template.includes("'127.0.0.1:8787:8787'"));
    await writeFile(join(temp,'compose.yaml'),template.replace("'127.0.0.1:8787:8787'",`'127.0.0.1:${port}:8787'`).replace('BRIDGE_ORIGIN: http://127.0.0.1:8787',`BRIDGE_ORIGIN: ${origin}`));
    await writeFile(join(temp,'override.json'),JSON.stringify({services:{app:{image:artifact}}}));
    await writeFile(join(temp,'.env'),'');
    await mkdir(join(temp,'data'),{mode:0o700});
    await mkdir(join(temp,'tmp'),{mode:0o700});
    stateDirectory=join(temp,'data');
    const compose=(...args)=>run('docker',['compose','--project-name',name,'--env-file',join(temp,'.env'),'-f',join(temp,'compose.yaml'),'-f',join(temp,'override.json'),...args],{env:{PATH:process.env.PATH,HOME:process.env.HOME,DOCKER_HOST:process.env.DOCKER_HOST,DOCKER_CONTEXT:process.env.DOCKER_CONTEXT,DOCKER_CONFIG:process.env.DOCKER_CONFIG}});
    start = async()=>{
      const config=JSON.parse((await compose('config','--format','json')).stdout);
      assert.equal(config.services.app.ports[0].host_ip,'127.0.0.1');
      assert.equal(config.services.app.environment.BRIDGE_ORIGIN,origin);
      assert.deepEqual(Object.keys(config.services.app.environment),['BRIDGE_ORIGIN']);
      assert.equal(config.services.app.tmpfs,undefined);
      for(const directory of ['data','tmp']){
        const mount=config.services.app.volumes.find(value=>value.target===`/${directory}`);
        assert.equal(mount.type,'bind');
        assert.equal(mount.source,join(temp,directory));
      }
      // Same UID/GID as the shipped image; only this isolated test directory is changed.
      await compose('run','--rm','--no-deps','--pull','never','--user','0','--cap-add','CHOWN','app','chown','1000:1000','/data','/tmp');
      await compose('run','--rm','--no-deps','--pull','never','app','node','-e',"require('node:fs').writeFileSync('/tmp/disk-check','disk')");
      await compose('run','--rm','--no-deps','--pull','never','app','node','-e',"if(require('node:fs').readFileSync('/tmp/disk-check','utf8')!=='disk')process.exit(1)");
      const check=await compose('run','--rm','--no-deps','--pull','never','app','node','dist/node.js','--check-config');
      assert.equal(JSON.parse(check.stdout).valid,true);
      const httpsCheck=JSON.parse((await compose('run','--rm','--no-deps','--pull','never','-e','BRIDGE_ORIGIN=https://monitor.example.test','app','node','dist/node.js','--check-config')).stdout);
      assert.equal(httpsCheck.mode,'direct');
      assert.equal(httpsCheck.routing,'single');
      assert.equal(httpsCheck.listenHost,'0.0.0.0');
      assert.equal(httpsCheck.listenPort,8787);
      await assert.rejects(compose('run','--rm','--no-deps','--pull','never','-e','BRIDGE_ORIGIN=https://monitor.example.test/admin/','app','node','dist/node.js','--check-config'),error=>{
        assert.match(error.stderr,/MANAGEMENT_CONFIGURATION/);return true;
      });
      await compose('up','-d','--no-build','--pull','never','app');
    };
    restart = ()=>compose('up','-d','--no-build','--pull','never','--force-recreate','app');
    stop = async()=>{
      await compose('down','--remove-orphans');
      // Restore ownership so the CI account can remove its temporary bind directory.
      try{await compose('run','--rm','--no-deps','--pull','never','--user','0','--cap-add','CHOWN','--cap-add','DAC_OVERRIDE','app','chown','-R',`${process.getuid()}:${process.getgid()}`,'/data','/tmp');}
      finally{await compose('down','--remove-orphans');}
    };
    logs = async () => (await compose('logs','--no-color','--tail','100','app')).stdout;
  }
  async function ready() {
    for (let i = 0; i < 60; i++) {
      try {
        const response = await fetch(origin + '/admin/', { signal: AbortSignal.timeout(1500) });
        if (response.ok && /<html/i.test(await response.text())) return;
      } catch { /* process still starting */ }
      await delay(250);
    }
    throw new Error('Distribution did not serve the management page');
  }
  let cookie = '', csrf = '';
  async function api(path, body) {
    const response = await fetch(origin + '/admin/api/' + path, {
      method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200, `Unexpected status for ${path}`);
    const data = await response.json();
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (data.csrf) csrf = data.csrf;
    return data;
  }
  started = true;
  await start(); await ready();
  assert.equal((await api('login', { username: 'admin', password: 'admin' })).mustChangePassword, true);
  const password = 'Release-Test-' + randomBytes(12).toString('hex') + '!';
  await api('password', { currentPassword: 'admin', newPassword: password, confirmPassword: password });
  await restart(); await ready(); cookie = ''; csrf = '';
  assert.equal((await api('login', { username: 'admin', password })).mustChangePassword, false);
  assert.equal((await api('source')).configured, false);
  // Also verify the user-visible directory, not just in-memory API behavior.
  // Container files are UID 1000/private; read inside the container via persistence checks above.
  if(mode==='package')assert.ok(JSON.parse(await readFile(join(stateDirectory,'state.json'),'utf8')).adminCredential);
  console.log(`${mode}: startup, default password change, restart and saved credentials passed (synthetic only).`);
} catch (error) {
  if (started && logs) console.error(await logs().catch(() => 'No application log available.'));
  throw error;
} finally {
  if (started) await stop();
  await rm(temp, { recursive: true, force: true });
}
