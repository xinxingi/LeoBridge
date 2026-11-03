import { normalizeServer, type UnifiedServer, type UpstreamServer } from '../../core/model.js';
export { normalizeRegionCode as regionCode } from '../../core/model.js';

export type CfsmServer = Record<string, unknown> & {
  id: string;
  name: string;
  online: boolean | null;
  observed_at: number;
  stale: boolean;
};

const MIB = 1024 ** 2;
const bytesToMiB = (value: number | null): number | null => value === null ? null : value / MIB;

/** Compatibility entry point for existing upstream callers. */
export function toServer(raw: UpstreamServer, id: string, observedAt: number, showName = true): CfsmServer {
  return toCfsmServer(normalizeServer(raw, observedAt, showName), id);
}

/** CFSM output boundary: MiB capacities, byte/s rates, millisecond timestamps. */
export function toCfsmServer(input: UnifiedServer, id: string): CfsmServer {
  const { online, observedAt, sourceLastSeen: lastSeen, uptimeSeconds: uptime, metadata } = input;
  const bootTime = online === true && uptime !== null && observedAt >= uptime * 1000 ? observedAt - uptime * 1000 : null;
  const server: CfsmServer = {
    id,
    name: metadata.name ?? '服务器',
    online,
    is_online: online,
    stale: false,
    observed_at: observedAt,
    last_updated: online === true ? observedAt : lastSeen,
    timestamp: observedAt,
    timestamp_source: 'bridge_observation',
    source_last_seen: lastSeen,
    bridge: { data: input.data },
    cpu: input.cpuPercent,
    ram_used: bytesToMiB(input.memoryUsedBytes),
    ram_total: bytesToMiB(input.memoryTotalBytes),
    disk_used: bytesToMiB(input.diskUsedBytes),
    disk_total: bytesToMiB(input.diskTotalBytes),
    net_in_speed: input.downloadBytesPerSecond,
    net_out_speed: input.uploadBytesPerSecond,
    load_avg: input.loadAverages?.join(' ') ?? null,
    cpu_info: metadata.cpuModel,
    cpu_cores: metadata.logicalCpuCount,
    os: metadata.operatingSystem,
    arch: metadata.architecture,
    kernel_version: metadata.kernel,
    region: metadata.regionCode,
    uptime,
    boot_time: bootTime,
    boot_time_estimated: bootTime !== null,
    tcp_conn: input.tcpConnections,
    udp_conn: input.udpConnections,
    // Billing, boot and network-interface counters have different scopes. Until
    // an exact scope is established they must not become CFSM total/monthly data.
    net_rx: null,
    net_tx: null,
    net_rx_monthly: null,
    net_tx_monthly: null,
    traffic_limit: null,
    swap_total: null,
    swap_used: null,
    gpu_info: null,
    ip_v4: null,
    ip_v6: null,
  };
  // false means not configured/unavailable; null means an explicit timeout.
  // Raw target keys are mapped separately by an explicit bridge configuration.
  for (const field of ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4']) {
    server[`ping_${field}`] = false;
    server[`loss_${field}`] = false;
  }
  return server;
}
