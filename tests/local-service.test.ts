import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer, createConnection } from 'node:net';
import { transform } from 'esbuild';

const source = resolve(import.meta.dirname, '..');
const application = `
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
if(process.env.FAIL_START)process.exit(1);
writeFileSync('supervisor',String(process.ppid));
const server=createServer((req,res)=>res.end('synthetic'));
server.listen(0,'127.0.0.1',()=>process.send({type:'ready',admin:'http://127.0.0.1:'+server.address().port+'/admin/'}));
function stop(){writeFileSync('stopped','yes');server.close();if(process.connected)process.disconnect();}
process.on('SIGTERM',stop);process.on('disconnect',stop);
`;
async function command(root: string, action: string, extra: Record<string,string> = {}, quiet = false) {
  const child = spawn('bash', [join(root, 'leobridge.sh'), action, ...(quiet ? ['--quiet'] : [])], {
    cwd: tmpdir(), env: { PATH: `${resolve(process.execPath, '..')}:${process.env.PATH}`, ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stdout.on('data', data => out += data); child.stderr.on('data', data => err += data);
  const code = await new Promise<number | null>((done, reject) => { child.on('error', reject); child.on('exit', done); });
  return { code, out, err };
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'leobridge local '));
  for (const dir of ['work/local', 'dist/bundled/_management', 'node_modules']) await mkdir(join(root, dir), { recursive: true });
  await copyFile(join(source, 'leobridge.sh'), join(root, 'leobridge.sh'));
  await writeFile(join(root, 'dist/local-service.js'), (await transform(await readFile(join(source, 'scripts/local-service.ts'), 'utf8'), {loader:'ts',format:'esm',target:'node24'})).code);
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', packageManager: 'pnpm@11.25.0' }));
  await writeFile(join(root, 'dist/bundled/_management/index.html'), 'synthetic');
  await writeFile(join(root, 'dist/node.js'), application);
  await writeFile(join(root, 'dist/bundled/index.json'), '[]');
  t.after(async () => { await command(root, 'stop'); await rm(root, { recursive: true, force: true }); });
  return root;
}
async function state(root: string) { return JSON.parse(await readFile(join(root, 'work/local/service.json'), 'utf8')) as { pid: number; port: number; token: string; admin: string }; }
async function eventually(check: () => Promise<boolean>) { for (let n = 0; n < 100; n++) { if (await check()) return; await delay(30); } assert.fail('condition timed out'); }

test('local manager: detached lifecycle, quiet output, duplicate start, state permissions and restart', { timeout: 20_000 }, async t => {
  const root = await fixture(t);
  assert.equal((await command(root, 'status')).code, 3);
  const started = await command(root, 'start', {}, true);
  assert.deepEqual(started, { code: 0, out: '', err: '' });
  const first = await state(root);
  assert.equal((await fetch(first.admin)).status, 200);
  assert.equal((await stat(join(root, 'work/local/service.json'))).mode & 0o777, 0o600);
  assert.equal((await command(root, 'start')).code, 0);
  assert.equal((await state(root)).pid, first.pid);
  assert.equal((await command(root, 'status')).code, 0);
  assert.equal((await command(root, 'install')).code, 2);
  assert.equal((await command(root, 'restart')).code, 0);
  assert.notEqual((await state(root)).pid, first.pid);
  assert.equal(await readFile(join(root, 'stopped'), 'utf8'), 'yes');
  assert.equal((await command(root, 'stop')).code, 0);
  assert.equal((await command(root, 'stop')).code, 0);
  assert.equal((await command(root, 'status', {}, true)).code, 3);
});

test('local manager: failed startup is an error with logs and no running state', { timeout: 15_000 }, async t => {
  const root = await fixture(t);
  const result = await command(root, 'start', { FAIL_START: '1' }, true);
  assert.equal(result.code, 1);
  assert.match(result.err, /启动失败/);
  assert.equal((await command(root, 'status')).code, 3);
  assert.equal((await command(root, 'start')).code, 0);
});

test('local manager: stale PID never signals an unrelated process; control authentication fails closed', { timeout: 15_000 }, async t => {
  const root = await fixture(t);
  const unrelated: ChildProcess = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  t.after(() => unrelated.kill());
  const reservation = createServer();
  await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(done => reservation.close(() => done()));
  await writeFile(join(root, 'work/local/service.json'), JSON.stringify({ pid: unrelated.pid, port, token: 'a'.repeat(64) }));
  assert.equal((await command(root, 'stop')).code, 1);
  assert.equal((await command(root, 'start')).code, 1);
  assert.equal(unrelated.exitCode, null);
  await rm(join(root, 'work/local/service.json'));
  assert.equal((await command(root, 'start')).code, 0);
  const running = await state(root);
  await writeFile(join(root, 'work/local/service.json'), JSON.stringify({ ...running, token: 'b'.repeat(64) }));
  assert.equal((await command(root, 'stop')).code, 1);
  assert.equal((await fetch(running.admin)).status, 200);
  await writeFile(join(root, 'work/local/service.json'), JSON.stringify(running));
});

test('local manager: concurrent starts cannot create two applications', { timeout: 20_000 }, async t => {
  const root = await fixture(t);
  const results = await Promise.all([command(root, 'start'), command(root, 'start')]);
  assert.ok(results.some(result => result.code === 0));
  assert.ok(results.every(result => result.code === 0 || /另一个管理命令/.test(result.err)));
  assert.equal((await command(root, 'status')).code, 0);
});

test('local manager: an old draining supervisor cannot remove restarted service state', { timeout: 20_000 }, async t => {
  const root = await fixture(t);
  assert.equal((await command(root, 'start')).code, 0);
  const first = await state(root), supervisor = Number(await readFile(join(root, 'supervisor'), 'utf8'));
  const held = createConnection({ host: '127.0.0.1', port: first.port });
  held.on('error', () => {}); t.after(() => held.destroy());
  await new Promise<void>(done => held.once('connect', done));
  assert.equal((await command(root, 'restart')).code, 0);
  const second = await state(root);
  held.destroy();
  await eventually(async () => { try { process.kill(supervisor, 0); return false; } catch { return true; } });
  assert.equal((await state(root)).pid, second.pid);
  assert.equal((await command(root, 'status')).code, 0);
});

test('local manager: missing assets fail without installing dependencies or rebuilding', { timeout: 15_000 }, async t => {
  const root = await fixture(t);
  await rm(join(root, 'dist/bundled/_management/index.html'));
  const failed = await command(root, 'start');
  assert.equal(failed.code, 1);
  assert.match(failed.err, /运行文件不完整/);
  await assert.rejects(readFile(join(root, 'work/local/install.log')));
  await writeFile(join(root, 'dist/bundled/_management/index.html'), 'restored');
  assert.equal((await command(root, 'start')).code, 0);
});

test('local manager: unexpected application exit clears status', { timeout: 15_000 }, async t => {
  const root = await fixture(t);
  assert.equal((await command(root, 'start')).code, 0);
  process.kill((await state(root)).pid, 'SIGKILL');
  await eventually(async () => (await command(root, 'status')).code === 3);
  assert.equal((await command(root, 'start')).code, 0);
});
