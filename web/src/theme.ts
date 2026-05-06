import type { DesktopThemePreference } from './types';

export function applyTheme(theme: DesktopThemePreference) {
  const root = document.documentElement;
  const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  root.dataset.theme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
}
