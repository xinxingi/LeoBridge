import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer } from '../src/core/model.ts';
import { toCfsmServer } from '../src/protocols/cfsm/adapter.ts';
import { komariNode, komariStatus, komariRecent, komariFlatRecent, komariRecord } from '../src/protocols/komari/adapter.ts';
import { normalizeSystemSeries } from '../src/upstream/series.ts';

const now = Date.parse('2026-11-03T23:59:59Z');
const data = (raw: Record<string, unknown>, observedAt = now) => normalizeServer(raw, observedAt).data;
test('resource derivations preserve zero, unknown, inconsistent totals and byte units', () => {
  const result = data({ mem_used: 0, mem_total: 1024, disk_used: 120, disk_total: 100,
    upload_speed: 20, download_speed: 0, tcp_connections: 3, udp_connections: 0, loadavg: '1 2 4', cpu_threads: 2 });
  assert.deepEqual(result.resources.memory, { freeBytes: 1024, usedPercent: 0 });
  assert.deepEqual(result.resources.disk, { freeBytes: null, usedPercent: 120 });
  assert.equal(result.resources.totalBytesPerSecond, 20);
  assert.equal(result.resources.totalConnections, 3);
  assert.deepEqual(result.resources.loadPerLogicalCpu, [0.5, 1, 2]);
  assert.equal(data({ mem_used: 0, mem_total: 0 }).resources.memory.usedPercent, null);
  assert.equal(data({ tcp_connections: 5 }).resources.totalConnections, null);
  assert.equal(data({ upload_speed: Number.MAX_VALUE, download_speed: Number.MAX_VALUE }).resources.totalBytesPerSecond, null);
});
test('calendar-month prices retain currencies, valid free plans, unknown and permanent cycles', () => {
  const billing = data({ renewal_price: 30, renewal_currency: 'USD', renewal_price_cny: 210, renewal_cycle: 'quarter' }).billing;
  assert.equal(billing.monthlyCost, 10); assert.equal(billing.annualCost, 120);
  assert.equal(billing.monthlyCostCny, 70); assert.equal(billing.annualCostCny, 840);
  assert.equal(data({ renewal_price: 0, renewal_currency: 'CNY', renewal_cycle: 'month' }).billing.monthlyCost, 0);
  for (const renewal_cycle of ['permanent', 'unknown', 'toString']) assert.equal(data({ renewal_price: 30, renewal_currency: 'USD', renewal_cycle }).billing.monthlyCost, null);
  assert.equal(data({ renewal_price: 30, renewal_cycle: 'month' }).billing.monthlyCost, null);
  assert.equal(data({ renewal_cycle: 'month' }).billing.price, null);
});
test('source dates remain calendar dates, with explicit UTC days and no invented expiry timestamp', () => {
  assert.equal(data({ expires_at: '2026-11-04' }).billing.daysUntilSourceExpiry, 1);
  assert.equal(data({ expires_at: '2026-11-03' }).billing.daysUntilSourceExpiry, 0);
  assert.equal(data({ expires_at: '2026-11-02' }).billing.daysUntilSourceExpiry, -1);
  assert.equal(data({ expires_at: '2024-02-29' }, Date.parse('2024-02-28T12:00:00Z')).billing.daysUntilSourceExpiry, 1);
  for (const expires_at of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-11-03T12:00:00Z']) assert.equal(data({ expires_at }).billing.sourceExpiryDate, null);
  assert.equal(data({ period_end: '2026-11-04' }).traffic.daysUntilPeriodEnd, 1);
});
const quota = { traffic_source: 'xray', traffic_used_scope: 'configured_period', traffic_stats_mode: 'both',
  traffic_used_up: 60, traffic_used_down: 40, traffic_adjustment: -10, traffic_limit: 80 };
test('quota derivation respects direction and adjustment; reported usage is never adjusted twice', () => {
  let result = data(quota).traffic;
  assert.equal(result.usedBytes, 90); assert.equal(result.usedBasis, 'derived');
  assert.equal(result.remainingBytes, 0); assert.equal(result.overageBytes, 10); assert.equal(result.usedPercent, 112.5);
  result = data({ ...quota, traffic_used: 70 }).traffic;
  assert.equal(result.usedBytes, 70); assert.equal(result.usedBasis, 'reported'); assert.equal(result.remainingBytes, 10);
  assert.equal(data({ ...quota, traffic_stats_mode: 'upload' }).traffic.usedBytes, 50);
  assert.equal(data({ ...quota, traffic_stats_mode: 'download' }).traffic.usedBytes, 30);
  assert.equal(data({ ...quota, traffic_stats_mode: 'max' }).traffic.usedBytes, 50);
  assert.equal(data({ ...quota, traffic_adjustment: undefined }).traffic.usedBytes, null);
  assert.equal(data({ ...quota, traffic_adjustment: -1000 }).traffic.usedBytes, null);
  assert.equal(data({ ...quota, traffic_limit: 0 }).traffic.unlimited, true);
  assert.equal(data({ ...quota, traffic_limit: 0 }).traffic.usedPercent, null);
  assert.equal(data({ ...quota, traffic_limit: undefined }).traffic.unlimited, null);
  assert.equal(data({ ...quota, traffic_used_scope: undefined }).traffic.usedBytes, null);
});
test('boot NIC counters and Xray billing are independent; no natural-month traffic is fabricated', () => {
  const model = normalizeServer({ ...quota, boot_traffic_scope: 'current_boot', boot_traffic_up: 200, boot_traffic_down: 100,
    cumulative_traffic_scope: 'current_boot', cumulative_up: 200, cumulative_down: 100 }, now);
  assert.equal(model.data.traffic.boot.totalBytes, 300); assert.equal(model.data.traffic.usedBytes, 90);
  assert.equal(toCfsmServer(model, 'node').net_rx_monthly, null);
  assert.equal(komariStatus(model, 'node', 45000, 'poll', now).net_total_up, null);
  assert.equal(data({ boot_traffic_up: 200, boot_traffic_down: 100 }).traffic.boot.totalBytes, null);
});
test('daily ledger sums returned dates only, rejects duplicate dates, and never fills missing days', () => {
  const rows = [{ date: '2026-11-01', uplink: 2, downlink: 3 }, { date: '2026-11-03', uplink: 0, downlink: 0, total: 0 }];
  const daily = data({ daily_traffic: rows }).traffic.daily;
  assert.equal(daily.rows?.length, 2); assert.equal(daily.returnedTotals.totalBytes, 5);
  assert.equal(daily.coverage, 'returned_dates_only');
  assert.equal(data({ daily_traffic: [...rows, rows[0]] }).traffic.daily.rows, null);
  assert.equal(data({ daily_traffic: [{ date: '2026-02-30', total: 9 }] }).traffic.daily.invalidRows, true);
  assert.equal(data({ daily_traffic: [{ date: '2026-11-01', uplink: 2 }] }).traffic.daily.returnedTotals.totalBytes, null);
  assert.equal(data({ daily_traffic: [] }).traffic.daily.returnedTotals.totalBytes, null);
});
test('all keyed Ping targets are prepared; bucket averages do not become per-packet statistics', () => {
  const target = { key: 'target', current_ms: -1, loss_pct: 100, buckets: [{ ms: 0, loss: 0 }, { ms: 10, loss: 50 }, { ms: -1, loss: 100 }, { ms: -1, loss: -1 }] };
  const ping = data({ ping: [target] }).ping![0];
  assert.equal(ping.latencyMs, null); assert.equal(ping.lossPercent, 100);
  assert.equal(ping.buckets?.length, 4);
  assert.equal(ping.bucketSummary.meanLatencyMs, 5); assert.equal(ping.bucketSummary.meanLossPercent, 50);
  assert.equal(ping.bucketSummary.latencyBucketCount, 2); assert.equal(ping.bucketSummary.packetCountsAvailable, false);
  assert.equal(data({ ping: Array.from({ length: 9 }, (_, i) => ({ ...target, key: String(i) })) }).ping?.length, 9);
  assert.equal(data({ ping: [target, target] }).ping?.length, 0);
});
test('both protocol outputs and recent reports expose the same prepared facts without private raw fields', () => {
  const model = normalizeServer({ ...quota, name: 'hidden-secret', token: 'private-secret', ip: '192.0.2.8',
    loadavg: '1 2 3', provider_url: 'javascript:private-secret',
    unlocks: [{ service: 'service', status: 'failed', token: 'private-secret' }] }, now, false);
  const outputs = [toCfsmServer(model, 'node'), komariNode(model, 'node', 45000, 'poll', now),
    komariStatus(model, 'node', 45000, 'poll', now), komariRecent(model, 'node', 45000, 'poll', now)];
  for (const output of outputs) {
    assert.deepEqual((output.bridge as { data: unknown }).data, model.data);
    assert.equal(JSON.stringify(output).includes('secret'), false);
    assert.equal(JSON.stringify(output).includes('192.0.2.8'), false);
  }
  const recent = komariFlatRecent(komariRecent(model, 'node', 45000, 'poll', now));
  assert.equal(recent.load5, 2); assert.equal(recent.load15, 3);
  assert.equal(data({ provider_url: 'https://user:password@example.test' }).sourceMetadata.providerUrl, null);
});
test('historical counters survive a reboot drop without turning bucket differences into interval traffic', () => {
  const points = normalizeSystemSeries({ success: true, bucket_sec: 300, series: {
    cumulative_up: [{ t: now / 1000 - 300, value: 1000 }, { t: now / 1000, value: 0 }],
  } }, now - 600000, now);
  assert.deepEqual(points.map(p => p.cumulativeUploadBytes), [1000, 0]);
  for (const point of points) {
    const row = komariRecord(point, 'node');
    assert.equal(row.net_total_up, null); assert.equal(row.bridge?.sourceCounters.exactIntervalDeltaAvailable, false);
    assert.equal(row.bridge?.sourceCounters.resetScope, null);
  }
});
