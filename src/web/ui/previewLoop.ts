// One shared, low-frame-rate loop for every live character preview of the web panels. Pure logic (the
// browser pieces are injected), so it runs and is tested in node.
//
// Rules: it runs only while the page that shows the previews is visible (`setActive(true)`), the
// document is visible, reduced motion is off and at least one preview exists. In every other state no
// frame callback is scheduled at all. With reduced motion on, each preview is drawn once, still (a
// preview may offer `still()`), and never animates. `add` returns the function that removes the
// preview again; `dispose` ends the loop and forgets every preview, so a rebuilt page leaks nothing.

/** The frame rate previews are redrawn at: an idle companion looks alive at this rate and costs next to nothing. */
export const PREVIEW_FPS = 12;
/** A long gap (a stalled tab) never advances a preview by more than this, ms. */
const MAX_STEP_MS = 250;

export interface PreviewItem {
  /** Advances and draws one frame; `timeMs` is the loop's own monotonic clock. */
  frame(timeMs: number, dtMs: number): void;
  /** Draws one calm still frame (reduced motion, or before the loop starts). Defaults to frame(0, 0). */
  still?(): void;
  /**
   * Whether the preview is on screen right now (its tab or page is shown). The loop draws only visible previews while
   * animating; a hidden one costs nothing. Absent = always visible. A throw counts as visible.
   */
  visible?(): boolean;
}

export interface LoopEnv {
  raf(cb: (now: number) => void): number;
  caf(handle: number): void;
  hidden(): boolean;
  /** Calls back when the document's visibility changes; returns the unsubscribe. */
  onVisibility?(cb: () => void): () => void;
}

export interface PreviewLoop {
  add(item: PreviewItem): () => void;
  /** The page showing the previews is up (true) or not (false). */
  setActive(active: boolean): void;
  setReducedMotion(reduced: boolean): void;
  readonly running: boolean;
  readonly size: number;
  dispose(): void;
}

export function createPreviewLoop(env: LoopEnv, fps: number = PREVIEW_FPS): PreviewLoop {
  const items = new Set<PreviewItem>();
  const interval = 1000 / fps;
  let active = false;
  let reduced = false;
  let disposed = false;
  let handle: number | null = null;
  let last = Number.NaN;
  let clock = 0;

  const shouldRun = (): boolean => !disposed && active && !reduced && !env.hidden() && items.size > 0;

  const safe = (fn: () => void): void => {
    try {
      fn();
    } catch {
      // One broken preview never stops the others.
    }
  };
  const still = (item: PreviewItem): void => safe(() => (item.still ? item.still() : item.frame(0, 0)));

  const isVisible = (item: PreviewItem): boolean => {
    if (!item.visible) return true;
    try {
      return item.visible();
    } catch {
      return true;
    }
  };

  const stop = (): void => {
    if (handle === null) return;
    env.caf(handle);
    handle = null;
  };

  const tick = (now: number): void => {
    handle = null;
    if (!shouldRun()) return;
    if (Number.isNaN(last)) last = now - interval;
    const dt = now - last;
    if (dt >= interval - 2) {
      last = now;
      const step = Math.min(dt, MAX_STEP_MS);
      clock += step;
      for (const item of items) if (isVisible(item)) safe(() => item.frame(clock, step));
    }
    handle = env.raf(tick);
  };

  const sync = (): void => {
    if (shouldRun()) {
      if (handle === null) {
        last = Number.NaN;
        handle = env.raf(tick);
      }
    } else {
      stop();
    }
  };

  const unsubscribe = env.onVisibility?.(() => sync());

  return {
    add(item) {
      if (disposed) return () => undefined;
      items.add(item);
      if (active) still(item);
      sync();
      return () => {
        items.delete(item);
        sync();
      };
    },
    setActive(next) {
      if (active === next) return;
      active = next;
      // A first calm frame at once (no blank canvas until the first tick); reduced motion keeps only this.
      if (active) for (const item of items) still(item);
      sync();
    },
    setReducedMotion(next) {
      if (reduced === next) return;
      reduced = next;
      if (active && reduced) for (const item of items) still(item);
      sync();
    },
    get running() {
      return handle !== null;
    },
    get size() {
      return items.size;
    },
    dispose() {
      disposed = true;
      stop();
      unsubscribe?.();
      items.clear();
    },
  };
}

/** The loop wired to the browser (requestAnimationFrame, document visibility). */
export function createBrowserPreviewLoop(): PreviewLoop {
  return createPreviewLoop({
    raf: (cb) => window.requestAnimationFrame(cb),
    caf: (id) => window.cancelAnimationFrame(id),
    hidden: () => document.hidden,
    onVisibility: (cb) => {
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
  });
}
