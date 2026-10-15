import { ref, watchEffect } from 'vue'

/** Light or dark by choice, or whatever the system asks for. */
export type ThemeChoice = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'oni-loops.theme'

function saved(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export const theme = ref<ThemeChoice>(saved())

const systemDark = matchMedia('(prefers-color-scheme: dark)')
const systemIsDark = ref(systemDark.matches)
systemDark.addEventListener('change', (e) => (systemIsDark.value = e.matches))

// The stylesheet reads data-theme on the root, always resolved to light or dark; index.html
// sets it once before the first paint from the same storage key, so there is no flash.
watchEffect(() => {
  const effective = theme.value === 'auto' ? (systemIsDark.value ? 'dark' : 'light') : theme.value
  document.documentElement.dataset.theme = effective
  try {
    if (theme.value === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme.value)
  } catch {
    // Private mode or storage off: the choice lasts for the page.
  }
})
