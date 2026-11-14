// Fox: STARTER module. Identity, body, palettes, personality means and the sound voice are
// set; the character agent authors the signature actions, reactions, event affinities and the exact
// clip list that its renderer draws (src/renderer/overlay/characters/fox/).
import type { CharacterModule } from './types';

export const FOX_MODULE: CharacterModule = Object.freeze({
  id: 'fox',
  kind: 'animal',
  locomotion: 'walk',
  i18nPrefix: 'character.fox',
  body: Object.freeze({ widthDip: 88, heightDip: 62, gaitScale: 1.1, hitFrontExtentDip: Object.freeze({}) }),
  skins: Object.freeze(['red', 'arctic', 'silver', 'dusk']),
  clips: Object.freeze(['stand', 'sit', 'sleep', 'wake', 'yawn', 'walk', 'run', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'climb', 'pounce', 'stalk', 'peek'] as const),
  clipAlias: Object.freeze({}),
  personality: Object.freeze({
    means: Object.freeze({ curiosity: 0.75, energy: 0.65, playfulness: 0.55, sociability: 0.35, mischief: 0.65, affection: 0.4, independence: 0.85 }),
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
    pitch: 1.1,
    voice: 'soft',
    gain: 0.8,
    cooldownMs: 2500,
    cues: Object.freeze({ voice: 'yip', happy: 'chirp', startled: 'growl' }),
  }),
  memory: Object.freeze({ kinds: 'all' }),
  capabilities: Object.freeze({ climbsEdges: true, flies: false, passesThrough: false, squashes: false }),
});
