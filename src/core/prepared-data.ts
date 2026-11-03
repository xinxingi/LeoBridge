/** Public source facts and derivations, independent of any theme's wire format.
 * Bytes, bytes/s, percent, calendar months and UTC calendar days are explicit.
 * This is an allowlist: never retain arbitrary upstream objects here. */
interface ResourceInput {
  observedAt: number;
  memoryUsedBytes: number | null; memoryTotalBytes: number | null;
  diskUsedBytes: number | null; diskTotalBytes: number | null;
  uploadBytesPerSecond: number | null; downloadBytesPerSecond: number | null;
  tcpConnections: number | null; udpConnections: number | null;
  loadAverages: [number, number, number] | null;
  metadata: { logicalCpuCount: number | null };
}
const number = (value: unknown, minimum = 0): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : null;
const string = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const sum = (a: number | null, b: number | null): number | null => a === null || b === null ? null : number(a + b);
const ratio = (a: number | null, b: number | null): number | null => a === null || b === null || b <= 0 ? null : number(a / b * 100);
function capacity(used: number | null, total: number | null) {
  return { freeBytes: used === null || total === null || used > total ? null : total - used, usedPercent: ratio(used, total) };
}
function date(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? value : null;
}
function daysUntil(value: string | null, observedAt: number): number | null {
  return value === null ? null : (Date.parse(value) - Math.floor(observedAt / 86400000) * 86400000) / 86400000;
}
const cycleMonths: Record<string, number> = { month: 1, quarter: 3, half_year: 6, year: 12, two_year: 24, three_year: 36, five_year: 60 };
function currency(value: unknown): string | null { return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null; }
function publicUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value : null; }
  catch { return null; }
}
function textRows(value: unknown, fields: string[]) {
  return Array.isArray(value) ? value.filter(record).map(row => Object.fromEntries(fields.map(key => [key, string(row[key])]))) : null;
}
function dailyTraffic(raw: Record<string, unknown>) {
  const input = raw.daily_traffic;
  const seen = new Set<string>();
  let invalid = false;
  const rows = Array.isArray(input) ? input.flatMap(row => {
    if (!record(row)) { invalid = true; return []; }
    const day = date(row.date);
    if (day === null || seen.has(day)) { invalid = true; return []; }
    seen.add(day);
    const uploadBytes = number(row.uplink), downloadBytes = number(row.downlink);
    return [{ date: day, uploadBytes, downloadBytes, totalBytes: number(row.total) ?? sum(uploadBytes, downloadBytes) }];
  }).sort((a, b) => a.date.localeCompare(b.date)) : null;
  // Duplicate dates have no stable identity: do not choose a row or double-count.
  const accepted = invalid ? null : rows;
  function total(field: 'uploadBytes' | 'downloadBytes' | 'totalBytes') {
    return accepted?.length ? accepted.reduce<number | null>((acc, row) => sum(acc, row[field]), 0) : null;
  }
  return { scope: string(raw.daily_traffic_scope), startDate: date(raw.daily_traffic_start), endDate: date(raw.daily_traffic_end),
    rows: accepted, invalidRows: invalid, coverage: 'returned_dates_only' as const,
    returnedTotals: { uploadBytes: total('uploadBytes'), downloadBytes: total('downloadBytes'), totalBytes: total('totalBytes') } };
}
function pingData(value: unknown) {
  if (!Array.isArray(value)) return null;
  const rows = value.filter(record), counts = new Map<string, number>();
  for (const row of rows) { const key = string(row.key); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
  return rows.flatMap(row => {
    const key = string(row.key);
    if (!key || counts.get(key) !== 1) return [];
    const loss = (value: unknown) => { const n = number(value); return n !== null && n <= 100 ? n : null; };
    const buckets = Array.isArray(row.buckets) ? row.buckets.map(bucket => {
      const source = record(bucket) ? bucket : {};
      return { latencyMs: number(source.ms), lossPercent: loss(source.loss) };
    }) : null;
    const latency = buckets?.flatMap(b => b.latencyMs === null ? [] : [b.latencyMs]) ?? [];
    const losses = buckets?.flatMap(b => b.lossPercent === null ? [] : [b.lossPercent]) ?? [];
    const mean = (values: number[]) => values.length ? number(values.reduce((acc, v) => acc + v / values.length, 0)) : null;
    return [{ key, label: string(row.label), isp: string(row.isp), latencyMs: number(row.current_ms), lossPercent: loss(row.loss_pct), buckets,
      bucketSummary: { aggregation: 'source_bucket' as const, latencyBucketCount: latency.length, lossBucketCount: losses.length,
        minLatencyMs: latency.length ? latency.reduce((a, b) => Math.min(a, b)) : null,
        maxLatencyMs: latency.length ? latency.reduce((a, b) => Math.max(a, b)) : null,
        meanLatencyMs: mean(latency), meanLossPercent: mean(losses), packetCountsAvailable: false } }];
  });
}

export function prepareData(raw: Record<string, unknown>, metrics: ResourceInput) {
  const cycle = string(raw.renewal_cycle), months = cycle && Object.hasOwn(cycleMonths, cycle) ? cycleMonths[cycle] : null;
  const price = number(raw.renewal_price), priceCny = number(raw.renewal_price_cny), code = currency(raw.renewal_currency);
  const monthly = (amount: number | null) => amount === null || months === null ? null : number(amount / months);
  const monthlyCost = code ? monthly(price) : null, monthlyCostCny = monthly(priceCny);
  const expiry = date(raw.expires_at), periodStart = date(raw.period_start), periodEnd = date(raw.period_end);
  const source = raw.traffic_source === 'xray' || raw.traffic_source === 'system' ? raw.traffic_source : null;
  const scope = string(raw.traffic_used_scope), mode = string(raw.traffic_stats_mode);
  const up = number(raw.traffic_used_up), down = number(raw.traffic_used_down), adjustment = number(raw.traffic_adjustment, -Infinity);
  const directional = mode === 'upload' ? up : mode === 'download' ? down : mode === 'both' ? sum(up, down)
    : mode === 'max' && up !== null && down !== null ? Math.max(up, down) : null;
  const reportedUsed = number(raw.traffic_used);
  // Only a known source/scope/mode and an explicit adjustment support recomputing billed usage.
  const derivedUsed = source && ['configured_period', 'counter_since_reset'].includes(scope ?? '') && directional !== null && adjustment !== null
    ? number(directional + adjustment) : null;
  const used = reportedUsed ?? derivedUsed, limit = number(raw.traffic_limit);
  const comparable = source !== null && ['configured_period', 'counter_since_reset'].includes(scope ?? '');
  const limited = comparable && limit !== null && limit > 0 && used !== null;
  const bootScope = string(raw.boot_traffic_scope), cumulativeScope = string(raw.cumulative_traffic_scope);
  const bootUp = number(raw.boot_traffic_up), bootDown = number(raw.boot_traffic_down);
  const cumulativeUp = number(raw.cumulative_up), cumulativeDown = number(raw.cumulative_down);
  const cores = number(raw.cpu_cores, 1);
  return {
    resources: { memory: capacity(metrics.memoryUsedBytes, metrics.memoryTotalBytes), disk: capacity(metrics.diskUsedBytes, metrics.diskTotalBytes),
      totalBytesPerSecond: sum(metrics.uploadBytesPerSecond, metrics.downloadBytesPerSecond),
      totalConnections: sum(metrics.tcpConnections, metrics.udpConnections),
      loadPerLogicalCpu: metrics.loadAverages && metrics.metadata.logicalCpuCount ? metrics.loadAverages.map(v => v / metrics.metadata.logicalCpuCount!) : null },
    billing: { price, currency: code, priceCny, cycle, cycleMonths: months, monthlyCost, annualCost: monthlyCost === null ? null : number(monthlyCost * 12),
      monthlyCostCny, annualCostCny: monthlyCostCny === null ? null : number(monthlyCostCny * 12),
      sourceExpiryDate: expiry, daysUntilSourceExpiry: daysUntil(expiry, metrics.observedAt), calendarBasis: 'UTC_date' as const },
    traffic: {
      source, scope, mode, adjustmentBytes: adjustment, usedBytes: used, usedBasis: reportedUsed !== null ? 'reported' : derivedUsed !== null ? 'derived' : null,
      uploadBytes: up, downloadBytes: down, totalBytes: number(raw.traffic_used_total) ?? sum(up, down), limitBytes: limit,
      unlimited: limit === null ? null : limit === 0,
      remainingBytes: limited ? Math.max(0, limit - used) : null, overageBytes: limited ? Math.max(0, used - limit) : null,
      usedPercent: limited ? ratio(used, limit) : null,
      periodStart, periodEnd, daysUntilPeriodEnd: daysUntil(periodEnd, metrics.observedAt), calendarBasis: 'UTC_date' as const,
      boot: { scope: bootScope, uploadBytes: bootUp, downloadBytes: bootDown, totalBytes: bootScope === 'current_boot' ? sum(bootUp, bootDown) : null },
      cumulative: { scope: cumulativeScope, uploadBytes: cumulativeUp, downloadBytes: cumulativeDown, totalBytes: cumulativeScope === 'current_boot' ? sum(cumulativeUp, cumulativeDown) : null },
      daily: dailyTraffic(raw),
    },
    sourceMetadata: { cpuCores: cores !== null && Number.isInteger(cores) ? cores : null, regionName: string(raw.region_name), regionCity: string(raw.region_city),
      providerName: string(raw.provider_name), providerUrl: publicUrl(raw.provider_url) },
    returnRoutes: textRows(raw.return_routes, ['carrier', 'region', 'route_type', 'tested_at']),
    unlocks: textRows(raw.unlocks, ['service', 'status', 'region', 'tested_at']),
    ping: pingData(raw.ping),
  };
}

export type PreparedData = ReturnType<typeof prepareData>;
