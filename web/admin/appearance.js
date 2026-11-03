// Run before the stylesheet so a saved light preference never paints as dark first.
(() => {
  const key = 'leobridge.admin.appearance'
  const normalize = value => ['light', 'dark', 'system'].includes(value) ? value : 'dark'
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  let storage, preference = 'dark'
  try {
    storage = window.localStorage
    preference = normalize(storage.getItem(key))
  } catch { /* Storage may be blocked; switching still works for this page. */ }

  function apply() {
    document.documentElement.dataset.theme = preference === 'system'
      ? (media.matches ? 'dark' : 'light') : preference
    const control = document.getElementById('appearance')
    if (control) control.value = preference
  }
  apply()

  media.addEventListener('change', () => {
    if (preference === 'system') apply()
  })
  window.addEventListener('storage', event => {
    if (event.storageArea !== storage || (event.key !== key && event.key !== null)) return
    preference = normalize(event.newValue)
    apply()
  })

  function bind() {
    const control = document.getElementById('appearance')
    if (!control) return
    control.value = preference
    control.addEventListener('change', () => {
      preference = normalize(control.value)
      apply()
      try { storage?.setItem(key, preference) } catch { /* Keep the in-page choice. */ }
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true })
  else bind()
})()
