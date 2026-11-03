/** Runtime-only lifecycle manager. Shipped as compiled JavaScript in distributions. */
import { spawn } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, open, stat, rename, chmod } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const directory = join(root, 'work/local');
const statePath = join(directory, 'service.json');
const logPath = join(directory, 'service.log');
const quiet = process.argv.includes('--quiet');
type State = { token: string; port: number; pid: number; startedAt: string; admin: string };
type Reply = { ok: boolean; pid?: number; startedAt?: string; admin?: string };
const say = (message: string) => { if (!quiet) console.log(message); };
async function exists(path: string) { try { await stat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
async function readState(): Promise<State | undefined> {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8')) as State;
    if (!Number.isInteger(value.pid) || value.pid < 1 || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token)) throw new Error();
    return value;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`服务记录损坏，请检查 ${statePath}；不会按记录中的 PID 杀进程。`);
  }
}
async function request(state: State, command: 'status' | 'stop'): Promise<Reply | undefined> {
  return new Promise((done, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: state.port });
    let data = '';
    socket.setTimeout(command === 'stop' ? 15_000 : 3000);
    socket.on('connect', () => socket.write(JSON.stringify({ token: state.token, command }) + '\n'));
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') {
        // An orphan may still be draining. PID checks only block a new writer; never signal it.
        try { process.kill(state.pid, 0); reject(new Error('控制连接不可达，但记录的进程仍存在；请等待退出或人工核对，未执行启停。')); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') done(undefined); else reject(new Error('无法确认原进程是否退出。')); }
      }
      else reject(new Error('无法确认服务状态，操作已停止。'));
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('服务控制请求超时；未按 PID 强制终止，请检查日志。')); });
    socket.on('data', chunk => {
      data += chunk;
      if (data.length > 8192) { socket.destroy(); reject(new Error('服务控制响应无效。')); }
      else if (data.includes('\n')) {
        socket.end();
        try { const reply = JSON.parse(data.trim()) as Reply; if (!reply.ok) throw new Error(); done(reply); }
        catch { reject(new Error('服务控制身份校验失败；未操作该端口上的进程。')); }
      }
    });
    socket.on('end', () => { if (!data.includes('\n')) reject(new Error('服务控制连接提前关闭。')); });
  });
}
async function current() {
  const state = await readState();
  return state && await request(state, 'status') ? state : undefined;
}
async function requireArtifacts() {
  for (const path of ['dist/node.js', 'dist/bundled/index.json', 'dist/bundled/_management/index.html', 'node_modules']) {
    if (!await exists(join(root, path))) throw new Error('运行文件不完整，请重新解压完整运行包；源码构建见 docs/development/build.md。');
  }
}
async function start() {
  const running = await current();
  if (running) { say(`LeoBridge 已运行（PID ${running.pid}）。管理后台：${running.admin}`); return; }
  await requireArtifacts();
  if (await exists(logPath) && (await stat(logPath)).size > 5 * 1024 * 1024) await rename(logPath, logPath + '.1');
  const log = await open(logPath, 'a', 0o600);
  await chmod(logPath, 0o600);
  const child = spawn(process.execPath, [import.meta.filename, '__serve'], {
    cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd, 'ipc'], env: process.env,
  });
  await log.close();
  try {
    const state = await new Promise<State>((done, reject) => {
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`启动超时，请查看 ${logPath}。`)); }, 30_000);
      child.once('error', () => { clearTimeout(timer); reject(new Error(`无法启动，请查看 ${logPath}。`)); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`启动失败，请查看 ${logPath}。`)); });
      child.once('message', message => { clearTimeout(timer); done(message as State); });
    });
    say(`LeoBridge 已后台启动（PID ${state.pid}）。管理后台：${state.admin}`);
    say('查看状态：./leobridge.sh status；查看日志：./leobridge.sh logs');
  } finally { if (child.connected) child.disconnect(); child.unref(); }
}
async function stop() {
  const state = await readState();
  if (!state || !await request(state, 'stop')) { say('LeoBridge 已停止。'); return; }
  // The supervisor replies only after the application has exited and state is removed.
  say('LeoBridge 已停止。');
}
async function serve() {
  const token = randomBytes(32).toString('hex');
  let state: State | undefined;
  let stopping = false;
  let exited = false;
  const child = spawn(process.execPath, [join(root, 'dist/node.js')], { cwd: root, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: process.env });
  const ended = new Promise<void>(done => child.once('exit', () => { exited = true; done(); }));
  const shutdown = async () => {
    if (!stopping) {
      stopping = true;
      child.kill('SIGTERM');
      const deadline = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 10_000);
      deadline.unref();
      await ended;
      clearTimeout(deadline);
    } else await ended;
  };
  const server = createServer(socket => {
    socket.setTimeout(15_000, () => socket.destroy());
    let input = '', handled = false;
    socket.on('error', () => {});
    socket.on('data', chunk => {
      input += chunk;
      if (input.length > 1024) { socket.destroy(); return; }
      if (handled || !input.includes('\n')) return;
      handled = true;
      void (async () => {
        let command: string;
        try {
          const value = JSON.parse(input.trim());
          if (typeof value.token !== 'string' || value.token.length !== token.length || !timingSafeEqual(Buffer.from(value.token), Buffer.from(token))) throw new Error();
          command = value.command;
          if (!state || !['status', 'stop'].includes(command)) throw new Error();
        } catch { socket.end('{"ok":false}\n'); return; }
        if (command === 'stop') { await shutdown(); socket.end('{"ok":true}\n'); }
        else socket.end(JSON.stringify({ ok: !stopping, pid: state!.pid, startedAt: state!.startedAt, admin: state!.admin }) + '\n');
      })().catch(() => socket.destroy());
    });
  });
  const cleanup = () => {
    // A draining old supervisor must not remove a newly restarted instance's record.
    try { if (JSON.parse(readFileSync(statePath, 'utf8')).token === token) unlinkSync(statePath); }
    catch { /* absent or no longer ours */ }
  };
  process.once('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void shutdown(); });
  // A killed supervisor closes IPC; the application must also stop (see node.ts).
  child.once('error', () => { console.error('LeoBridge application could not start.'); process.exitCode = 1; server.close(); });
  child.once('exit', code => { cleanup(); server.close(); if (!stopping) process.exitCode = code || 1; });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const ready = await new Promise<{ admin: string }>((done, reject) => {
    child.once('message', message => { if ((message as { type?: string }).type === 'ready') done(message as { admin: string }); });
    child.once('exit', () => reject(new Error('Application exited before ready.')));
    child.once('error', reject);
  });
  if (stopping || exited) return;
  state = { token, port: (server.address() as { port: number }).port, pid: child.pid!, startedAt: new Date().toISOString(), admin: ready.admin };
  await writeFile(statePath + '.tmp', JSON.stringify(state), { mode: 0o600 });
  await rename(statePath + '.tmp', statePath);
  process.send?.(state);
}
async function main() {
  process.umask(0o077);
  process.chdir(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const command = process.argv[2] || 'start';
  if (command === '__serve') { await serve(); return; }
  if (command === 'logs') {
    if (!await exists(logPath)) { say('暂无运行日志。'); return; }
    const file = await open(logPath, 'r');
    try {
      const size = (await file.stat()).size, buffer = Buffer.alloc(Math.min(size, 64 * 1024));
      await file.read(buffer, 0, buffer.length, size - buffer.length);
      say(buffer.toString('utf8').split('\n').slice(-101).join('\n'));
    } finally { await file.close(); }
    return;
  }
  if (command === 'status') {
    const state = await current();
    say(state ? `LeoBridge 运行中（PID ${state.pid}），启动于 ${state.startedAt}\n管理后台：${state.admin}\n日志：${logPath}` : 'LeoBridge 未运行。');
    if (!state) process.exitCode = 3;
    return;
  }
  if (!['start', 'stop', 'restart'].includes(command)) throw new Error('未知命令。');
  const lock = join(directory, 'command.lock');
  try { await mkdir(lock); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    throw new Error(`另一个管理命令正在执行；若曾异常中断，确认任务已结束后移除 ${lock}。`);
  }
  try {
    await writeFile(join(lock, 'owner'), String(process.pid));
    if (command === 'stop' || command === 'restart') await stop();
    if (command === 'start' || command === 'restart') await start();
  } finally { await rm(lock, { recursive: true, force: true }); }
}
main().catch(error => {
  // Serve failures are logged; never print inherited environment or control tokens.
  if (process.argv[2] === '__serve') { console.error('LeoBridge service startup failed.'); process.exit(1); }
  console.error(error instanceof Error ? error.message : '本地管理命令失败。');
  process.exitCode = 1;
});
