// Review fix: the shared preview loop draws only the previews that are on screen, and a preview whose renderer
// throws never takes the page down. REAL: loop logic and the scene preview with a fake canvas (MOCKED 2D context).
import { describe, expect, it } from 'vitest';
import { createPreviewLoop, PREVIEW_FPS, type PreviewItem } from '../../../src/web/ui/previewLoop';
import { canvasShown } from '../../../src/web/ui/scenePreview';

function manualLoop() {
  let now = 0;
  let next = 1;
  const queue = new Map<number, (t: number) => void>();
  const loop = createPreviewLoop({ raf: (cb) => (queue.set(next, cb), next++), caf: (id) => void queue.delete(id), hidden: () => false });
  const run = (ms: number): void => {
    const end = now + ms;
    while (now < end) {
      now += 1000 / 60;
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) cb(now);
    }
  };
  return { loop, run };
}

describe('preview loop: per-item visibility', () => {
  it('animates only visible items; an item shown later starts at once, a throwing predicate counts as visible', () => {
    const { loop, run } = manualLoop();
    let shown = false;
    const home = { frames: 0, frame() { this.frames++; }, visible: () => true } satisfies PreviewItem & { frames: number };
    const chars = { frames: 0, frame() { this.frames++; }, visible: () => shown } satisfies PreviewItem & { frames: number };
    const odd = { frames: 0, frame() { this.frames++; }, visible: () => { throw new Error('x'); } } satisfies PreviewItem & { frames: number };
    loop.add(home);
    loop.add(chars);
    loop.add(odd);
    loop.setActive(true);
    run(1000);
    expect(home.frames).toBeGreaterThanOrEqual(PREVIEW_FPS - 2);
    expect(chars.frames).toBeLessThanOrEqual(1); // only the one calm still drawn when the page became active
    expect(odd.frames).toBe(home.frames);
    shown = true;
    run(500);
    expect(chars.frames).toBeGreaterThan(3);
    loop.dispose();
  });
  it('canvasShown follows layout and is lenient where the DOM cannot say', () => {
    expect(canvasShown({ isConnected: true, getClientRects: () => [{}] } as never)).toBe(true);
    expect(canvasShown({ isConnected: true, getClientRects: () => [] } as never)).toBe(false);
    expect(canvasShown({ isConnected: false, getClientRects: () => [{}] } as never)).toBe(false);
    expect(canvasShown({} as never)).toBe(true);
  });
});
