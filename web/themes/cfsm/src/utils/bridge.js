import { reactive } from 'vue'
export const bridgeState = reactive({ status: 'connecting', transport: '', error: '', errorCode: '', lastSnapshot: 0, now: Date.now(), config: {}, historyNote: '' })
export function bridgeSnapshot() { bridgeState.lastSnapshot = Date.now(); bridgeState.status = 'ok'; bridgeState.error = ''; bridgeState.errorCode = '' }
export function bridgeFailure(message, code = '') { bridgeState.errorCode = code; bridgeState.status = 'unavailable'; bridgeState.error = String(message || '上游暂时不可用') }
export function serverState(server, now = bridgeState.now) {
  const observed = Number(server?.observed_at || server?.last_updated)
  if (['unavailable', 'stale'].includes(bridgeState.status) || server?.stale || (observed > 0 && now - observed > (Number(bridgeState.config.stale_ms) || 45000))) return 'stale'
  return server?.online === true ? 'online' : server?.online === false ? 'offline' : 'unknown'
}
export const statusLabel = (server) => ({ online: '在线', offline: '离线', stale: '数据过期', unknown: '状态未知' })[serverState(server)]
