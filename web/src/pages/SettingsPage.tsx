import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConcreteDesktopTheme, DesktopFontPreference, DesktopLanguage, DesktopThemeMode, DesktopThemePreference, PreferencesVm } from '../types';
import {
  applyFont,
  applyTheme,
  desktopFontOptions,
  desktopThemeGroups,
  desktopThemeOptions,
  preferredThemeForMode,
  rememberConcreteThemePreference,
  resolveThemePreference,
  type DesktopThemeOption,
  type ThemePreviewPalette,
} from '../theme';
import { AppCard } from '@/components/AppCard';
import { Page, PageHeader } from '@/components/PageScaffold';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type ThemeDrawerMode = 'all' | DesktopThemeMode;

interface SettingsPageProps {
  preferences: PreferencesVm;
  onSave: (theme: DesktopThemePreference, language: DesktopLanguage, font: DesktopFontPreference) => void;
}

export function SettingsPage({ preferences, onSave }: SettingsPageProps) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState(preferences.theme);
  const [language, setLanguage] = useState(preferences.language);
  const [font, setFont] = useState(preferences.font);
  const [themeDrawerMode, setThemeDrawerMode] = useState<ThemeDrawerMode>('all');
  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const [preferenceVersion, setPreferenceVersion] = useState(0);

  useEffect(() => setTheme(preferences.theme), [preferences.theme]);
  useEffect(() => setLanguage(preferences.language), [preferences.language]);
  useEffect(() => setFont(preferences.font), [preferences.font]);

  const chooseTheme = (value: DesktopThemePreference) => {
    if (value !== 'system') rememberConcreteThemePreference(value);
    setTheme(value);
    onSave(value, language, font);
  };

  const chooseConcreteThemeFromSheet = (value: ConcreteDesktopTheme) => {
    rememberConcreteThemePreference(value);
    setPreferenceVersion((version) => version + 1);
    if (theme === 'system') {
      applyTheme('system');
      setTheme('system');
      onSave('system', language, font);
    } else {
      setTheme(value);
      onSave(value, language, font);
    }
    setThemeSheetOpen(false);
  };

  const chooseLanguage = (value: DesktopLanguage) => {
    setLanguage(value);
    onSave(theme, value, font);
  };

  const chooseFont = (value: DesktopFontPreference) => {
    setFont(value);
    applyFont(value);
    onSave(theme, language, value);
  };

  const openThemeDrawer = (mode: ThemeDrawerMode) => {
    setThemeDrawerMode(mode);
    setThemeSheetOpen(true);
  };

  const syncWithOs = theme === 'system';
  const resolvedTheme = resolveThemePreference(theme);
  const currentTheme = getThemeOption(resolvedTheme);
  const preferredLightTheme = getThemeOption(preferredThemeForMode('light'));
  const preferredDarkTheme = getThemeOption(preferredThemeForMode('dark'));
  void preferenceVersion;

  return (
    <Page className="space-y-6 p-8">
      <div className="flex items-center justify-between rounded-xl border bg-background/60 px-4 py-3">
        <span className="font-mono text-xs text-muted-foreground">{t('settings.path')}</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled>{t('common.export')}</Button>
          <Button disabled>{t('common.run')}</Button>
        </div>
      </div>

      <PageHeader title={t('settings.title')} />

      <AppCard className="gap-3 py-4">
        <CardHeader className="px-5">
          <CardTitle>{t('settings.appearance')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-5">
          <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/35 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-semibold">{t('settings.syncWithOs')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.syncWithOsDescription')}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={syncWithOs}
              className={cn(
                'relative h-6 w-11 shrink-0 overflow-hidden rounded-full border p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                syncWithOs ? 'border-primary bg-primary' : 'border-border bg-muted-foreground/20',
              )}
              onClick={() => chooseTheme(syncWithOs ? resolvedTheme : 'system')}
            >
              <span
                className={cn(
                  'block size-5 rounded-full bg-background shadow-sm transition-transform',
                  syncWithOs && 'translate-x-5',
                )}
              />
            </button>
          </div>

          <Sheet open={themeSheetOpen} onOpenChange={setThemeSheetOpen}>
            {syncWithOs ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ThemeSummaryCard
                  eyebrow={t('settings.lightDefaultTheme')}
                  option={preferredLightTheme}
                  active={resolvedTheme === preferredLightTheme.id}
                  buttonLabel={t('settings.chooseLightTheme')}
                  onOpen={() => openThemeDrawer('light')}
                />
                <ThemeSummaryCard
                  eyebrow={t('settings.darkDefaultTheme')}
                  option={preferredDarkTheme}
                  active={resolvedTheme === preferredDarkTheme.id}
                  buttonLabel={t('settings.chooseDarkTheme')}
                  onOpen={() => openThemeDrawer('dark')}
                />
              </div>
            ) : (
              <ThemeSummaryCard
                eyebrow={t('settings.currentTheme')}
                option={currentTheme}
                buttonLabel={t('settings.chooseTheme')}
                onOpen={() => openThemeDrawer('all')}
              />
            )}
            <SheetContent className="w-[760px] max-w-[92vw] sm:max-w-[760px]" closeLabel={t('common.close')}>
              <SheetHeader className="border-b px-5 py-4">
                <SheetTitle>{themeDrawerMode === 'light' ? t('settings.chooseLightTheme') : themeDrawerMode === 'dark' ? t('settings.chooseDarkTheme') : t('settings.themeDrawerTitle')}</SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
                {(themeDrawerMode === 'all' || themeDrawerMode === 'light') ? (
                  <ThemeOptionGroup
                    title={t('settings.lightThemes')}
                    options={desktopThemeGroups.light}
                    currentTheme={theme}
                    resolvedTheme={resolvedTheme}
                    onSelect={chooseConcreteThemeFromSheet}
                  />
                ) : null}
                {(themeDrawerMode === 'all' || themeDrawerMode === 'dark') ? (
                  <ThemeOptionGroup
                    title={t('settings.darkThemes')}
                    options={desktopThemeGroups.dark}
                    currentTheme={theme}
                    resolvedTheme={resolvedTheme}
                    onSelect={chooseConcreteThemeFromSheet}
                  />
                ) : null}
              </div>
            </SheetContent>
          </Sheet>
        </CardContent>
      </AppCard>

      <AppCard className="gap-3 py-4">
        <CardHeader className="px-5">
          <CardTitle>{t('settings.typography')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-5">
          <Select value={font} onValueChange={(value) => chooseFont(value as DesktopFontPreference)}>
            <SelectTrigger className="w-72">
              <SelectValue aria-label={font} />
            </SelectTrigger>
            <SelectContent>
              {desktopFontOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>{t(option.labelKey)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid gap-2 md:grid-cols-3">
            {desktopFontOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={font === option.id}
                className={cn(
                  'rounded-xl border bg-card/80 p-3 text-left transition hover:border-primary/70 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  font === option.id && 'border-primary bg-primary/10 shadow-sm',
                )}
                onClick={() => chooseFont(option.id)}
              >
                <div className="text-sm font-semibold">{t(option.labelKey)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t(option.descriptionKey)}</div>
                <div className="mt-3 text-sm" data-font-preview={option.id}>{option.preview}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </AppCard>

      <AppCard className="gap-3 py-4">
        <CardHeader className="px-5">
          <CardTitle>{t('settings.language')}</CardTitle>
        </CardHeader>
        <CardContent className="px-5">
          <Select value={language} onValueChange={(value) => chooseLanguage(value as DesktopLanguage)}>
            <SelectTrigger className="w-56">
              <SelectValue aria-label={language} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-cn">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </AppCard>

      <Badge variant="outline" className="font-mono text-muted-foreground"><span className="mr-2 size-2 rounded-full bg-gold-success" /> CLIENT VERSION: 2.4.1-STABLE</Badge>
    </Page>
  );
}

interface ThemeSummaryCardProps {
  eyebrow: string;
  option: DesktopThemeOption;
  active?: boolean;
  buttonLabel: string;
  onOpen: () => void;
}

function ThemeSummaryCard({ eyebrow, option, active = false, buttonLabel, onOpen }: ThemeSummaryCardProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-card/80 p-3">
      <div className="flex min-w-0 items-center gap-4">
        <TerminalPreview palette={option.preview} compact />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{eyebrow}</span>
            {active ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{t('settings.activeTheme')}</Badge> : null}
          </div>
          <div className="text-base font-semibold">{t(option.labelKey)}</div>
          <div className="text-xs text-muted-foreground">{t(option.descriptionKey)}</div>
        </div>
      </div>
      <Button variant="outline" className="shrink-0" onClick={onOpen}>{buttonLabel}</Button>
    </div>
  );
}

interface ThemeOptionGroupProps {
  title: string;
  options: readonly DesktopThemeOption[];
  currentTheme: DesktopThemePreference;
  resolvedTheme: ConcreteDesktopTheme;
  onSelect: (theme: ConcreteDesktopTheme) => void;
}

function ThemeOptionGroup({ title, options, currentTheme, resolvedTheme, onSelect }: ThemeOptionGroupProps) {
  return (
    <section className="grid gap-3 py-4 lg:grid-cols-[72px_minmax(0,1fr)]">
      <div className="pt-3 text-sm font-semibold text-muted-foreground">{title}</div>
      <div className="grid gap-3">
        {options.map((option) => (
          <ThemeOptionCard
            key={option.id}
            option={option}
            selected={currentTheme === option.id}
            synced={currentTheme === 'system' && resolvedTheme === option.id}
            onSelect={() => onSelect(option.id)}
          />
        ))}
      </div>
    </section>
  );
}

interface ThemeOptionCardProps {
  option: DesktopThemeOption;
  selected: boolean;
  synced: boolean;
  onSelect: () => void;
}

function ThemeOptionCard({ option, selected, synced, onSelect }: ThemeOptionCardProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'group flex min-h-32 gap-4 rounded-xl border bg-card/80 p-3 text-left transition hover:border-primary/70 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-primary bg-primary/10 text-primary shadow-sm',
        !selected && synced && 'border-primary/40',
      )}
      onClick={onSelect}
    >
      <TerminalPreview palette={option.preview} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{t(option.labelKey)}</span>
          {synced && !selected ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{t('settings.activeTheme')}</Badge> : null}
        </div>
        <span className="text-xs leading-relaxed text-muted-foreground">{t(option.descriptionKey)}</span>
      </div>
    </button>
  );
}

