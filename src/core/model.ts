/** Upstream data stays behind the protocol adapter: never serialize `raw` to clients. */
export type UpstreamServer = Record<string, unknown>;

/** Ecosystem-neutral current metrics. Capacities are bytes; rates are bytes/s. */
export interface UnifiedServer {
  online: boolean | null;
  observedAt: number;
  sourceLastSeen: number | null;
  uptimeSeconds: number | null;
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  downloadBytesPerSecond: number | null;
  uploadBytesPerSecond: number | null;
  loadAverages: [number, number, number] | null;
  tcpConnections: number | null;
  udpConnections: number | null;
  metadata: {
    /** null also covers a name hidden by upstream policy. */
    name: string | null;
    cpuModel: string | null;
    logicalCpuCount: number | null;
    operatingSystem: string | null;
    architecture: string | null;
    kernel: string | null;
    regionCode: string | null;
  };
}

export interface Snapshot {
  enabled: boolean;
  showName: boolean;
  title: string | null;
  historyDays: number | null;
  observedAt: number;
  servers: UpstreamServer[];
  raw: Record<string, unknown>;
}

export class SnapshotError extends Error {
  readonly code = 'INVALID_UPSTREAM_SNAPSHOT';
  readonly status = 502;
  constructor() {
    super('The upstream returned an invalid probe snapshot.');
    this.name = 'SnapshotError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown, minimum = 0): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : null;
}

export function nonemptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function normalizeRegionCode(country: unknown, emoji?: unknown): string | null {
  if (typeof country === 'string' && /^[a-z]{2}$/i.test(country)) return country.toUpperCase();
  if (typeof emoji !== 'string') return null;
  const points = Array.from(emoji.trim());
  if (points.length !== 2) return null;
  const codes = points.map(point => point.codePointAt(0)!);
  return codes.every(code => code >= 0x1f1e6 && code <= 0x1f1ff)
    ? codes.map(code => String.fromCharCode(code - 0x1f1e6 + 65)).join('') : null;
}

function isoTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function loadAverages(value: unknown): UnifiedServer['loadAverages'] {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(/\s+/);
  // Linux /proc/loadavg adds runnable/total task counts and the last PID.
  if (parts.length === 5 && /^\d+\/\d+$/.test(parts[3]!) && /^\d+$/.test(parts[4]!)) parts.splice(3);
  if (parts.length !== 3 || !parts.every(part => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(part))) return null;
  const values = parts.map(Number);
  return values.every(Number.isFinite) ? values as [number, number, number] : null;
}

/** MiaoMiaoWuX input boundary: no CFSM field names or presentation units. */
export function normalizeServer(raw: UpstreamServer, observedAt: number, showName = true): UnifiedServer {
  if (!Number.isFinite(observedAt) || observedAt <= 0) throw new SnapshotError();
  const cpu = finiteNumber(raw.cpu_pct);
  const threads = finiteNumber(raw.cpu_threads, 1);
  return {
    online: typeof raw.online === 'boolean' ? raw.online : null,
    observedAt,
    sourceLastSeen: isoTimestamp(raw.last_seen),
    uptimeSeconds: finiteNumber(raw.uptime),
    cpuPercent: cpu !== null && cpu <= 100 ? cpu : null,
    memoryUsedBytes: finiteNumber(raw.mem_used),
    memoryTotalBytes: finiteNumber(raw.mem_total),
    diskUsedBytes: finiteNumber(raw.disk_used),
    diskTotalBytes: finiteNumber(raw.disk_total),
    downloadBytesPerSecond: finiteNumber(raw.download_speed),
    uploadBytesPerSecond: finiteNumber(raw.upload_speed),
    loadAverages: loadAverages(raw.loadavg),
    tcpConnections: finiteNumber(raw.tcp_connections),
    udpConnections: finiteNumber(raw.udp_connections),
    metadata: {
      name: showName ? nonemptyString(raw.name) : null,
      cpuModel: nonemptyString(raw.cpu_model),
      logicalCpuCount: threads !== null && Number.isInteger(threads) ? threads : null,
      operatingSystem: nonemptyString(raw.os),
      architecture: nonemptyString(raw.arch),
      kernel: nonemptyString(raw.kernel),
      regionCode: normalizeRegionCode(raw.region_country, raw.region),
    },
  };
}

export function normalizeSnapshot(raw: unknown, observedAt = Date.now()): Snapshot {
  if (!isRecord(raw) || typeof raw.enabled !== 'boolean' || !Number.isFinite(observedAt) || observedAt <= 0) {
    throw new SnapshotError();
  }
  // A disabled probe must not accidentally expose stale servers included in its response.
  const servers = raw.enabled ? raw.servers : [];
  if (!Array.isArray(servers) || !servers.every(isRecord)) throw new SnapshotError();
  const days = finiteNumber(raw.history_days);
  return {
    enabled: raw.enabled,
    showName: raw.show_name === true,
    title: nonemptyString(raw.title),
    historyDays: days !== null && Number.isInteger(days) && days > 0 ? days : null,
    observedAt,
    servers,
    raw,
  };
}
