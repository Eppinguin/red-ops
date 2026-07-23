/**
 * Visual themes. Each id matches a `[data-theme="…"]` block in styles.css that
 * redefines the full colour-token contract, so switching only swaps the
 * attribute on <html> — no component knows a colour by name.
 */
export const THEMES = [
  { id: 'acid', name: 'Acid', blurb: 'Acid green on black — the default terminal.' },
  { id: 'synthwave', name: 'Synthwave', blurb: 'Hot magenta on violet-black.' },
  { id: 'ice', name: 'Ice', blurb: 'Cold cyan on gunmetal. Calmest for long sessions.' },
  { id: 'amber', name: 'Amber', blurb: 'Monochrome CRT phosphor.' },
  { id: 'militech', name: 'Militech', blurb: 'Alert-red command console.' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const THEME_KEY = 'red-ops.theme.v1';
const DEFAULT_THEME: ThemeId = 'acid';

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEMES.some((theme) => theme.id === value);
}

export function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // The theme stays applied for this session when storage is unavailable.
  }
}
