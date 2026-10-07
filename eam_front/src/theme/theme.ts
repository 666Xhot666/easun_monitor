/** What the user picked under Account → Appearance. */
export type ThemePreference = 'light' | 'dark' | 'system';
/** What the page is drawn in. */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'eam.theme';
const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** The stored preference; "system" when none is stored or storage is unavailable. */
export function loadPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return PREFERENCES.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system';
  } catch {
    return 'system';
  }
}

export function savePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page load only.
  }
}

/** The colour tokens in index.css and Tailwind's dark: variant both key off this attribute. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
