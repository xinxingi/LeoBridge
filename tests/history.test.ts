import test from 'node:test';
import assert from 'node:assert/strict';
import { History, systemRows, pingRows } from '../src/protocols/cfsm/history.ts';
import { readConfig } from '../src/core/config.ts';
import { normalizeSnapshot } from '../src/core/model.ts';
import { BridgeError } from '../src/core/errors.ts';
import type { Upstream } from '../src/upstream/client.ts';

const now = 1_793_620_923_000;
const seconds = Math.floor(now / 1000);
const config = () => readConfig({ MMWX_BASE_URL: 'https://upstream.example.test', BRIDGE_BINDINGS: JSON.stringify([
  { id: 'a', match: { name: 'A' } }, { id: 'b', match: { name: 'B' } },
]) });
const targets = { ct: { key: 'synthetic-target', label: 'Synthetic target' } };
const hasCode = (code: string) => (error: unknown) => error instanceof BridgeError && error.code === code;
const snapshot = (reordered = false, days = 7) => normalizeSnapshot({ enabled: true, show_name: true, history_days: days,
  servers: reordered ? [{ name: 'B' }, { name: 'A' }] : [{ name: 'A' }, { name: 'B' }],
}, now);
const system = (bucket = 300) => ({ success: true, bucket_sec: bucket, series: {
  cpu_pct: [{ t: seconds - 60, value: 0 }], mem_used: [{ t: seconds - 60, value: 2 ** 30 }],
} });

test('system history converts seconds/MiB/Bps, aligns only exact times and clips without invented points', () => {
  const rows = systemRows({ success: true, bucket_sec: 300, series: {
    cpu_pct: [{ t: seconds - 600, value: 10 }, { t: seconds - 60, value: 0 }, { t: seconds + 1, value: 20 }],
    mem_used: [{ t: seconds - 60, value: 2 ** 30 }],
    mem_total: [{ t: seconds - 120, value: 2 ** 31 }],
    download_speed: [{ t: seconds - 60, value: 2 ** 20 }],
    upload_speed: [{ t: seconds - 60, value: 0 }],
    cumulative_up: [{ t: seconds - 60, value: 999 }],
  } }, now - 300_000, now);
  assert.deepEqual(rows, [
    { timestamp: (seconds - 120) * 1000, ram_total: 2048 },
    { timestamp: (seconds - 60) * 1000, cpu: 0, ram_used: 1024, net_in_speed: 1048576, net_out_speed: 0 },
  ]);
  assert.equal('ram_total' in rows[1]!, false);
  assert.equal('net_tx' in rows[1]!, false);
});

test('system history preserves unavailable values and rejects invalid timestamps or duplicate samples', () => {
  assert.deepEqual(systemRows({ success: true, bucket_sec: 300, series: {
    cpu_pct: [{ t: seconds, value: 101 }], mem_used: [{ t: seconds, value: null }],
  } }, now - 1000, now), [{ timestamp: seconds * 1000, cpu: null, ram_used: null }]);
  for (const raw of [
    { ...system(), success: false }, { ...system(), bucket_sec: NaN }, { ...system(), bucket_sec: Infinity },
    { success: true, bucket_sec: 300, series: { cpu_pct: [{ t: now, value: 1 }] } },
    { success: true, bucket_sec: 300, series: { cpu_pct: [{ t: seconds, value: 1 }, { t: seconds, value: 2 }] } },
  ]) assert.throws(() => systemRows(raw, now - 3600_000, now), hasCode('UPSTREAM_HISTORY'));
});

test('Ping bucket timestamps follow the observed aligned-bucket algorithm; no-data differs from timeout and zero', () => {
  const aligned = Math.floor(seconds / 300) * 300;
  const rows = pingRows({ success: true, bucket_sec: 300, generated_at: seconds, all_series: [{
    key: 'synthetic-target', buckets: [{ ms: -1, loss: -1 }, { ms: -1, loss: 100 }, { ms: 0, loss: 0 }],
  }] }, targets, now - 3600_000, now);
  assert.deepEqual(rows, [
    { timestamp: (aligned - 600) * 1000, ping_ct: false, loss_ct: false },
    { timestamp: (aligned - 300) * 1000, ping_ct: null, loss_ct: 100 },
    { timestamp: aligned * 1000, ping_ct: 0, loss_ct: 0 },
  ]);
});

