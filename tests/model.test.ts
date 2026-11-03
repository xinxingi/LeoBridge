import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, normalizeServer, SnapshotError } from '../src/core/model.js';
import { toServer, toCfsmServer, regionCode } from '../src/protocols/cfsm/adapter.js';

const now = Date.parse('2026-11-02T12:00:00Z');

test('unified model uses neutral byte/second/percent units before the CFSM output boundary', () => {
  const raw = { name: 'synthetic', online: true, cpu_pct: 12.5, mem_used: 2 ** 30, mem_total: 2 ** 31,
    disk_used: 2 ** 32, disk_total: 2 ** 33, download_speed: 2 ** 20, upload_speed: 0,
    loadavg: '0.00 1.25 2.50', uptime: 100, cpu_threads: 8, cpu_cores: 4, tcp_connections: 0,
    last_seen: '2026-11-02T11:59:00Z', cpu_model: 'synthetic CPU', os: 'Linux', arch: 'arm64',
    kernel: 'synthetic kernel', region_country: 'us' };
  const unified = normalizeServer(raw, now, true);
  assert.equal(unified.cpuPercent, 12.5);
  assert.equal(unified.memoryUsedBytes, 2 ** 30);
  assert.equal(unified.memoryTotalBytes, 2 ** 31);
  assert.equal(unified.diskUsedBytes, 2 ** 32);
  assert.equal(unified.diskTotalBytes, 2 ** 33);
  assert.equal(unified.downloadBytesPerSecond, 2 ** 20);
  assert.equal(unified.uploadBytesPerSecond, 0);
  assert.deepEqual(unified.loadAverages, [0, 1.25, 2.5]);
  assert.equal(unified.uptimeSeconds, 100);
  assert.equal(unified.sourceLastSeen, now - 60_000);
  assert.equal(unified.observedAt, now);
  assert.equal(unified.metadata.logicalCpuCount, 8);
  assert.equal(unified.metadata.regionCode, 'US');
  for (const field of ['ram_used', 'net_in_speed', 'cpu_pct', 'boot_time', 'raw']) assert.equal(field in unified, false);
  const cfsm = toCfsmServer(unified, 'opaque');
  assert.deepEqual(cfsm, toServer(raw, 'opaque', now, true));
  assert.equal(cfsm.ram_used, 1024);
  assert.equal(cfsm.disk_total, 8192);
  assert.equal(cfsm.net_in_speed, 2 ** 20);
});

test('unified model retains unknowns and upstream name privacy without protocol-specific sentinel values', () => {
  const unified = normalizeServer({ name: 'hidden', cpu_pct: 0, mem_used: 0, token: 'private' }, now, false);
  assert.equal(unified.metadata.name, null);
  assert.equal(unified.online, null);
  assert.equal(unified.sourceLastSeen, null);
  assert.equal(unified.memoryUsedBytes, 0);
  assert.equal(unified.memoryTotalBytes, null);
  assert.equal(unified.cpuPercent, 0);
  assert.equal(unified.loadAverages, null);
  assert.equal(JSON.stringify(unified).includes('hidden'), false);
  assert.equal(JSON.stringify(unified).includes('private'), false);
});

test('load averages accept three metrics or a valid five-field Linux proc form without treating task counts as metrics', () => {
  for (const loadavg of ['0.00 1.25 2.50', '0.00 1.25 2.50 3/100 456', '  0.00\t1.25 2.50 3/100 456\n']) {
    const unified = normalizeServer({ loadavg }, now);
    assert.deepEqual(unified.loadAverages, [0, 1.25, 2.5]);
    assert.equal(toCfsmServer(unified, 'opaque').load_avg, '0 1.25 2.5');
  }
  for (const loadavg of ['0 1 2 3 456', '0 1 2 3/x 456', '0 1 2 3/100 pid', '0 1 2 3/100',
    '0 1 2 3/100 456 trailing', '-1 1 2 3/100 456', 'NaN 1 2 3/100 456']) {
    assert.equal(normalizeServer({ loadavg }, now).loadAverages, null, loadavg);
  }
});

