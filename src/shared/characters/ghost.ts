// Ghost: STARTER module. Identity, body, palettes, personality means and the sound voice are
// set; the character agent authors the signature actions, reactions, event affinities and the exact
// clip list that its renderer draws (src/renderer/overlay/characters/ghost/).
import type { CharacterModule } from './types';

export const GHOST_MODULE: CharacterModule = Object.freeze({
  id: 'ghost',
  kind: 'fantasy',
  locomotion: 'float',
  i18nPrefix: 'character.ghost',
  body: Object.freeze({ widthDip: 64, heightDip: 84, gaitScale: 0.9, hitFrontExtentDip: Object.freeze({}) }),
  skins: Object.freeze(['pale', 'mint', 'lavender', 'midnight']),
  clips: Object.freeze(['stand', 'sit', 'sleep', 'wake', 'yawn', 'walk', 'run', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'float', 'vanish', 'appear', 'peek', 'dance'] as const),
  clipAlias: Object.freeze({}),
  personality: Object.freeze({
    means: Object.freeze({ curiosity: 0.7, energy: 0.5, playfulness: 0.75, sociability: 0.55, mischief: 0.9, affection: 0.5, independence: 0.6 }),
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
    pitch: 0.8,
    voice: 'hollow',
    gain: 0.8,
    cooldownMs: 2500,
    cues: Object.freeze({ voice: 'whoo', happy: 'chime', startled: 'whoo' }),
  }),
  memory: Object.freeze({ kinds: 'all' }),
  capabilities: Object.freeze({ climbsEdges: false, flies: true, passesThrough: true, squashes: false }),
});
