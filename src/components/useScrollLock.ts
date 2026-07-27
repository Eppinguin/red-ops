import { useEffect, useState } from 'preact/hooks';

/**
 * Freezes the page behind an open overlay.
 *
 * Without this, a swipe inside a drawer or modal chains to the document once the
 * overlay's own scroller hits its end, so the page creeps around underneath and
 * the reading position is lost on close. `position: fixed` on the body is what
 * actually stops iOS Safari, which ignores `overflow: hidden` there — so the
 * scroll offset is captured and restored by hand.
 *
 * Locks are reference-counted: the catalog drawer can open on top of the
 * add-combatants drawer, and the first one to close must not release the lock
 * while the other is still up.
 */
let lockCount = 0;
let savedScrollY = 0;
let savedStyles: { position: string; top: string; left: string; right: string; width: string; overflowY: string } | null = null;

// The counter lives at module scope, so a hot replacement would swap in a fresh
// module while the old one's effects still hold counts — leaving the body pinned
// with no owner left to release it, i.e. a page that cannot scroll. Releasing on
// dispose keeps the dev server honest; production has no HMR and never runs this.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (lockCount > 0) {
      lockCount = 0;
      releaseLock();
    }
  });
}

function applyLock(): void {
  const { body } = document;
  savedScrollY = window.scrollY;
  savedStyles = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflowY: body.style.overflowY,
  };
  // Pinning the body keeps the layout width so the page does not reflow, and the
  // negative offset preserves the visual scroll position.
  body.style.position = 'fixed';
  body.style.top = `-${savedScrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  // Keeps the scrollbar gutter on desktop so the layout does not shift sideways.
  body.style.overflowY = 'scroll';
}

function releaseLock(): void {
  const { body } = document;
  if (savedStyles) {
    body.style.position = savedStyles.position;
    body.style.top = savedStyles.top;
    body.style.left = savedStyles.left;
    body.style.right = savedStyles.right;
    body.style.width = savedStyles.width;
    body.style.overflowY = savedStyles.overflowY;
    savedStyles = null;
  }
  // `scrollTo` must come after the body is unpinned, or there is nothing to
  // scroll yet. 'instant' avoids animating back to where the user already was.
  window.scrollTo({ top: savedScrollY, behavior: 'instant' });
}

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    if (lockCount === 1) applyLock();
    return () => {
      lockCount -= 1;
      if (lockCount === 0) releaseLock();
    };
  }, [active]);
}

/**
 * Tracks a media query reactively.
 *
 * The combatant inspector is a fixed bottom sheet below this width and an inline
 * side column above it, and only the sheet should freeze the page behind it — so
 * the lock has to follow the breakpoint rather than being decided once at mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
