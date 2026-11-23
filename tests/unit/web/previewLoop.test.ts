// The shared preview loop of the web panels (src/web/ui/previewLoop.ts) with a manual frame clock: one loop
// for every preview, nothing scheduled while the page is hidden, the panel is closed or reduced motion is
// on, a still frame instead of animation under reduced motion, and no leftovers after dispose.
// REAL: executes the loop logic; the browser's requestAnimationFrame is replaced by a manual clock (MOCKED).
import { describe, expect, it } from 'vitest';
import { createPreviewLoop, PREVIEW_FPS, type PreviewItem } from '../../../src/web/ui/previewLoop';

function harness() {
  let now = 0;
  let next = 1;
  const queue = new Map<number, (t: number) => void>();
  let hidden = false;
  const visibility = new Set<() => void>();
  const loop = createPreviewLoop({
    raf: (cb) => {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    caf: (id) => void queue.delete(id),
    hidden: () => hidden,
    onVisibility: (cb) => {
      visibility.add(cb);
      return () => void visibility.delete(cb);
    },
  });
  /** Advances `ms` of wall time in 60 Hz frames, running the scheduled callback each frame. */
  const run = (ms: number): void => {
    const end = now + ms;
    while (now < end) {
      now += 1000 / 60;
      const due = [...queue.entries()];
      queue.clear();
      for (const [, cb] of due) cb(now);
    }
  };
  return {
    loop,
    run,
    pending: () => queue.size,
    setHidden(v: boolean) {
      hidden = v;
      for (const cb of [...visibility]) cb();
    },
    listeners: () => visibility.size,
  };
}

function counter(): PreviewItem & { frames: number; stills: number; lastDt: number } {
  const c = {
    frames: 0,
    stills: 0,
    lastDt: 0,
    frame(_t: number, dt: number) {
      c.frames += 1;
      c.lastDt = dt;
    },
    still() {
      c.stills += 1;
    },
  };
  return c;
}

describe('the shared preview loop', () => {
  it('schedules nothing until the page is active and has a preview', () => {
    const t = harness();
    const a = counter();
    t.loop.add(a);
    expect(t.pending()).toBe(0);
    expect(t.loop.running).toBe(false);
    t.run(500);
    expect(a.frames).toBe(0);
    t.loop.setActive(true);
    expect(t.loop.running).toBe(true);
    expect(t.pending()).toBe(1);
  });

  it('draws every preview from ONE callback at a low frame rate', () => {
    const t = harness();
    const items = [counter(), counter(), counter()];
    for (const i of items) t.loop.add(i);
    t.loop.setActive(true);
    expect(t.pending()).toBe(1);
    t.run(1000);
    for (const i of items) {
      expect(i.frames).toBeGreaterThanOrEqual(PREVIEW_FPS - 2);
      expect(i.frames).toBeLessThanOrEqual(PREVIEW_FPS + 1);
    }
    expect(t.pending()).toBe(1);
  });

  it('stops scheduling when the page becomes inactive, and again when the document is hidden', () => {
    const t = harness();
    const a = counter();
    t.loop.add(a);
    t.loop.setActive(true);
    t.run(300);
    t.loop.setActive(false);
    expect(t.pending()).toBe(0);
    const frames = a.frames;
    t.run(500);
    expect(a.frames).toBe(frames);
    t.loop.setActive(true);
    expect(t.pending()).toBe(1);
    t.setHidden(true);
    expect(t.pending()).toBe(0);
    expect(t.loop.running).toBe(false);
    t.setHidden(false);
    expect(t.pending()).toBe(1);
  });

  it('under reduced motion never animates: one still frame per preview, no callback', () => {
    const t = harness();
    const a = counter();
    t.loop.setReducedMotion(true);
    t.loop.add(a);
    t.loop.setActive(true);
    expect(t.pending()).toBe(0);
    expect(a.stills).toBeGreaterThanOrEqual(1);
    t.run(1000);
    expect(a.frames).toBe(0);
    const b = counter();
    t.loop.add(b);
    expect(b.stills).toBe(1);
    expect(t.pending()).toBe(0);
    t.loop.setReducedMotion(false);
    expect(t.pending()).toBe(1);
    t.run(500);
    expect(a.frames).toBeGreaterThan(0);
    t.loop.setReducedMotion(true);
    expect(t.pending()).toBe(0);
  });

  it('caps a long stall to one small step', () => {
    const t = harness();
    const a = counter();
    t.loop.add(a);
    t.loop.setActive(true);
    t.run(200);
    t.setHidden(true);
    t.run(60_000);
    t.setHidden(false);
    t.run(200);
    expect(a.lastDt).toBeLessThanOrEqual(250);
  });

  it('removes a preview with its returned function, and stops when none is left', () => {
    const t = harness();
    const a = counter();
    const b = counter();
    const removeA = t.loop.add(a);
    t.loop.add(b);
    t.loop.setActive(true);
    removeA();
    expect(t.loop.size).toBe(1);
    const frames = a.frames;
    t.run(500);
    expect(a.frames).toBe(frames);
    expect(b.frames).toBeGreaterThan(0);
  });

  it('a throwing preview does not stop the others', () => {
    const t = harness();
    const good = counter();
    t.loop.add({ frame: () => { throw new Error('broken'); }, still: () => { throw new Error('broken'); } });
    t.loop.add(good);
    t.loop.setActive(true);
    t.run(500);
    expect(good.frames).toBeGreaterThan(0);
  });

  it('dispose ends the loop, forgets every preview and unsubscribes', () => {
    const t = harness();
    t.loop.add(counter());
    t.loop.setActive(true);
    expect(t.listeners()).toBe(1);
    t.loop.dispose();
    expect(t.pending()).toBe(0);
    expect(t.loop.size).toBe(0);
    expect(t.listeners()).toBe(0);
    t.loop.add(counter());
    expect(t.loop.size).toBe(0);
    t.loop.setActive(true);
    expect(t.pending()).toBe(0);
  });
});
