// App colour chosen in Settings → Appearance. Stored on this phone; applied before the first paint
// (see the inline script in app/layout.tsx) so the screen never flashes the wrong colour.
export const THEMES = ['orange', 'blue', 'green', 'purple'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = 'sk.theme';
/** Header colour of each theme (brand-700), for the phone's status bar. */
export const THEME_BAR: Record<Theme, string> = { orange: '#b34d08', blue: '#1747ad', green: '#166534', purple: '#6d28d9' };

export function currentTheme(): Theme {
  try { const v = localStorage.getItem(THEME_KEY); if ((THEMES as readonly string[]).includes(v ?? '')) return v as Theme; } catch { /* private mode */ }
  return 'orange';
}
export function applyTheme(theme: Theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  if (theme === 'orange') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BAR[theme]);
}
/** Runs before React: same logic as applyTheme, kept tiny and dependency-free. */
export const THEME_BOOT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t&&t!=='orange'&&/^(blue|green|purple)$/.test(t)){document.documentElement.dataset.theme=t;var m={blue:'#1747ad',green:'#166534',purple:'#6d28d9'}[t];var e=document.querySelector('meta[name="theme-color"]');if(e)e.setAttribute('content',m)}}catch(e){}`;
