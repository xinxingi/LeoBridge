<template>
  <div>
    <BridgeStatus />
    <router-view :key="$route.fullPath" />
  </div>
</template>

<script setup>
import BridgeStatus from './components/BridgeStatus.vue'
import { useTheme } from './composables/useTheme'

const { initTheme } = useTheme()

initTheme()
</script>