// Slime: STARTER module. Identity, body, palettes, personality means and the sound voice are
// set; the character agent authors the signature actions, reactions, event affinities and the exact
// clip list that its renderer draws (src/renderer/overlay/characters/slime/).
import type { CharacterModule } from './types';

export const SLIME_MODULE: CharacterModule = Object.freeze({
  id: 'slime',
  kind: 'fantasy',
  locomotion: 'bounce',
  i18nPrefix: 'character.slime',
  body: Object.freeze({ widthDip: 70, heightDip: 58, gaitScale: 0.95, hitFrontExtentDip: Object.freeze({}) }),
  skins: Object.freeze(['lime', 'berry', 'ocean', 'sunset']),
  clips: Object.freeze(['stand', 'sit', 'sleep', 'wake', 'yawn', 'walk', 'run', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'bounce', 'squish', 'stretch', 'dance'] as const),
  clipAlias: Object.freeze({}),
  personality: Object.freeze({
    means: Object.freeze({ curiosity: 0.5, energy: 0.7, playfulness: 0.9, sociability: 0.65, mischief: 0.5, affection: 0.7, independence: 0.3 }),
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
    pitch: 1,
    voice: 'squelchy',
    gain: 0.8,
    cooldownMs: 2500,
    cues: Object.freeze({ voice: 'squelch', happy: 'boing', startled: 'squeak' }),
  }),
  memory: Object.freeze({ kinds: 'all' }),
  capabilities: Object.freeze({ climbsEdges: false, flies: false, passesThrough: false, squashes: true }),
});
