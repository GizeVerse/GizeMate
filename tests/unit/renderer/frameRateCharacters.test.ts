// Frame-rate pacing of the GizeMate performance clips: hop, bounce, dance, swing, vanish, appear, squish and
// beam are paced at the full rate (no choppy 30 fps in-place hop), the slow loops (float, scan, peek) and the
// stretch stay calm, and the cat's pacing is exactly what it was.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, type AnimClip } from '../../../src/shared/cat';
import { CLIP_META } from '../../../src/shared/animationCatalog';
import { CALM_FRAME_MS, frameIntervalMs, FULL_RATE_MS, isFullRateClip, type FrameMotion } from '../../../src/renderer/overlay/frameRate';

const calm: FrameMotion = { clip: 'sit', state: 'idle', speed: 0, vy: 0, moved: false, transition: false, poseSpeed: 40, quiet: false };
const LONG_AGO = 10_000;

/** The cat's pacing before GizeMate: these clips (and only these) draw at the full rate. */
const CAT_FULL_RATE: readonly AnimClip[] = [
  'walk', 'run', 'crouch', 'jump', 'fall', 'land', 'startle', 'annoyed', 'pawAt', 'held', 'rollOver', 'stalk', 'sprint', 'slink', 'pounce', 'slip',
  'impact', 'landRecover', 'swat', 'hiss', 'tailChase', 'scratch', 'shake',
];
const GIZEMATE_CLIPS: readonly AnimClip[] = ['hop', 'bounce', 'float', 'vanish', 'appear', 'swing', 'squish', 'scan', 'beam', 'peek', 'dance'];

describe('frame pacing of the character clips', () => {
  it('keeps the cat byte-identical: exactly the former clip list runs at full rate among the cat clips', () => {
    for (const clip of ANIM_CLIPS) {
      if (GIZEMATE_CLIPS.includes(clip)) continue;
      expect(isFullRateClip(clip), clip).toBe(CAT_FULL_RATE.includes(clip));
      expect(frameIntervalMs({ ...calm, clip }, LONG_AGO), clip).toBe(CAT_FULL_RATE.includes(clip) ? FULL_RATE_MS : CALM_FRAME_MS);
    }
  });

  it('draws the lively in-place clips at the full rate, whatever the pose-speed heuristic says', () => {
    for (const clip of ['hop', 'bounce', 'dance', 'swing', 'vanish', 'appear', 'squish', 'beam'] as AnimClip[]) {
      // poseSpeed 100 DIP/s is a hop's peak speed: below the cat-tuned FAST_POSE_DIP_S threshold.
      expect(frameIntervalMs({ ...calm, clip, poseSpeed: 100 }, LONG_AGO), clip).toBe(FULL_RATE_MS);
    }
  });

  it('keeps the slow loops calm so a floating or scanning companion does not cost full rate forever', () => {
    for (const clip of ['float', 'scan', 'peek', 'stretch'] as AnimClip[]) {
      expect(frameIntervalMs({ ...calm, clip, poseSpeed: 60 }, LONG_AGO), clip).toBe(CALM_FRAME_MS);
    }
  });

  it('derives the shared performance clips from the catalogue instead of a cat list', () => {
    for (const clip of GIZEMATE_CLIPS) {
      const m = CLIP_META[clip];
      const derived = m.loop ? m.tags.includes('locomotion') && m.tags.includes('play') : !m.interruptible && m.priority >= 2;
      if (derived) expect(isFullRateClip(clip), clip).toBe(true);
    }
    // The two loops the tags cannot tell from the calm ones are named explicitly.
    expect(isFullRateClip('swing')).toBe(true);
    expect(isFullRateClip('dance')).toBe(true);
  });
});
