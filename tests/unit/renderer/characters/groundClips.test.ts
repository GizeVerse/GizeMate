// Cross-renderer checks of the review fixes: the clips the sim emits while the character stands on the
// ground (a slip, a hard landing, its recovery) must resolve, through each module's alias, to a pose that
// stands on the ground (the monkey's ledge swing hung 57 DIP below it, the fox's fall floated above it).
import { describe, expect, it } from 'vitest';
import type { AnimClip } from '../../../../src/shared/cat';
import { resolveForCharacter } from '../../../../src/core/behavior/character';
import { CHARACTERS } from '../../../../src/shared/characters/registry';
import type { CharacterId } from '../../../../src/shared/characters/types';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';
import { createCharacterRenderer } from '../../../../src/renderer/overlay/characters/registry';
import type { AnimInput, CharacterRenderer, GeometryCollector } from '../../../../src/renderer/overlay/character/types';

const DT = 1000 / 60;
/** Clips the sim emits while the character is on the ground: a deliberate slip, the hard-landing and its recovery. */
const GROUND_CLIPS: readonly AnimClip[] = ['slip', 'impact', 'landRecover'];
const NON_CAT = CHARACTERS.filter((m) => m.id !== 'cat').map((m) => m.id);

function input(clip: AnimClip): AnimInput {
  return { clip, clipStartedAt: 0, sleeping: false, speed: 0, vy: 0, lookX: 0, lookY: 0, hasLook: false, arousal: 0.3, contentment: 0.5, animSpeed: 1 };
}

/** Lowest drawn-body point (view y, down is positive, the ground is y = 0) and the lowest hit rect point. */
function lowest(r: CharacterRenderer): { hitLow: number; hitHigh: number } {
  let hitLow = -Infinity;
  let hitHigh = Infinity;
  const g: GeometryCollector = {
    add(_x, y, rad, hit) {
      if (hit < 0) return;
      hitLow = Math.max(hitLow, y + rad);
      hitHigh = Math.min(hitHigh, y - rad);
    },
    addGround() {},
  };
  r.measure(g);
  return { hitLow, hitHigh };
}

function settle(id: CharacterId, clip: AnimClip, ms: number): CharacterRenderer {
  const r = createCharacterRenderer(id, seededRandom(5));
  for (let t = 0; t <= ms; t += DT) r.advance(input(clip), t, t === 0 ? 0 : DT, 0, 0);
  return r;
}

describe('grounded clips draw a grounded pose in every character', () => {
  for (const id of NON_CAT) {
    it(`${id}: slip, impact and landRecover stay on the ground`, () => {
      const m = CHARACTERS.find((c) => c.id === id)!;
      const stand = lowest(settle(id, 'stand', 1500));
      for (const clip of GROUND_CLIPS) {
        const native = resolveForCharacter(m, clip);
        const at = lowest(settle(id, native, 1500));
        // Hovering characters (ghost, alien) keep their own float height; everything else must not sink
        // below the ground line nor float clear of it, relative to its own standing pose.
        expect(at.hitLow, `${clip} -> ${native}`).toBeLessThanOrEqual(stand.hitLow + 6);
        expect(at.hitLow, `${clip} -> ${native}`).toBeGreaterThanOrEqual(stand.hitLow - 4);
      }
    });
  }
});
