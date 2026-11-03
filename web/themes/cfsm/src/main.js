// LeoBridge runtime entry: public monitor UI, no CFSM administration or Turnstile.
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/main.css'
import './styles/light.css'
import { initConfig } from './utils/config'
import { fetchConfig } from './utils/api'
import { applyDefaultLanguage } from './utils/i18n'
import { applyDefaultTheme } from './composables/useTheme'
import { bridgeState } from './utils/bridge'
async function start() {
  await initConfig()
  const config = await fetchConfig() || {}
  bridgeState.config = config.bridge || {}
  document.title = config.site_title || 'LeoBridge'
  applyDefaultTheme(config.preferred_theme || 'auto')
  await applyDefaultLanguage(config.default_language || 'zh')
  const app = createApp(App)
  app.provide('appConfig', config)
  app.use(router)
  app.mount('#app')
  document.getElementById('loading')?.remove()
}
start()
