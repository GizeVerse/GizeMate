// App-level store listeners, kept apart from the page listeners. A language switch rebuilds every page and
// calls store.unbindAll(), which clears all listeners; the app's own subscriptions must therefore be
// re-attached after each rebuild (attach() is idempotent), never registered once and lost.
import type { SettingsStore } from './store';

/** Previews re-evaluate their run state whenever the effective reduced-motion choice flips. */
/** Mirrors the effective choice on <html data-calm> so CSS transitions and animations stop too, not only the canvases. */
function markCalm(on: boolean): void {
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-calm', on);
}

export function createAppListeners(store: Pick<SettingsStore, 'subscribe'>, previews: { readonly reduced: boolean; refresh(): void }) {
  let wasReduced = previews.reduced;
  let off: (() => void) | null = null;
  return {
    /** (Re)registers the app-level listeners; call after construction and after every store.unbindAll(). */
    attach(): void {
      off?.();
      markCalm(previews.reduced);
      off = store.subscribe(() => {
        if (previews.reduced !== wasReduced) {
          wasReduced = previews.reduced;
          markCalm(wasReduced);
          previews.refresh();
        }
      });
    },
    detach(): void {
      off?.();
      off = null;
    },
  };
}
