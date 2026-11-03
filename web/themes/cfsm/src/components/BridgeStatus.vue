<template>
  <aside class="bridge-status" role="status" :data-status="state.status">
    <strong>LeoBridge</strong> · {{ text }}
    <span v-if="state.transport === 'poll'"> · 实时源较慢，使用 HTTP 快照刷新</span>
    <span v-if="state.error"> · {{ state.error }}</span>
    <span v-if="state.lastSnapshot"> · 快照观察于 {{ new Date(state.lastSnapshot).toLocaleTimeString() }}</span>
    <button v-if="state.status !== 'ok'" @click="retry" style="margin-left: 8px">重试</button>
    <div class="bridge-note">仅展示上游提供的数据；— 表示缺失或未支持，空图不代表零值。启动时间由 uptime 推算。无管理后台。</div>
  </aside>
</template>
<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { bridgeState as state } from '../utils/bridge'
const retry = () => window.location.reload()
let timer
onMounted(() => { timer = setInterval(() => { state.now = Date.now(); if (state.status === 'ok' && state.lastSnapshot && state.now - state.lastSnapshot > (Number(state.config.stale_ms) || 45000)) state.status = 'stale' }, 1000) })
onUnmounted(() => clearInterval(timer))
const text = computed(() => ({ connecting: '正在连接', ok: '快照已更新', unavailable: '上游或桥接连接不可用（服务器状态未知）', stale: '数据已过期（服务器状态未知）' })[state.status] || '状态未知')
</script>
<style scoped>
.bridge-status { max-width: 1400px; margin: 12px auto; padding: 12px 20px; border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-secondary); font-size: 12px; }
.bridge-status[data-status="unavailable"], .bridge-status[data-status="stale"] { border-color: #ffb870; color: #bc772d; }
.bridge-note { margin-top: 5px; opacity: .85; }
</style>
