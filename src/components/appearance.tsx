'use client';
import { useEffect, useState } from 'react';
import { Icon } from './ui';
import { useI18n } from '@/lib/i18n';
import { applyTheme, currentTheme, THEME_BAR, THEMES, type Theme } from '@/lib/theme';

/** Settings → Appearance: pick the app colour. Changes instantly; remembered on this phone. */
export function Appearance() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>('orange');
  useEffect(() => { setTheme(currentTheme()); }, []);
  return (
    <div role="radiogroup" aria-label={t('set.appearance')} className="grid grid-cols-4 gap-2" data-testid="theme-picker">
      {THEMES.map((x) => (
        <button key={x} type="button" role="radio" aria-checked={theme === x} data-testid={`theme-${x}`}
          onClick={() => { applyTheme(x); setTheme(x); }}
          className={`flex flex-col items-center gap-1 rounded-2xl border-2 bg-white p-2 text-sm font-semibold ${theme === x ? 'border-ink' : 'border-transparent'}`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-full text-white" style={{ background: THEME_BAR[x] }}>
            {theme === x && <Icon name="check" className="h-5 w-5" />}
          </span>
          {t(`theme.${x}`)}
        </button>
      ))}
    </div>
  );
}
