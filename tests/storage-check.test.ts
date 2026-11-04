import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, chmod, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStorage, storageOperation } from '../src/runtime/storage-check.ts';
import { FileThemeStore } from '../src/runtime/file-theme-store.ts';
import { Admin } from '../src/management/admin.ts';
import { managementConfig } from '../src/management/config.ts';

test('storage probe preserves existing state and removes disposable files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bridge-storage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, 'data'), store = new FileThemeStore(data);
  await store.command({ type: 'session', id: 'fixture', session: { csrf: 'private-fixture', expires: Date.now() + 60_000 } });
  const before = await readFile(join(data, 'state.json'));
  await checkStorage(data);
  assert.deepEqual(await readFile(join(data, 'state.json')), before);
  assert.deepEqual(await readdir(data), ['state.json']);
});

test('unwritable data fails startup checks, and login reports actionable storage failure', async t => {
  if (process.getuid?.() === 0 || process.platform === 'win32') return t.skip('Requires unprivileged POSIX permissions');
  const root = await mkdtemp(join(tmpdir(), 'bridge-permission-'));
  const data = join(root, 'data');
  await mkdir(data);
  t.after(async () => { await chmod(data, 0o700); await rm(root, { recursive: true, force: true }); });
  await checkStorage(data);
  // A directory may lose permissions after a successful startup check.
  await chmod(data, 0o500);
  await assert.rejects(checkStorage(data), { code: 'STORAGE_PERMISSION' });
  const config = managementConfig({ BRIDGE_ORIGIN: 'https://admin.example.test' });
  const admin = new Admin(config, new FileThemeStore(data), async () => new Response('ui'));
  const login = () => admin.handle(new Request(config.adminOrigin + '/admin/api/login', {
    method: 'POST', headers: { Origin: config.adminOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  }));
  const failed = await login();
  assert.equal(failed.status, 503);
  const body = await failed.json();
  assert.equal(body.code, 'STORAGE_PERMISSION');
  assert.match(body.message, /UID\/GID.*勿删除数据/);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(root));
  await chmod(data, 0o700);
  assert.equal((await login()).status, 200);
  assert.equal(Object.keys((await new FileThemeStore(data).state()).sessions).length, 1);
});

test('known disk errors are classified without leaking raw errors; unrelated errors are preserved', async t => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args.join(' ')));
  for (const [errno, code] of [['ENOSPC', 'STORAGE_FULL'], ['EDQUOT', 'STORAGE_FULL'], ['EROFS', 'STORAGE_READ_ONLY'], ['EPERM', 'STORAGE_PERMISSION'], ['ENOTDIR', 'STORAGE_PATH'], ['EISDIR', 'STORAGE_PATH'], ['EIO', 'STORAGE_IO']]) {
    await assert.rejects(storageOperation(async () => { throw Object.assign(new Error('private-token-and-path'), { code: errno }); }), error => {
      assert.equal((error as { code: string }).code, code);
      assert.doesNotMatch(String(error), /private-token-and-path/);
      return true;
    });
  }
  assert.equal(logs.length, 7);
  assert.doesNotMatch(logs.join('\n'), /private-token-and-path/);
  const unknown = new Error('unrelated');
  await assert.rejects(storageOperation(async () => { throw unknown; }), error => error === unknown);
});

test('corrupt saved state is reported without disclosing or resetting it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bridge-invalid-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const logs: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args.join(' ')));
  const bytes = '{"token":"private-fixture"';
  await writeFile(join(root, 'state.json'), bytes);
  await assert.rejects(new FileThemeStore(root).state(), { code: 'STORAGE_INVALID_STATE' });
  assert.equal(await readFile(join(root, 'state.json'), 'utf8'), bytes);
  assert.doesNotMatch(logs.join('\n'), /private-fixture/);
});