function TerminalPreview({ palette, compact = false }: { palette: ThemePreviewPalette; compact?: boolean }) {
  const shellStyle = {
    backgroundColor: palette.background,
    borderColor: palette.border,
    color: palette.foreground,
  } satisfies CSSProperties;

  const surfaceStyle = {
    backgroundColor: palette.surface,
    borderColor: palette.border,
  } satisfies CSSProperties;

  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden rounded-md border font-mono shadow-sm',
        compact ? 'h-[72px] w-[112px] text-[7px]' : 'h-[104px] w-[162px] text-[9px]',
      )}
      style={shellStyle}
    >
      <div className="flex items-center gap-1 border-b px-2 py-1" style={surfaceStyle}>
        <span className="size-1.5 rounded-full" style={{ backgroundColor: palette.danger }} />
        <span className="size-1.5 rounded-full" style={{ backgroundColor: palette.primary }} />
        <span className="size-1.5 rounded-full" style={{ backgroundColor: palette.success }} />
      </div>
      <div className={cn('space-y-2', compact ? 'px-2 py-1.5' : 'px-3 py-2')}>
        <div style={{ color: palette.muted }}>$ gold-band run</div>
        <div><span style={{ color: palette.primary }}>workflow</span> ready</div>
        {!compact ? <div style={{ color: palette.success }}>verify passed</div> : null}
        <div className={cn('h-3 w-0.5 animate-pulse', compact ? 'mt-1' : 'mt-3')} style={{ backgroundColor: palette.primary }} />
      </div>
    </div>
  );
}

function getThemeOption(theme: ConcreteDesktopTheme): DesktopThemeOption {
  return desktopThemeOptions.find((option) => option.id === theme) ?? desktopThemeOptions[0];
}
