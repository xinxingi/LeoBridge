import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatSpeed, formatPercent, formatUptime, toPercent } from '../src/lib/format.ts';
import { mergeStatus } from '../src/contexts/live-data.ts';

test('absent metrics stay absent while real zero remains zero', () => {
  for (const value of [null, undefined, NaN]) {
    assert.equal(formatBytes(value), '—');
    assert.equal(formatSpeed(value).value, '—');
    assert.equal(formatPercent(value), '—');
    assert.equal(formatUptime(value).value, '—');
    assert.ok(Number.isNaN(toPercent(value, 1024)));
  }
  assert.equal(formatBytes(0), '0B');
  assert.deepEqual(formatSpeed(0), {value:'0', unit:'bps'});
  assert.equal(formatPercent(0), '0.00');
  assert.equal(toPercent(0, 1024), 0);
});
test('byte and speed units retain Komari protocol semantics', () => {
  assert.equal(formatBytes(1024 ** 3), '1.00GB');
  assert.deepEqual(formatSpeed(125000), {value:'1.00', unit:'Mbps'});
  assert.equal(toPercent(256, 1024), 25);
  assert.ok(Number.isNaN(toPercent(256, null)));
});
test('new observation timestamp survives unchanged metric values; removed nodes disappear', () => {
  const earlier = {time:'2026-11-02T00:00:00Z', cpu:0, online:true};
  const newer = {...earlier, time:'2026-11-02T00:00:05Z'};
  const result = mergeStatus({a:earlier,b:earlier}, {a:newer});
  assert.equal(result.a.time, newer.time);
  assert.equal(result.a.cpu, 0);
  assert.equal(result.b, undefined);
});
