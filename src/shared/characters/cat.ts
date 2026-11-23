// The cat: the companion every existing install has. Its module describes today's behaviour exactly
// (all multipliers 1, no signature actions, no alias), so selecting it changes nothing. Existing
// settings (general.catName, appearance.skin) and the persisted cat file belong to it.
import { ANIM_CLIPS, CAT_BASE_HEIGHT_DIP, CAT_BASE_WIDTH_DIP, HIT_FRONT_EXTENT_DIP, SKINS, type AnimClip } from '../cat';
import type { CharacterModule } from './types';

/** The shared performance clips the cat does not perform (its renderer draws them as a stand). */
const NOT_THE_CATS: ReadonlySet<AnimClip> = new Set<AnimClip>(['hop', 'bounce', 'float', 'vanish', 'appear', 'swing', 'squish', 'scan', 'beam', 'peek', 'dance']);

export const CAT_MODULE: CharacterModule = Object.freeze({
  id: 'cat',
  kind: 'animal',
  locomotion: 'walk',
  i18nPrefix: 'character.cat',
  body: Object.freeze({ widthDip: CAT_BASE_WIDTH_DIP, heightDip: CAT_BASE_HEIGHT_DIP, gaitScale: 1, hitFrontExtentDip: HIT_FRONT_EXTENT_DIP }),
  skins: SKINS,
  clips: ANIM_CLIPS.filter((c) => !NOT_THE_CATS.has(c)),
  clipAlias: Object.freeze({}),
  personality: Object.freeze({
    means: Object.freeze({ curiosity: 0.6, energy: 0.55, playfulness: 0.6, sociability: 0.5, mischief: 0.35, affection: 0.6, independence: 0.45 }),
    spread: 0.2,
  }),
  behavior: Object.freeze({
    speedScale: 1,
    restBias: 1,
    exploreBias: 1,
    playBias: 1,
    cursorInterest: 1,
    jumpiness: 1,
    shyness: 1,
    eventAffinity: Object.freeze({}),
    signatures: Object.freeze([]),
  }),
  reactions: Object.freeze({}),
  sound: Object.freeze({
    pitch: 1,
    voice: 'soft',
    gain: 1,
    cooldownMs: 1500,
    cues: Object.freeze({ voice: 'meow', happy: 'purr', startled: 'hiss' }),
  }),
  memory: Object.freeze({ kinds: 'all' }),
  capabilities: Object.freeze({ climbsEdges: true, flies: false, passesThrough: false, squashes: false }),
});
