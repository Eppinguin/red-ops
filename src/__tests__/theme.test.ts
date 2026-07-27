import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, createThemeFavicon, THEMES } from '../theme';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme favicon', () => {
  it('creates an SVG for every available theme', () => {
    for (const theme of THEMES) {
      const svg = createThemeFavicon(theme.id);
      expect(svg).toContain('<svg');
      expect(svg).toContain('d="M13 47V16');
      expect(svg).toContain('</svg>');
    }
  });

  it('updates the favicon when the theme is applied', () => {
    const setDocumentAttribute = vi.fn();
    const setFaviconAttribute = vi.fn();
    const setStoredTheme = vi.fn();
    vi.stubGlobal('document', {
      documentElement: { setAttribute: setDocumentAttribute },
      querySelector: vi.fn(() => ({ setAttribute: setFaviconAttribute })),
    });
    vi.stubGlobal('localStorage', { setItem: setStoredTheme });

    applyTheme('synthwave');

    expect(setDocumentAttribute).toHaveBeenCalledWith('data-theme', 'synthwave');
    expect(setStoredTheme).toHaveBeenCalledWith('red-ops.theme.v1', 'synthwave');
    const faviconUrl = setFaviconAttribute.mock.calls[0]?.[1] as string;
    expect(faviconUrl).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(faviconUrl)).toContain('stroke="#ff2fa8"');
  });
});
