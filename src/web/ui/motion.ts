// Reduced motion for the live previews: the person's own switch (settings.companion.reducedMotion) or the
// system preference (prefers-reduced-motion), whichever says calm. Reads are guarded: a page without
// matchMedia simply never reports a system preference.
import type { Settings } from '../../shared/settings';
import type { PreviewLoop } from './previewLoop';

export function systemReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Keeps `loop` in step with the setting and the system preference; returns the function that stops listening. */
export function bindReducedMotion(loop: PreviewLoop, getSettings: () => Settings): { sync(): void; dispose(): void } {
  const sync = (): void => loop.setReducedMotion(getSettings().companion.reducedMotion || systemReducedMotion());
  let query: MediaQueryList | null = null;
  try {
    query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  } catch {
    query = null;
  }
  query?.addEventListener('change', sync);
  sync();
  return {
    sync,
    dispose() {
      query?.removeEventListener('change', sync);
    },
  };
}
