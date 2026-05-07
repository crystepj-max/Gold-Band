import type { ConcreteDesktopTheme, DesktopFontPreference, DesktopThemeMode, DesktopThemePreference } from './types';

export interface ThemePreviewPalette {
  background: string;
  surface: string;
  border: string;
  primary: string;
  foreground: string;
  muted: string;
  success: string;
  danger: string;
}

export interface DesktopThemeOption {
  id: ConcreteDesktopTheme;
  mode: DesktopThemeMode;
  labelKey: string;
  descriptionKey: string;
  preview: ThemePreviewPalette;
}

export interface DesktopFontOption {
  id: DesktopFontPreference;
  labelKey: string;
  descriptionKey: string;
  preview: string;
}

export const desktopThemeOptions = [
  {
    id: 'light',
    mode: 'light',
    labelKey: 'settings.themeDefaultLight',
    descriptionKey: 'settings.themeDefaultLightDescription',
    preview: {
      background: '#f7faff',
      surface: '#ffffff',
      border: '#d9e4f2',
      primary: '#3157d5',
      foreground: '#111827',
      muted: '#667085',
      success: '#15803d',
      danger: '#dc2626',
    },
  },
  {
    id: 'light-warm',
    mode: 'light',
    labelKey: 'settings.themeWarmLight',
    descriptionKey: 'settings.themeWarmLightDescription',
    preview: {
      background: '#f7f2e8',
      surface: '#fffdf8',
      border: '#e3d7c3',
      primary: '#9a6b1f',
      foreground: '#211d16',
      muted: '#756d60',
      success: '#15803d',
      danger: '#c83e43',
    },
  },
  {
    id: 'dark',
    mode: 'dark',
    labelKey: 'settings.themeGoldDark',
    descriptionKey: 'settings.themeGoldDarkDescription',
    preview: {
      background: '#0b0d10',
      surface: '#14171b',
      border: '#2a2e35',
      primary: '#d6b36a',
      foreground: '#f4efe6',
      muted: '#9b9488',
      success: '#3ddc97',
      danger: '#ff6b76',
    },
  },
  {
    id: 'black',
    mode: 'dark',
    labelKey: 'settings.themeBlack',
    descriptionKey: 'settings.themeBlackDescription',
    preview: {
      background: '#050814',
      surface: '#0a1020',
      border: '#1b2940',
      primary: '#6ea8fe',
      foreground: '#edf4ff',
      muted: '#98a6bd',
      success: '#2dd48f',
      danger: '#ff7185',
    },
  },
] as const satisfies readonly DesktopThemeOption[];

export const desktopFontOptions = [
  {
    id: 'geist',
    labelKey: 'settings.fontGeist',
    descriptionKey: 'settings.fontGeistDescription',
    preview: 'Gold Band / AI Workflow',
  },
  {
    id: 'inter',
    labelKey: 'settings.fontInter',
    descriptionKey: 'settings.fontInterDescription',
    preview: 'Gold Band / AI Workflow',
  },
  {
    id: 'ibm-plex',
    labelKey: 'settings.fontIbmPlex',
    descriptionKey: 'settings.fontIbmPlexDescription',
    preview: 'Gold Band / AI Workflow',
  },
] as const satisfies readonly DesktopFontOption[];

export const desktopThemeGroups = {
  light: desktopThemeOptions.filter((theme) => theme.mode === 'light'),
  dark: desktopThemeOptions.filter((theme) => theme.mode === 'dark'),
};

const preferredThemeStorageKey = 'gold-band:preferred-themes';
const defaultThemeByMode = {
  light: 'light',
  dark: 'dark',
} as const satisfies Record<DesktopThemeMode, ConcreteDesktopTheme>;

type PreferredThemeByMode = Record<DesktopThemeMode, ConcreteDesktopTheme>;

export function desktopThemeMode(theme: ConcreteDesktopTheme): DesktopThemeMode {
  return desktopThemeOptions.find((option) => option.id === theme)?.mode ?? 'dark';
}

export function rememberConcreteThemePreference(theme: ConcreteDesktopTheme) {
  const mode = desktopThemeMode(theme);
  const preferredThemes = preferredThemeByMode();
  preferredThemes[mode] = theme;
  window.localStorage.setItem(preferredThemeStorageKey, JSON.stringify(preferredThemes));
}

export function preferredThemeForMode(mode: DesktopThemeMode): ConcreteDesktopTheme {
  return preferredThemeByMode()[mode];
}

export function resolveThemePreference(theme: DesktopThemePreference): ConcreteDesktopTheme {
  if (theme !== 'system') return theme;
  const systemMode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return preferredThemeByMode()[systemMode];
}

function preferredThemeByMode(): PreferredThemeByMode {
  try {
    const saved = JSON.parse(window.localStorage.getItem(preferredThemeStorageKey) ?? '{}') as Partial<PreferredThemeByMode>;
    return {
      light: isThemeForMode(saved.light, 'light') ? saved.light : defaultThemeByMode.light,
      dark: isThemeForMode(saved.dark, 'dark') ? saved.dark : defaultThemeByMode.dark,
    };
  } catch {
    return { ...defaultThemeByMode };
  }
}

function isThemeForMode(theme: ConcreteDesktopTheme | undefined, mode: DesktopThemeMode): theme is ConcreteDesktopTheme {
  return !!theme && desktopThemeMode(theme) === mode;
}

export function applyTheme(theme: DesktopThemePreference) {
  const root = document.documentElement;
  const resolved = resolveThemePreference(theme);
  if (theme !== 'system') rememberConcreteThemePreference(theme);
  root.dataset.theme = resolved;
  root.classList.toggle('dark', desktopThemeMode(resolved) === 'dark');
}

export function applyFont(font: DesktopFontPreference) {
  document.documentElement.dataset.font = font;
}