test('Ping conversion rejects invalid time units, bucket widths and duplicate target identities', () => {
  const base = { success: true, bucket_sec: 300, generated_at: seconds, all_series: [{ key: 'synthetic-target', buckets: [] }] };
  for (const raw of [
    { ...base, bucket_sec: NaN }, { ...base, bucket_sec: Infinity }, { ...base, generated_at: now },
    { ...base, all_series: [...base.all_series, ...base.all_series] },
  ]) assert.throws(() => pingRows(raw, targets, now - 3600_000, now), hasCode('UPSTREAM_HISTORY'));
  assert.deepEqual(pingRows({ ...base, all_series: [] }, targets, now - 3600_000, now), []);
});

test('history resolves the current index and discards replies if source order changes during the query', async () => {
  let snapshots = 0;
  let seenIndex: string | undefined;
  const upstream = {
    snapshot: async () => snapshot(++snapshots === 1),
    json: async (_path: string, params: Record<string, string>) => { seenIndex = params.server; return system(); },
  } as unknown as Upstream;
  const history = new History(upstream, config(), () => now);
  await assert.rejects(history.get('a', 1), hasCode('IDENTITY_CHANGED'));
  assert.equal(seenIndex, '1');
});

test('range validation uses retention capability and checks upstream bucket response rather than trusting HTTP success', async () => {
  let calls = 0;
  const upstream = {
    snapshot: async () => snapshot(false, 1),
    json: async () => { calls++; return system(); },
  } as unknown as Upstream;
  const history = new History(upstream, config(), () => now);
  await assert.rejects(history.get('a', 2), hasCode('HISTORY_RANGE'));
  await assert.rejects(history.get('a', 168), hasCode('HISTORY_RANGE'));
  assert.equal(calls, 0);
  const sevenDays = new History({ ...upstream, snapshot: async () => snapshot() } as unknown as Upstream, config(), () => now);
  await assert.rejects(sevenDays.get('a', 168), hasCode('UPSTREAM_HISTORY_RANGE'));
});

test('seven-day range is queried explicitly; short ranges crop source aggregates without extra samples', async () => {
  const seen: Record<string, string>[] = [];
  const upstream = {
    snapshot: async () => snapshot(),
    json: async (_path: string, params: Record<string, string>) => {
      seen.push(params);
      return system(params.range === '7d' ? 7200 : 300);
    },
  } as unknown as Upstream;
  const history = new History(upstream, config(), () => now);
  const long = await history.get('a', 168);
  assert.equal(seen[0]?.range, '7d');
  assert.equal(long.length, 1);
  const short = await history.get('a', 0.167);
  assert.equal(seen[1]?.range, '1h');
  assert.equal(short.length, 1);
});

test('history cache is bounded by age and identity vector; simultaneous reads are coalesced', async () => {
  let queryCount = 0;
  let time = now;
  let reordered = false;
  const upstream = {
    snapshot: async () => snapshot(reordered),
    json: async () => { queryCount++; return system(); },
  } as unknown as Upstream;
  const history = new History(upstream, config(), () => time);
  const [first, second] = await Promise.all([history.get('a', 1), history.get('a', 1)]);
  assert.equal(first, second);
  assert.equal(queryCount, 1);
  await history.get('a', 1); assert.equal(queryCount, 1);
  reordered = true;
  await history.get('a', 1); assert.equal(queryCount, 2);
  time += 30_001;
  await history.get('a', 1); assert.equal(queryCount, 3);
});

test('a failed historical response is not cached or turned into an empty success', async () => {
  let calls = 0;
  const upstream = {
    snapshot: async () => snapshot(),
    json: async () => { calls++; return calls === 1 ? { ...system(), success: false } : system(); },
  } as unknown as Upstream;
  const history = new History(upstream, config(), () => now);
  await assert.rejects(history.get('a', 1), hasCode('UPSTREAM_HISTORY'));
  assert.equal((await history.get('a', 1)).length, 1);
  assert.equal(calls, 2);
});
