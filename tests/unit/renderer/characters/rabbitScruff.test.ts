// The rabbit's held pose pins its pivot to the shared HELD_SCRUFF (core/interaction/held), not a copy of its value.
import { describe, expect, it, vi } from 'vitest';
import type * as Held from '../../../../src/core/interaction/held';

vi.mock('../../../../src/core/interaction/held', async (importOriginal) => {
  const real = await importOriginal<typeof Held>();
  return { ...real, HELD_SCRUFF_DIP: { x: -5, y: -44 } as const };
});

describe('rabbit held pivot', () => {
  it('follows HELD_SCRUFF_DIP', async () => {
    const { createPose } = await import('../../../../src/renderer/overlay/characters/rabbit/pose');
    const { sampleClip } = await import('../../../../src/renderer/overlay/characters/rabbit/clips');
    const p = createPose();
    sampleClip(p, 'held', { t: 1, cycle: 0, speed: 0, vy: 0, impact: 0, arousal: 0 });
    expect(p.pivX).toBe(-5);
    expect(p.pivY).toBe(-44);
  });
});
