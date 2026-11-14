// Rabbit: STARTER module. Identity, body, palettes, personality means and the sound voice are
// set; the character agent authors the signature actions, reactions, event affinities and the exact
// clip list that its renderer draws (src/renderer/overlay/characters/rabbit/).
import type { CharacterModule } from './types';

export const RABBIT_MODULE: CharacterModule = Object.freeze({
  id: 'rabbit',
  kind: 'animal',
  locomotion: 'hop',
  i18nPrefix: 'character.rabbit',
  body: Object.freeze({ widthDip: 66, heightDip: 66, gaitScale: 1, hitFrontExtentDip: Object.freeze({}) }),
  skins: Object.freeze(['white', 'brown', 'gray', 'spotted']),
  clips: Object.freeze(['stand', 'sit', 'sleep', 'wake', 'yawn', 'walk', 'run', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'hop', 'groom', 'peek', 'scan'] as const),
  clipAlias: Object.freeze({}),
  personality: Object.freeze({
    means: Object.freeze({ curiosity: 0.55, energy: 0.75, playfulness: 0.65, sociability: 0.7, mischief: 0.25, affection: 0.75, independence: 0.3 }),
    spread: 0.15,
  }),
  behavior: Object.freeze({
    speedScale: 1,
    restBias: 1,
    exploreBias: 1,
    playBias: 1,
    cursorInterest: 1,
    jumpiness: 1,
    shyness: 1.4,
    eventAffinity: Object.freeze({}),
    signatures: Object.freeze([]),
  }),
  reactions: Object.freeze({}),
  sound: Object.freeze({
    pitch: 1.3,
    voice: 'soft',
    gain: 0.8,
    cooldownMs: 2500,
    cues: Object.freeze({ voice: 'squeak', happy: 'trill', startled: 'thud' }),
  }),
  memory: Object.freeze({ kinds: 'all' }),
  capabilities: Object.freeze({ climbsEdges: false, flies: false, passesThrough: false, squashes: false }),
});