test('snapshot validates business payload and preserves disabled / empty distinctions', () => {
  assert.throws(() => normalizeSnapshot({ success: true, servers: [] }, now), SnapshotError);
  assert.throws(() => normalizeSnapshot({ enabled: true, servers: [null] }, now), SnapshotError);
  assert.throws(() => normalizeSnapshot({ enabled: true }, now), SnapshotError);
  assert.deepEqual(normalizeSnapshot({ enabled: false, servers: [{ name: 'private' }] }, now).servers, []);
  const empty = normalizeSnapshot({ enabled: true, servers: [], history_days: 7 }, now);
  assert.equal(empty.enabled, true);
  assert.equal(empty.historyDays, 7);
  assert.equal(empty.showName, false);
  assert.equal(empty.observedAt, now);
});

test('capacities are binary MiB, speeds stay B/s, zeros survive, missing values stay unknown', () => {
  const server = toServer({ online: true, cpu_pct: 0, mem_used: 0, mem_total: 2 ** 31,
    disk_used: 2 ** 30, disk_total: 2 ** 40, download_speed: 2 ** 20, upload_speed: 0,
    cpu_cores: 4, cpu_threads: 8, tcp_connections: 0 }, 'opaque', now);
  assert.equal(server.cpu, 0);
  assert.equal(server.ram_used, 0);
  assert.equal(server.ram_total, 2048);
  assert.equal(server.disk_used, 1024);
  assert.equal(server.disk_total, 1048576);
  assert.equal(server.net_in_speed, 1048576);
  assert.equal(server.net_out_speed, 0);
  assert.equal(server.cpu_cores, 8);
  assert.equal(server.tcp_conn, 0);
  assert.equal(server.udp_conn, null);
  assert.equal(server.swap_total, null);
  assert.equal(server.ping_ct, false);
  assert.equal(server.loss_ct, false);
});

test('invalid numeric values are not coerced to valid metrics or logical cores', () => {
  const server = toServer({ cpu_pct: 101, mem_used: '0', mem_total: NaN, download_speed: -1,
    upload_speed: null, cpu_cores: 8, disk_used: true, cpu_threads: 1.5 }, 'opaque', now);
  for (const field of ['cpu', 'ram_used', 'ram_total', 'net_in_speed', 'net_out_speed', 'disk_used', 'cpu_cores']) {
    assert.equal(server[field], null, field);
  }
  assert.equal(server.online, null);
  assert.equal(server.is_online, null);
  assert.equal(server.last_updated, null);
});

test('source offline status overrides a recent last-seen time; boot time is an explicit estimate', () => {
  const offline = toServer({ online: false, last_seen: '2026-11-02T11:59:59Z', uptime: 10 }, 'opaque', now);
  assert.equal(offline.online, false);
  assert.equal(offline.is_online, false);
  assert.equal(offline.last_updated, now - 1000);
  assert.equal(offline.boot_time, null);
  assert.equal(offline.boot_time_estimated, false);
  const online = toServer({ online: true, uptime: 10 }, 'opaque', now);
  assert.equal(online.is_online, true);
  assert.equal(online.boot_time, now - 10000);
  assert.equal(online.boot_time_estimated, true);
  assert.equal(online.timestamp_source, 'bridge_observation');
  assert.equal(online.observed_at, now);
});

test('hidden names, private input fields and unverified traffic scopes are never exposed', () => {
  const server = toServer({ name: 'secret name', token: 'secret token', ip: '192.0.2.1',
    cumulative_up: 100, cumulative_down: 100, traffic_used: 10, traffic_limit: 100 }, 'opaque', now, false);
  assert.equal(server.name, '服务器');
  assert.equal(server.net_rx, null);
  assert.equal(server.net_tx, null);
  assert.equal(server.net_rx_monthly, null);
  assert.equal(server.traffic_limit, null);
  assert.equal(server.ip_v4, null);
  assert.equal(JSON.stringify(server).includes('secret'), false);
  assert.equal(JSON.stringify(server).includes('192.0.2.1'), false);
});

test('regions use explicit ISO codes or country flags, never guessed names', () => {
  assert.equal(regionCode('us'), 'US');
  assert.equal(regionCode(undefined, '🇯🇵'), 'JP');
  assert.equal(regionCode('Singapore'), null);
  assert.equal(regionCode(null, '🌏'), null);
});
