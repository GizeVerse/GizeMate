// Ghost: a soft, translucent sheet ghost that floats, bobs, slips through props, vanishes and
// reappears elsewhere. Playful, mischievous and curious, never scary: every trick is harmless.
// Its renderer lives in src/renderer/overlay/characters/ghost/; copy in src/shared/i18n/characters/ghost.ts.
import type { AnimClip } from '../cat';
import type { CharacterModule, ReactionSpec, SignatureAction } from './types';

const sig = (s: SignatureAction): SignatureAction => Object.freeze({ ...s, ...(s.requires ? { requires: Object.freeze({ ...s.requires }) } : {}), ...(s.traitBias ? { traitBias: Object.freeze({ ...s.traitBias }) } : {}) });
const rx = (r: ReactionSpec): ReactionSpec => Object.freeze({ ...r });

/** Clips the ghost renderer draws natively (every other clip resolves through clipAlias). */
const CLIPS: readonly AnimClip[] = [
  'stand', 'sit', 'loaf', 'sleep', 'wake', 'yawn', 'float', 'crouch', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide',
  'peek', 'vanish', 'appear', 'dance', 'scan', 'squish', 'beam', 'annoyed', 'confused', 'shake',
  // Authored for the ghost (they used to be aliases of wake, sit, confused, yawn, scan, startle, petted and land).
  'stretch', 'groom', 'scratch', 'meow', 'pawAt', 'swat', 'rollOver', 'tailChase', 'impact',
];

