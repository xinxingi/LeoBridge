import test from 'node:test'
import assert from 'node:assert/strict'
import { bridgeState, bridgeFailure, bridgeSnapshot, serverState, statusLabel } from '../src/utils/bridge.js'

test('upstream explicit offline is not overridden by a recent observation', () => {
  bridgeSnapshot()
  assert.equal(serverState({ online: false, observed_at: Date.now() }), 'offline')
})
test('a missing online flag remains unknown', () => {
  bridgeSnapshot()
  assert.equal(serverState({ observed_at: Date.now() }), 'unknown')
})
test('old or marked stale data never becomes an offline claim', () => {
  bridgeSnapshot()
  assert.equal(serverState({ online: true, observed_at: 1000 }, 47000), 'stale')
  assert.equal(serverState({ online: false, stale: true, observed_at: Date.now() }), 'stale')
})
test('upstream outage marks all last-known server states as stale and recovery clears the error', () => {
  bridgeFailure('upstream timeout', 'UPSTREAM_TIMEOUT')
  assert.equal(serverState({ online: false, observed_at: Date.now() }), 'stale')
  assert.equal(statusLabel({ online: true, observed_at: Date.now() }), '数据过期')
  bridgeSnapshot()
  assert.equal(bridgeState.errorCode, '')
  assert.equal(bridgeState.error, '')
  assert.equal(serverState({ online: true, observed_at: Date.now() }), 'online')
})
