// The monkey, fox and rabbit renderers hand the scene's DrawParams straight to their painter: no fresh options
// object is built on every drawn frame.
import { describe, expect, it, vi } from 'vitest';
import type * as MonkeyDraw from '../../../../src/renderer/overlay/characters/monkey/draw';
import type * as FoxDraw from '../../../../src/renderer/overlay/characters/fox/draw';
import type * as RabbitDraw from '../../../../src/renderer/overlay/characters/rabbit/draw';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';

const seen: Record<string, unknown[]> = { monkey: [], fox: [], rabbit: [] };

vi.mock('../../../../src/renderer/overlay/characters/monkey/draw', async (importOriginal) => {
  const real = await importOriginal<typeof MonkeyDraw>();
  return { ...real, drawMonkey: (...a: Parameters<typeof real.drawMonkey>) => (seen.monkey!.push(a[5]), real.drawMonkey(...a)) };
});
vi.mock('../../../../src/renderer/overlay/characters/fox/draw', async (importOriginal) => {
  const real = await importOriginal<typeof FoxDraw>();
  return { ...real, drawFox: (...a: Parameters<typeof real.drawFox>) => (seen.fox!.push(a[5]), real.drawFox(...a)) };
});
vi.mock('../../../../src/renderer/overlay/characters/rabbit/draw', async (importOriginal) => {
  const real = await importOriginal<typeof RabbitDraw>();
  return { ...real, drawRabbit: (...a: Parameters<typeof real.drawRabbit>) => (seen.rabbit!.push(a[4]), real.drawRabbit(...a)) };
});

describe('draw() allocates no options object', () => {
  it('passes the DrawParams it was given to the painter', async () => {
    const { createMockCtx } = await import('../mockCtx');
    const { createCharacterRenderer } = await import('../../../../src/renderer/overlay/characters/registry');
    const o = { outline: 1.6, shadow: false, pixelsPerUnit: 1, skin: '' };
    for (const id of ['monkey', 'fox', 'rabbit'] as const) {
      const r = createCharacterRenderer(id, seededRandom(1));
      r.advance({ clip: 'stand', clipStartedAt: 0, sleeping: false, speed: 0, vy: 0, lookX: 0, lookY: 0, hasLook: false, arousal: 0.3, contentment: 0.5, animSpeed: 1 }, 0, 0, 0, 0);
      r.draw(createMockCtx().ctx, o);
      expect(seen[id]!.length, id).toBe(1);
      expect(seen[id]![0], id).toBe(o);
    }
  });
});