export const GHOST_MODULE: CharacterModule = Object.freeze({
  id: 'ghost',
  kind: 'fantasy',
  locomotion: 'float',
  i18nPrefix: 'character.ghost',
  body: Object.freeze({ widthDip: 64, heightDip: 84, gaitScale: 0.9, hitFrontExtentDip: Object.freeze({ crouch: 40, land: 42, impact: 60, pawAt: 60, swat: 60, rollOver: 60, tailChase: 56 }) }),
  skins: Object.freeze(['pale', 'mint', 'lavender', 'midnight', 'peach']),
  clips: Object.freeze(CLIPS),
  clipAlias: Object.freeze({
    // Gaits never reach the renderer from the sim: the 'float' locomotion restyles them to float (rate follows speed).
    walk: 'float', run: 'float', stalk: 'float', slink: 'float', sprint: 'float', climb: 'float', balance: 'float', hop: 'float', bounce: 'float',
    edgeSit: 'sit', pounce: 'jump', slip: 'startle', grumpy: 'annoyed', swing: 'held',
    // A defensive hiss is a harmless "boo": the sheet swells, mouth wide, a glow flare, then a giggle.
    hiss: 'beam',
    // Shaking itself off is how it recovers from a hard landing (wake drew a sleepy, dimmed sheet).
    landRecover: 'shake',
  } as const),
  personality: Object.freeze({
    means: Object.freeze({ curiosity: 0.7, energy: 0.55, playfulness: 0.8, sociability: 0.55, mischief: 0.9, affection: 0.5, independence: 0.6 }),
    spread: 0.15,
  }),
  behavior: Object.freeze({
    speedScale: 1.05,
    restBias: 0.8,
    exploreBias: 1.25,
    playBias: 1.3,
    cursorInterest: 1.3,
    jumpiness: 0.7,
    shyness: 0.8,
    eventAffinity: Object.freeze({
      littleGhost: 3,
      shadowVisitor: 1.8,
      magicSparkles: 2,
      bubbleParty: 1.6,
      butterflyEncounter: 1.4,
      fallingLeaf: 1.5,
      boxAppears: 1.6,
      yarnTrouble: 1.3,
      fallingStar: 1.5,
      tinyUfo: 1.2,
      windGust: 1.1,
      mouseEncounter: 0.7,
      thunderstorm: 0.5,
      miniTsunami: 0.4,
    }),
    signatures: Object.freeze([
      // The highest-value trick: fade out in a swirl of sparkles, pop up somewhere else and look around.
      sig({ id: 'vanishAppear', clip: 'scan', weight: 3, cooldownMs: 40_000, durationMs: [1400, 2400], movement: 'teleport', emote: 'sparkle', sound: 'whoo', traitBias: { mischief: 0.6, playfulness: 0.3 } }),
      sig({ id: 'peekaboo', clip: 'peek', leadIn: ['hide'], weight: 2, cooldownMs: 60_000, durationMs: [3500, 6000], emote: 'sparkle', sound: 'chime', traitBias: { playfulness: 0.5, mischief: 0.3 } }),
      sig({ id: 'boo', clip: 'beam', weight: 1.6, cooldownMs: 90_000, durationMs: [1500, 1900], emote: 'exclaim', sound: 'whoo', traitBias: { mischief: 0.8 } }),
      sig({ id: 'hauntDrift', clip: 'float', weight: 1.4, cooldownMs: 75_000, durationMs: [2500, 4000], movement: 'random-hop', emote: 'note', sound: 'whoo', requires: { notWhileSleepy: true }, traitBias: { energy: 0.4, independence: 0.3 } }),
      sig({ id: 'phaseThrough', clip: 'squish', weight: 1.3, cooldownMs: 75_000, durationMs: [700, 1200], movement: 'random-hop', emote: 'sparkle', sound: 'chime', requires: { notWhileSleepy: true }, traitBias: { curiosity: 0.5 } }),
      sig({ id: 'spinFloat', clip: 'dance', weight: 1.4, cooldownMs: 50_000, durationMs: [2500, 4000], emote: 'note', sound: 'chime', requires: { minEnergy: 0.3, notWhileSleepy: true }, traitBias: { playfulness: 0.6, energy: 0.3 } }),
      sig({ id: 'giggleFit', clip: 'shake', weight: 1, cooldownMs: 45_000, durationMs: [1100, 1800], emote: 'heart', sound: 'chime', traitBias: { affection: 0.4, playfulness: 0.3 } }),
      sig({ id: 'curiousScan', clip: 'scan', weight: 1.2, cooldownMs: 25_000, durationMs: [3000, 5000], emote: 'question', requires: { notWhileSleepy: true }, traitBias: { curiosity: 0.7 } }),
    ]),
  }),
  reactions: Object.freeze({
    petted: rx({ clip: 'petted', emote: 'heart', sound: 'chime', mood: 'happy' }),
    held: rx({ clip: 'held', emote: 'sparkle', mood: 'curious' }),
    startled: rx({ clip: 'startle', emote: 'exclaim', sound: 'whoo', mood: 'startled' }),
    cursorNear: rx({ clip: 'peek', emote: 'question', mood: 'curious' }),
    laser: rx({ clip: 'crouch', emote: 'note', sound: 'chime', mood: 'excited', durationMs: 2500 }),
    ghost: rx({ clip: 'dance', emote: 'heart', sound: 'chime', mood: 'happy', durationMs: 4000 }),
    box: rx({ clip: 'hide', emote: 'sparkle', sound: 'whoo', mood: 'curious', durationMs: 3000 }),
    leaf: rx({ clip: 'float', emote: 'note', mood: 'relaxed', durationMs: 3000 }),
    butterfly: rx({ clip: 'scan', emote: 'sparkle', mood: 'curious', durationMs: 3500 }),
    goldenButterfly: rx({ clip: 'dance', emote: 'sparkle', sound: 'chime', mood: 'excited', durationMs: 3500 }),
    yarn: rx({ clip: 'squish', emote: 'note', sound: 'chime', mood: 'excited', durationMs: 2500 }),
    bubble: rx({ clip: 'dance', emote: 'note', sound: 'chime', mood: 'happy', durationMs: 3500 }),
    ball: rx({ clip: 'crouch', emote: 'exclaim', mood: 'excited', durationMs: 2500 }),
    cloud: rx({ clip: 'float', emote: 'heart', mood: 'relaxed', durationMs: 3500 }),
    star: rx({ clip: 'scan', emote: 'sparkle', mood: 'curious', durationMs: 3500 }),
    shadow: rx({ clip: 'peek', emote: 'question', mood: 'curious', durationMs: 3500 }),
    visitor: rx({ clip: 'peek', emote: 'heart', mood: 'happy', durationMs: 3500 }),
  }),
  sound: Object.freeze({
    pitch: 0.8,
    voice: 'hollow',
    gain: 0.9,
    cooldownMs: 3000,
    cues: Object.freeze({ voice: 'whoo', happy: 'chime', startled: 'whoo', move: 'whoo' }),
  }),
  memory: Object.freeze({ kinds: Object.freeze(['pet', 'nap', 'inspect', 'startle', 'play', 'attention', 'greet', 'hide', 'chase', 'called']) }),
  capabilities: Object.freeze({ climbsEdges: false, flies: true, passesThrough: true, squashes: false }),
});
