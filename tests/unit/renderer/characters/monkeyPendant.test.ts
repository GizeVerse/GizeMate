// The monkey's heart pendant hangs toward world down in every pose (a backflip turns the body upside down), as the
// fox's and the rabbit's do, instead of following the body's own down axis.
import { describe, expect, it, vi } from 'vitest';
import type * as Kit from '../../../../src/renderer/overlay/character/kit';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';

const hangs: Array<{ hx: number; hy: number }> = [];

vi.mock('../../../../src/renderer/overlay/character/kit', async (importOriginal) => {
  const real = await importOriginal<typeof Kit>();
  return {
    ...real,
    drawPendantBetween: (...args: Parameters<typeof real.drawPendantBetween>) => {
      hangs.push({ hx: args[5], hy: args[6] });
      return real.drawPendantBetween(...args);
    },
  };
});

describe('monkey pendant', () => {
  it('hangs toward world down while flipping, and its hang vector is finite', async () => {
    const { MonkeyRenderer } = await import('../../../../src/renderer/overlay/characters/monkey');
    const { createMockCtx } = await import('../mockCtx');
    const r = new MonkeyRenderer(seededRandom(3));
    const ctx = createMockCtx();
    let upsideDown = 0;
    for (let t = 0; t <= 900; t += 1000 / 60) {
      r.advance(
        { clip: 'jump', clipStartedAt: 0, sleeping: false, speed: 0, vy: -200, jumpKind: 'leap', lookX: 0, lookY: 0, hasLook: false, arousal: 0.3, contentment: 0.5, animSpeed: 1 },
        t,
        t === 0 ? 0 : 1000 / 60,
        0,
        0,
      );
      hangs.length = 0;
      r.draw(ctx.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 1, skin: '', accessory: 'heartPendant' });
      expect(hangs.length).toBe(1);
      const m = r.rig.m;
      const vx = m[0]! * hangs[0]!.hx + m[2]! * hangs[0]!.hy;
      const vy = m[1]! * hangs[0]!.hx + m[3]! * hangs[0]!.hy;
      const len = Math.hypot(vx, vy);
      expect(len).toBeGreaterThan(0);
      // In view space (y down) the heart points straight down whatever the body does.
      expect(vx / len).toBeCloseTo(0, 6);
      expect(vy / len).toBeCloseTo(1, 6);
      if (m[3]! < -0.5) upsideDown++;
    }
    // The sweep really passed through upside-down poses.
    expect(upsideDown).toBeGreaterThan(3);
  });
});
