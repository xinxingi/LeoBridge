import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, type UpstreamServer } from '../src/core/model.js';
import { parseBindings, resolveBindings, identityVector, IdentityError } from '../src/core/identity.js';

const snapshot = (servers: UpstreamServer[]) => normalizeSnapshot({ enabled: true, show_name: true, servers });
const bindings = [{ id: 'stable-a', match: { name: 'A' } }, { id: 'stable-b', match: { name: 'B' } }];
const hasCode = (code: string) => (error: unknown) => error instanceof IdentityError && error.code === code;

test('stable IDs survive array reordering while fresh historical indices change', () => {
  const before = snapshot([{ name: 'A' }, { name: 'B' }]);
  const after = snapshot([{ name: 'B' }, { name: 'A' }]);
  assert.deepEqual(resolveBindings(before, bindings).map(({ id, index }) => [id, index]), [['stable-a', 0], ['stable-b', 1]]);
  assert.deepEqual(resolveBindings(after, bindings).map(({ id, index }) => [id, index]), [['stable-b', 0], ['stable-a', 1]]);
  assert.notDeepEqual(identityVector(before, bindings), identityVector(after, bindings));
});

test('duplicate names fail closed unless explicit additional attributes distinguish them', () => {
  const source = snapshot([{ name: 'same', arch: 'arm64' }, { name: 'same', arch: 'x86_64' }]);
  assert.throws(() => resolveBindings(source, [{ id: 'one', match: { name: 'same' } }]), hasCode('IDENTITY_AMBIGUOUS'));
  assert.deepEqual(identityVector(source, [
    { id: 'arm', match: { name: 'same', arch: 'arm64' } },
    { id: 'x86', match: { name: 'same', arch: 'x86_64' } },
  ]), ['arm', 'x86']);
});

test('renames, removed identifying fields, unseen servers and overlapping selectors are rejected', () => {
  assert.throws(() => resolveBindings(snapshot([{ name: 'renamed' }, { name: 'B' }]), bindings), hasCode('IDENTITY_MISSING'));
  assert.throws(() => resolveBindings(snapshot([{ online: true }]), [bindings[0]!]), hasCode('IDENTITY_MISSING'));
  assert.throws(() => resolveBindings(snapshot([{ name: 'A' }, { name: 'B' }, { name: 'C' }]), bindings), hasCode('IDENTITY_UNBOUND'));
  assert.throws(() => resolveBindings(snapshot([{ name: 'A', arch: 'arm64' }]), [
    { id: 'one', match: { name: 'A' } }, { id: 'two', match: { arch: 'arm64' } },
  ]), hasCode('IDENTITY_OVERLAP'));
});

test('binding config rejects positions, dynamic metrics, blanks, duplicate IDs and malformed JSON', () => {
  for (const config of [
    'bad json', {}, [{ id: 'a', match: {} }], [{ id: 'a', match: { index: 0 } }],
    [{ id: 'a', match: { cpu_pct: 0 } }], [{ id: 'a', match: { name: '' } }],
    [{ id: '../path', match: { name: 'A' } }], [{ id: 'a', match: { name: 'A' } }, { id: 'a', match: { name: 'B' } }],
  ]) assert.throws(() => parseBindings(config), hasCode('INVALID_IDENTITY_CONFIG'));
  assert.deepEqual(parseBindings(JSON.stringify(bindings)), bindings);
});

test('empty lists and disabled probes do not publish stale bindings or servers', () => {
  assert.deepEqual(resolveBindings(snapshot([]), []), []);
  const disabled = normalizeSnapshot({ enabled: false, servers: [{ name: 'A' }] });
  assert.deepEqual(resolveBindings(disabled, bindings), []);
});

test('identity errors omit selector values and names', () => {
  let caught: unknown;
  try { resolveBindings(snapshot([{ name: 'secret' }, { name: 'secret' }]), [{ id: 'id', match: { name: 'secret' } }]); }
  catch (error) { caught = error; }
  assert.ok(caught instanceof IdentityError);
  assert.equal(caught.status, 409);
  assert.equal(String(caught).includes('secret'), false);
});
