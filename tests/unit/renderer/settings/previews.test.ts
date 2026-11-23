// The live-preview loop (DOM-free): one shared low-frame-rate loop, still when motion is reduced or the
// window is hidden, nothing running without a visible preview, no leaks after dispose, and a failing
// renderer never stops the others.
import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../../../src/shared/characters/registry';
import { createCharacterRenderer } from '../../../../src/renderer/overlay/characters/registry';
import { PREVIEW_FPS, PreviewLoop, showStep, type PreviewEnv, type PreviewSurface, type RendererFactory } from '../../../../src/renderer/settings/previews';
import { setLocale } from '../../../../src/renderer/settings/strings';

afterEach(() => setLocale('en'));

class FakeEnv implements PreviewEnv {
  reduced = false;
  visible = true;
  next = 1;
  pending = new Map<number, (t: number) => void>();
  raf(cb: (t: number) => void): number {
    const id = this.next++;
    this.pending.set(id, cb);
    return id;
  }
  caf(id: number): void {
    this.pending.delete(id);
  }
  documentVisible(): boolean {
    return this.visible;
  }
  reducedMotion(): boolean {
    return this.reduced;
  }
  /** Runs the one pending frame request at `t`. */
  step(t: number): void {
    const [id, cb] = [...this.pending][0] ?? [];
    if (id === undefined || !cb) throw new Error('no frame request pending');
    this.pending.delete(id);
    cb(t);
  }
}

function surface(): PreviewSurface & { clears: number; draws: number } {
  const s = {
    width: 240,
    height: 180,
    clears: 0,
    draws: 0,
    getContext: () =>
      new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'clearRect') return () => void s.clears++;
            return () => void s.draws++;
          },
          set: () => true,
        },
      ) as never,
  };
  return s;
}

const counting = (): { factory: RendererFactory; created: number[]; advanced: () => number } => {
  const created: number[] = [];
  let advances = 0;
  const factory: RendererFactory = (id, random) => {
    created.push(1);
    const r = createCharacterRenderer(id, random);
    const advance = r.advance.bind(r);
    r.advance = (...a) => {
      advances++;
      advance(...a);
    };
    return r;
  };
  return { factory, created, advanced: () => advances };
};

describe('showStep', () => {
  it('cycles stand, sit, walk, stand and falls back to stand for clips a character lacks', () => {
    const all = ['stand', 'sit', 'walk'] as const;
    expect(showStep(0, all).clip).toBe('stand');
    expect(showStep(3300, all).clip).toBe('sit');
    expect(showStep(6300, all)).toMatchObject({ clip: 'walk', speed: 0.7 });
    expect(showStep(9000, all).clip).toBe('stand');
    // The show repeats: 10300 ms is one cycle.
    expect(showStep(10300, all)).toMatchObject({ clip: 'stand', startedAt: 10300 });
    expect(showStep(6300, ['stand']).clip).toBe('stand');
    expect(showStep(-5, all).clip).toBe('stand');
  });
});

describe('PreviewLoop', () => {
  it('runs one loop for many slots, only while one is visible and the window is visible', () => {
    const env = new FakeEnv();
    const { factory } = counting();
    const loop = new PreviewLoop(env, factory);
    const a = loop.create(surface(), 'cat', '');
    const b = loop.create(surface(), 'fox', '');
    expect(loop.running).toBe(false);
    a.setVisible(true);
    b.setVisible(true);
    expect(env.pending.size).toBe(1);
    a.setVisible(false);
    expect(loop.running).toBe(true);
    b.setVisible(false);
    expect(loop.running).toBe(false);
    expect(env.pending.size).toBe(0);
  });

  it('draws at a low frame rate, not on every animation frame', () => {
    const env = new FakeEnv();
    const { factory, advanced } = counting();
    const loop = new PreviewLoop(env, factory);
    const s = surface();
    loop.create(s, 'cat', 'ginger').setVisible(true);
    const interval = 1000 / PREVIEW_FPS;
    env.step(1000);
    const first = advanced();
    for (let t = 1004; t < 1000 + interval - 3; t += 4) env.step(t);
    expect(advanced()).toBe(first);
    env.step(1000 + interval);
    expect(advanced()).toBe(first + 1);
    expect(s.draws).toBeGreaterThan(0);
  });

  it('holds still (one frame, no loop) when motion is reduced, and resumes when it is not', () => {
    const env = new FakeEnv();
    env.reduced = true;
    const { factory, advanced } = counting();
    const loop = new PreviewLoop(env, factory);
    const s = surface();
    const slot = loop.create(s, 'cat', '');
    slot.setVisible(true);
    expect(loop.running).toBe(false);
    expect(env.pending.size).toBe(0);
    expect(s.draws).toBeGreaterThan(0);
    expect(loop.reduced).toBe(true);
    const before = advanced();
    env.reduced = false;
    loop.refresh();
    expect(loop.running).toBe(true);
    env.step(500);
    expect(advanced()).toBeGreaterThanOrEqual(before);
    env.reduced = true;
    loop.refresh();
    expect(loop.running).toBe(false);
  });

  it('pauses while the window is hidden', () => {
    const env = new FakeEnv();
    const loop = new PreviewLoop(env, counting().factory);
    loop.create(surface(), 'cat', '').setVisible(true);
    env.visible = false;
    loop.refresh();
    expect(env.pending.size).toBe(0);
    env.visible = true;
    loop.refresh();
    expect(env.pending.size).toBe(1);
  });

  it('creates a renderer lazily, per slot, and drops everything on dispose', () => {
    const env = new FakeEnv();
    const c = counting();
    const loop = new PreviewLoop(env, c.factory);
    const slots = CHARACTERS.map((m) => loop.create(surface(), m.id, ''));
    expect(c.created).toHaveLength(0);
    slots.forEach((s) => s.setVisible(true));
    env.step(100);
    env.step(200);
    expect(c.created).toHaveLength(CHARACTERS.length);
    loop.dispose();
    expect(loop.slotCount).toBe(0);
    expect(env.pending.size).toBe(0);
    // A disposed slot ignores further calls.
    slots[0]!.setVisible(true);
    expect(loop.running).toBe(false);
  });

  it('a renderer that throws stops drawing for its slot only', () => {
    const env = new FakeEnv();
    const bad: RendererFactory = (id, random) => {
      if (id === 'fox') throw new Error('broken renderer');
      return createCharacterRenderer(id, random);
    };
    const loop = new PreviewLoop(env, bad);
    const good = surface();
    loop.create(surface(), 'fox', '').setVisible(true);
    loop.create(good, 'cat', '').setVisible(true);
    env.step(100);
    env.step(300);
    expect(good.draws).toBeGreaterThan(0);
    expect(loop.running).toBe(true);
  });

  it('every character renders a preview frame with its real renderer (still and animated)', () => {
    for (const m of CHARACTERS) {
      const env = new FakeEnv();
      const loop = new PreviewLoop(env);
      const s = surface();
      const slot = loop.create(s, m.id, m.skins[0] ?? '');
      slot.setVisible(true);
      env.step(100);
      env.step(300);
      expect(s.draws, m.id).toBeGreaterThan(0);
      loop.dispose();
    }
  });
});
