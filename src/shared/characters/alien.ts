// Alien: STARTER module. Identity, body, palettes, personality means and the sound voice are
// set; the character agent authors the signature actions, reactions, event affinities and the exact
// clip list that its renderer draws (src/renderer/overlay/characters/alien/).
import type { CharacterModule } from './types';

export const ALIEN_MODULE: CharacterModule = Object.freeze({
  id: 'alien',
  kind: 'fantasy',
  locomotion: 'glide',
  i18nPrefix: 'character.alien',
  body: Object.freeze({ widthDip: 76, heightDip: 80, gaitScale: 1, hitFrontExtentDip: Object.freeze({}) }),
  skins: Object.freeze(['green', 'blue', 'violet', 'silver']),
  clips: Object.freeze(['stand', 'sit', 'sleep', 'wake', 'yawn', 'walk', 'run', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'float', 'scan', 'beam', 'vanish', 'appear', 'dance'] as const),
  clipAlias: Object.freeze({}),
  personality: Object.freeze({
    means: Object.freeze({ curiosity: 0.95, energy: 0.6, playfulness: 0.5, sociability: 0.4, mischief: 0.6, affection: 0.35, independence: 0.7 }),
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
    pitch: 1.4,
    voice: 'synthetic',
    gain: 0.8,
    cooldownMs: 2500,
    cues: Object.freeze({ voice: 'bleep', happy: 'chime', startled: 'bleep' }),
  }),
  memory: Object.freeze({ kinds: 'all' }),
  capabilities: Object.freeze({ climbsEdges: false, flies: true, passesThrough: false, squashes: false }),
});
