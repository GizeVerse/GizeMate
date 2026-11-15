// The seven-dimension personality view (GizeMate). The shipped storage format keeps the seven
// stored traits (catState.ts Traits) and the drives; this module derives a read-only view of seven
// dimensions from them and, for a NEW companion of a non-cat character, the inverse mapping from the
// character's means to stored traits. Nothing here changes what is persisted. Pure, platform-agnostic.
import type { Drives, Traits } from '../catState';
import type { SevenTraits } from './types';

const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

/** The stored fields the view reads (a persisted cat's `traits` and, when known, its `drives.mischief`). */
export interface SevenSource {
  readonly traits: Traits;
  readonly drives?: Pick<Drives, 'mischief'> | undefined;
}

/** What the neutral mischief drive reads as when a state carries no drives (a fresh companion's default). */
export const DEFAULT_MISCHIEF_DRIVE = 0.3;

/**
 * sevenTraitsOf: the derived, read-only seven-dimension view. All results are 0..1.
 *
 *   curiosity     = curiosity
 *   energy        = 0.6 * energyLevel + 0.4 * (1 - laziness)
 *   playfulness   = playfulness
 *   sociability   = 0.55 * affection + 0.45 * confidence
 *   mischief      = 0.4 * playfulness + 0.6 * drives.mischief      (the drive is 0.3 when absent)
 *   affection     = affection
 *   independence  = 0.6 * confidence + 0.4 * (1 - affection)
 *
 * The stored traits are the born ones (cat.traits); a chosen named personality changes what the sim
 * acts on, never this view of the stored companion.
 */
export function sevenTraitsOf(source: SevenSource): SevenTraits {
  const t = source.traits;
  const m = source.drives?.mischief ?? DEFAULT_MISCHIEF_DRIVE;
  return {
    curiosity: clamp01(t.curiosity),
    energy: clamp01(0.6 * t.energyLevel + 0.4 * (1 - t.laziness)),
    playfulness: clamp01(t.playfulness),
    sociability: clamp01(0.55 * t.affection + 0.45 * t.confidence),
    mischief: clamp01(0.4 * t.playfulness + 0.6 * m),
    affection: clamp01(t.affection),
    independence: clamp01(0.6 * t.confidence + 0.4 * (1 - t.affection)),
  };
}

/**
 * The inverse for a newborn non-cat companion: stored traits (and the initial mischief drive) that
 * sevenTraitsOf maps back to approximately `seven` (exact for curiosity, energy, playfulness and
 * affection; sociability and independence share the one stored confidence, so they meet in the
 * middle; mischief goes to the drive). `startleSensitivity` is left to the caller (it has its own
 * seeded rule). Values are clamped to the stored 0..1 range; the caller applies the trait band.
 */
export function storedFromSeven(seven: SevenTraits): { traits: Omit<Traits, 'startleSensitivity'>; mischiefDrive: number } {
  const affection = clamp01(seven.affection);
  const playfulness = clamp01(seven.playfulness);
  const energy = clamp01(seven.energy);
  const fromSociability = (seven.sociability - 0.55 * affection) / 0.45;
  const fromIndependence = (seven.independence - 0.4 * (1 - affection)) / 0.6;
  return {
    traits: {
      curiosity: clamp01(seven.curiosity),
      playfulness,
      affection,
      confidence: clamp01(0.5 * fromSociability + 0.5 * fromIndependence),
      energyLevel: energy,
      laziness: clamp01(1 - energy),
    },
    mischiefDrive: clamp01((seven.mischief - 0.4 * playfulness) / 0.6),
  };
}

/** Draws seven dimensions around `means` with a triangular spread, from `random` (the caller's dedicated stream). */
export function drawSevenTraits(means: SevenTraits, spread: number, random: () => number): SevenTraits {
  const s = Number.isFinite(spread) && spread >= 0 ? spread : 0;
  const draw = (mean: number): number => clamp01(mean + (random() + random() - 1) * s);
  return {
    curiosity: draw(means.curiosity),
    energy: draw(means.energy),
    playfulness: draw(means.playfulness),
    sociability: draw(means.sociability),
    mischief: draw(means.mischief),
    affection: draw(means.affection),
    independence: draw(means.independence),
  };
}
