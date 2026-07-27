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
  { id: 'chrome', name: 'Chrome', blurb: 'Bare white on true black. Monochrome.' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const THEME_KEY = 'red-ops.theme.v1';
const DEFAULT_THEME: ThemeId = 'acid';
const FAVICON_PALETTES: Record<ThemeId, { background: string; foreground: string; accent: string }> = {
  acid: { background: '#050a08', foreground: '#edf8f2', accent: '#a6ff00' },
  synthwave: { background: '#0b0412', foreground: '#fdeaff', accent: '#ff2fa8' },
  ice: { background: '#040d14', foreground: '#e8f7ff', accent: '#00d6ff' },
  amber: { background: '#0a0602', foreground: '#ffefd2', accent: '#ffa826' },
  militech: { background: '#0b0404', foreground: '#ffe9e9', accent: '#ff3b4d' },
  chrome: { background: '#040404', foreground: '#f4f6f7', accent: '#e8eef1' },
};

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

export function createThemeFavicon(theme: ThemeId): string {
  const { background, foreground, accent } = FAVICON_PALETTES[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<path d="M2 2h48l12 12v48H14L2 50Z" fill="${background}"/>`
    + `<path d="M2 2h48l12 12v48H14L2 50Z" fill="none" stroke="${accent}" stroke-width="3"/>`
    + `<path d="M13 47V16h15c6 0 10 3.5 10 9s-4 9-10 9H13m14 0 12 13" fill="none" stroke="${foreground}" stroke-linecap="square" stroke-linejoin="miter" stroke-width="5"/>`
    + `<path d="m43 45 7-28m2 28 7-28" stroke="${accent}" stroke-linecap="square" stroke-width="4"/>`
    + `</svg>`;
}

function applyThemeFavicon(theme: ThemeId): void {
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!favicon) return;
  favicon.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(createThemeFavicon(theme))}`);
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute('data-theme', theme);
  applyThemeFavicon(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // The theme stays applied for this session when storage is unavailable.
  }
}
