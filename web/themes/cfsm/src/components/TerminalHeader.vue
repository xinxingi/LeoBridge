<template>
  <div class="terminal-header">
    <div class="terminal-dots">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
    </div>
    <div class="terminal-title">{{ title }}</div>
    <div class="terminal-header-controls">
      <div class="lang-select-wrapper">
        <svg class="lang-select-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path>
          <path d="M2 12h20"></path>
        </svg>
        <select
          class="lang-select"
          :value="currentLang"
          :disabled="switching"
          :aria-label="t('language')"
          @change="handleLangSelect"
        >
          <option v-for="language in languages" :key="language.code" :value="language.code">
            {{ language.nativeLabel }}
          </option>
        </select>
        <svg class="lang-select-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="theme-toggle-wrapper">
        <div class="theme-toggle">
          <button 
            class="theme-btn" 
            :class="{ active: currentTheme === 'auto' }"
            @click="setTheme('auto')"
            aria-label="Auto - Follow System"
          ><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-monitor"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg></button>
          <button 
            class="theme-btn" 
            :class="{ active: currentTheme === 'dark' }"
            @click="setTheme('dark')"
            aria-label="Dark Mode"
          ><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-moon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg></button>
          <button 
            class="theme-btn" 
            :class="{ active: currentTheme === 'light' }"
            @click="setTheme('light')"
            aria-label="Light Mode"
          ><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg></button>
        </div>
      </div>
      <span class="label-small" title="LeoBridge 不包含 CFSM 管理后台">只读监控</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { LANGUAGES, t, setLanguage, getLanguage } from '../utils/i18n'
import { useTheme } from '../composables/useTheme'
import { DEFAULT_SITE_TITLE } from '../utils/constants'
import { hasConfiguredApiBase } from '../utils/config'

defineProps({
  title: {
    type: String,
    default: DEFAULT_SITE_TITLE
  }
})

const { currentTheme, setTheme } = useTheme()
const currentLang = ref(getLanguage())
const languages = LANGUAGES
const switching = ref(false)
const route = useRoute()
const isAdminPage = ref(route.path === '/admin')
const adminHref = computed(() => hasConfiguredApiBase() ? '/#/admin' : '/admin#/admin')

const handleLangSelect = async (event) => {
  const lang = event.target.value
  if (lang === currentLang.value) return
  switching.value = true
  const changed = await setLanguage(lang)
  switching.value = false
  if (!changed) {
    event.target.value = currentLang.value
  }
}

const handleLanguageChange = (e) => {
  currentLang.value = e.detail.lang
}

onMounted(() => {
  window.addEventListener('languageChanged', handleLanguageChange)
})

onUnmounted(() => {
  window.removeEventListener('languageChanged', handleLanguageChange)
})
</script>
