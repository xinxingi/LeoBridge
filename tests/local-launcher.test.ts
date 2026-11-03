import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
test('runtime launcher never downloads or builds, even when runtime or artifacts are missing', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'leobridge launcher '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = join(dir, 'commands');
  await mkdir(bin); await mkdir(join(dir, 'dist'));
  await copyFile(join(root, 'deploy/local/leobridge.sh'), join(dir, 'leobridge.sh'));
  const dirname = spawnSync('/bin/sh', ['-c', 'command -v dirname'], { encoding: 'utf8' }).stdout.trim();
  await symlink(dirname, join(bin, 'dirname'));
  for (const tool of ['curl', 'wget', 'npm', 'pnpm', 'corepack', 'git']) {
    await writeFile(join(bin, tool), `#!/bin/sh\necho invoked >> ${quote(join(dir, 'network-or-build'))}\nexit 99\n`, { mode: 0o700 });
  }
  const launch = (command = 'start') => spawnSync('/bin/bash', [join(dir, 'leobridge.sh'), command], { env: { PATH: bin }, encoding: 'utf8' });
  assert.equal(launch('install').status, 2);
  assert.equal(launch().status, 1);
  assert.match(launch().stderr, /完整运行包/);
  await mkdir(join(dir, 'runtime/bin'), { recursive: true });
  // Synthetic packaged runtime; no system Node is on PATH.
  await writeFile(join(dir, 'runtime/bin/node'), `#!/bin/sh\nexec ${quote(process.execPath)} "$@"\n`, { mode: 0o700 });
  assert.equal(launch().status, 1, 'a bundled runtime does not trigger a missing build');
  await writeFile(join(dir, 'dist/local-service.js'), 'console.log("packaged manager " + process.argv[2] + " cwd=" + process.cwd());');
  const started = launch();
  assert.equal(started.status, 0, started.stderr);
  assert.match(started.stdout, /packaged manager start/);
  await rm(join(dir, 'runtime/bin/node'));
  assert.equal(launch().status, 1, 'broken runtime must not silently fall back or install');
  // The same launcher in a source checkout must resolve the project root from any cwd.
  await mkdir(join(dir, 'deploy/local'), { recursive: true });
  await mkdir(join(dir, 'scripts'));
  await writeFile(join(dir, 'scripts/local-service.ts'), '// source checkout marker');
  await writeFile(join(dir, 'package.json'), '{"type":"module"}');
  await copyFile(join(dir, 'leobridge.sh'), join(dir, 'deploy/local/leobridge.sh'));
  await symlink(process.execPath, join(dir, 'runtime/bin/node'));
  const sourceLaunch = spawnSync('/bin/bash', [join(dir, 'deploy/local/leobridge.sh'), 'start'], { cwd: tmpdir(), env: { PATH: bin }, encoding: 'utf8' });
  assert.equal(sourceLaunch.status, 0, sourceLaunch.stderr);
  assert.ok(sourceLaunch.stdout.includes('cwd=' + await realpath(dir)));
  await assert.rejects(readFile(join(dir, 'network-or-build')));
});
