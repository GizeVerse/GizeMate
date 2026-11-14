// Monkey: STARTER module. Identity, body, palettes, personality means and the sound voice are
// set; the character agent authors the signature actions, reactions, event affinities and the exact
// clip list that its renderer draws (src/renderer/overlay/characters/monkey/).
import type { CharacterModule } from './types';

export const MONKEY_MODULE: CharacterModule = Object.freeze({
  id: 'monkey',
  kind: 'animal',
  locomotion: 'walk',
  i18nPrefix: 'character.monkey',
  body: Object.freeze({ widthDip: 72, heightDip: 86, gaitScale: 1.15, hitFrontExtentDip: Object.freeze({}) }),
  skins: Object.freeze(['brown', 'golden', 'gray', 'cream', 'black']),
  clips: Object.freeze(['stand', 'sit', 'sleep', 'wake', 'yawn', 'walk', 'run', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'climb', 'swing', 'scratch', 'dance', 'peek'] as const),
  clipAlias: Object.freeze({}),
  personality: Object.freeze({
    means: Object.freeze({ curiosity: 0.85, energy: 0.85, playfulness: 0.85, sociability: 0.7, mischief: 0.7, affection: 0.55, independence: 0.35 }),
    spread: 0.15,
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
    pitch: 1.25,
    voice: 'bright',
    gain: 0.8,
    cooldownMs: 2500,
    cues: Object.freeze({ voice: 'chatter', happy: 'chirp', startled: 'squeak' }),
  }),
  memory: Object.freeze({ kinds: 'all' }),
  capabilities: Object.freeze({ climbsEdges: true, flies: false, passesThrough: false, squashes: false }),
});
