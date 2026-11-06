/** Keyboard shortcut `n` (new trade): plain key only, never while typing in a field. */
export function isNewTradeShortcut(e: KeyboardEvent): boolean {
  if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as Partial<HTMLElement> | null;
  if (!t) return true;
  if (t.isContentEditable) return false;
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName ?? '');
}

export type Theme = 'light' | 'dark';
export const THEME_KEY = 'tj-theme';

/** Stored choice wins; otherwise follow the OS. */
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

export function currentTheme(): Theme {
  return resolveTheme(
    localStorage.getItem(THEME_KEY),
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}
