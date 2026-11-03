import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Execute the actual workflow shell against a fake gh; never publish from tests.
const workflow = await readFile(new URL('../.github/workflows/docker-release.yml', import.meta.url), 'utf8');
const step = workflow.split('      - name: Create or reuse release and upload verified packages\n')[1];
assert.ok(step, 'Release upload step must exist');
const script = step.split('        run: |\n')[1].split('\n')
  .filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');
const assets = ['leobridge-0.1.0-linux-x64.tar.gz', 'leobridge-0.1.0-linux-x64.tar.gz.sha256',
  'leobridge-0.1.0-linux-arm64.tar.gz', 'leobridge-0.1.0-linux-arm64.tar.gz.sha256',
  'checksums.txt', 'compose.yaml', 'docker.env.example'];

async function run(t: TestContext, releases: string, version = '0.1.0', mutationExit = 0, queryExit = 0) {
  const root = await mkdtemp(join(tmpdir(), 'leobridge release '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'release-assets'));
  for (const asset of assets) await writeFile(join(root, 'release-assets', asset), 'synthetic');
  await writeFile(join(root, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args[0] === 'api') {
  process.stdout.write(${JSON.stringify(releases)});
  process.exit(${queryExit});
}
if (args[0] !== 'release' || !['create', 'upload'].includes(args[1])) process.exit(99);
process.exit(${mutationExit});
`, { mode: 0o755 });
  const result = spawnSync('/bin/bash', ['-c', script], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { PATH: `${root}:/usr/bin:/bin`, GITHUB_REPOSITORY: 'example/leobridge',
      RELEASE_TAG: `v${version}`, RELEASE_VERSION: version, IMAGE_DIGEST: 'sha256:synthetic' },
  });
  assert.ifError(result.error);
  const calls: string[][] = (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls[0], ['api', '--paginate', 'repos/example/leobridge/releases?per_page=100', '--jq', '.[].tag_name']);
  return { ...result, calls, root };
}

test('existing release uploads the full verified asset set without recreating or editing metadata', async t => {
  const result = await run(t, 'v0.2.0\nv0.1.0\nv0.0.1\n');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.slice(1), [['release', 'upload', 'v0.1.0',
    ...assets.map(asset => `release-assets/${asset}`).sort(), '--clobber']]);
});

for (const version of ['0.1.0', '0.1.1-rc.1']) {
  test(`missing release creates ${version} with notes and correct prerelease flag`, async t => {
    const result = await run(t, `v${version}-other\nv9${version}\n`, version);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 2);
    const create = result.calls[1];
    assert.deepEqual(create.slice(0, 3), ['release', 'create', `v${version}`]);
    assert.deepEqual(create.slice(3, 3 + assets.length), assets.map(asset => `release-assets/${asset}`).sort());
    assert.ok(create.includes('--verify-tag'));
    assert.ok(create.includes('--generate-notes'));
    assert.equal(create.includes('--prerelease'), version.includes('-'));
    const notes = await readFile(join(result.root, 'release-notes.md'), 'utf8');
    assert.ok(notes.includes(`staractive/leobridge:${version}`));
    assert.ok(notes.includes('sha256:synthetic'));
  });
}

for (const releases of ['', 'v0.2.0\n', 'v0.1.0\n']) {
  test(`failed query cannot publish, including partial pagination output ${JSON.stringify(releases)}`, async t => {
    const result = await run(t, releases, '0.1.0', 0, 1);
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 1);
  });
}

for (const releases of ['v0.1.0\n', '']) {
  test(`${releases ? 'upload' : 'create'} failure stays failed without a fallback mutation`, async t => {
    const result = await run(t, releases, '0.1.0', 17);
    assert.equal(result.status, 17);
    assert.equal(result.calls.length, 2);
  });
}

const latestStep = workflow.split('      - name: Update latest after image verification\n')[1]?.split('\n  release:')[0];
assert.ok(latestStep);
const latestScript = latestStep.split('        run: |\n')[1].split('\n')
  .filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');

for (const [version, failure] of [['0.2.1', false], ['0.2.1-rc.1', false], ['0.2.1', true]] as const) {
  test(`latest promotion: ${version}, failure=${failure}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'leobridge latest '));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, 'calls.jsonl'), '');
    await writeFile(join(root, 'gh'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    await writeFile(join(root, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync('calls.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(${failure ? 17 : 0});
`, { mode: 0o755 });
    const result = spawnSync('/bin/bash', ['-c', latestScript], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { PATH: `${root}:/usr/bin:/bin`, RELEASE_VERSION: version,
        IMAGE: `staractive/leobridge:${version}`, DIGEST: 'sha256:verified', GITHUB_STEP_SUMMARY: join(root, 'summary') },
    });
    assert.ifError(result.error);
    const calls = (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(result.status, failure ? 17 : 0);
    if (version.includes('-')) assert.deepEqual(calls, []);
    else {
      assert.deepEqual(calls[0], ['buildx', 'imagetools', 'create', '--tag', 'staractive/leobridge:latest', `staractive/leobridge:${version}@sha256:verified`]);
      assert.equal(calls.length, failure ? 1 : 2);
      if (!failure) assert.deepEqual(calls[1], ['buildx', 'imagetools', 'inspect', 'staractive/leobridge:latest']);
    }
  });
}
