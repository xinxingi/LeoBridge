/** Smoke-test actual distribution artifacts against isolated synthetic state. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdtemp, readFile, readdir, rm, mkdir, symlink, access } from 'node:fs/promises';
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
let start, restart, stop, logs;
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
    start = async () => { await command('start'); await command('status'); };
    restart = async () => { await command('restart'); await command('status'); };
    stop = () => command('stop');
    logs = async () => (await readFile(join(root, 'work/local/service.log'), 'utf8')).slice(-12_000);
  } else {
    const name = 'leobridge-release-' + randomBytes(6).toString('hex');
    const docker = args => run('docker', args);
    start = () => docker(['run', '-d', '--name', name, '--init', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '-p', `127.0.0.1:${port}:8787`,
      '-e', 'BRIDGE_NODE_MODE=direct', '-e', 'BRIDGE_ROUTING=single', '-e', `BRIDGE_ORIGIN=${origin}`,
      '-e', 'BRIDGE_ACCESS=public', '-e', 'BRIDGE_LISTEN_HOST=0.0.0.0', '-e', 'BRIDGE_LISTEN_PORT=8787',
      '-e', 'BRIDGE_THEME_STORE=/data/theme-store', '-v', `${name}:/data/theme-store`, artifact]);
    restart = () => docker(['restart', name]);
    stop = async () => {
      await docker(['rm', '-f', name]).catch(() => {});
      await docker(['volume', 'rm', name]);
    };
    logs = async () => (await docker(['logs', '--tail', '100', name])).stdout;
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
  console.log(`${mode}: startup, default password change, restart and saved credentials passed (synthetic only).`);
} catch (error) {
  if (started && logs) console.error(await logs().catch(() => 'No application log available.'));
  throw error;
} finally {
  if (started) await stop();
  await rm(temp, { recursive: true, force: true });
}
