// Monkey: a curious, restless, slightly mischievous climber. Long arms, a hunched knuckle-walk,
// a prehensile tail and a face that says everything. Lively between the occasional signature
// bits: it explores more, rests less, gets bored quickly and always watches the cursor.
import type { AnimClip } from '../cat';
import type { CharacterModule, ReactionSpec, SignatureAction } from './types';

/** Clips the monkey's renderer draws natively (src/renderer/overlay/characters/monkey/clips.ts). */
const CLIPS: readonly AnimClip[] = [
  'stand', 'sit', 'loaf', 'sleep', 'wake', 'yawn', 'walk', 'run', 'crouch', 'jump', 'fall', 'land',
  'startle', 'annoyed', 'petted', 'groom', 'pawAt', 'held', 'meow', 'hide', 'climb', 'scratch', 'shake',
  'stretch', 'hop', 'swing', 'scan', 'peek', 'dance',
];

const sig = (s: SignatureAction): SignatureAction => Object.freeze({ ...s, ...(s.requires ? { requires: Object.freeze({ ...s.requires }) } : {}) });
const react = (r: ReactionSpec): ReactionSpec => Object.freeze({ ...r });

export const MONKEY_MODULE: CharacterModule = Object.freeze({
  id: 'monkey',
  kind: 'animal',
  locomotion: 'walk',
  i18nPrefix: 'character.monkey',
  body: Object.freeze({
    widthDip: 72,
    heightDip: 86,
    gaitScale: 1.05,
    // How far past the anchor the hit region may reach in front (arms reach out when it grabs or crouches).
    hitFrontExtentDip: Object.freeze({ pawAt: 62, crouch: 52, hop: 50, land: 52, startle: 46, meow: 44, scan: 48, dance: 48, stretch: 46 }),
  }),
  skins: Object.freeze(['brown', 'golden', 'gray', 'cream', 'black']),
  clips: Object.freeze([...CLIPS]),
  clipAlias: Object.freeze({
    confused: 'scratch',
    rollOver: 'dance',
    stalk: 'walk',
    slink: 'walk',
    sprint: 'run',
    pounce: 'jump',
    slip: 'startle',
    impact: 'land',
    landRecover: 'scan',
    swat: 'pawAt',
    hiss: 'startle',
    grumpy: 'annoyed',
    balance: 'crouch',
    tailChase: 'dance',
    edgeSit: 'sit',
    bounce: 'hop',
    float: 'fall',
    vanish: 'hide',
    appear: 'peek',
    squish: 'land',
    beam: 'meow',
  } as const),
  personality: Object.freeze({
    means: Object.freeze({ curiosity: 0.88, energy: 0.86, playfulness: 0.88, sociability: 0.7, mischief: 0.72, affection: 0.55, independence: 0.32 }),
    spread: 0.14,
  }),
  behavior: Object.freeze({
    speedScale: 1.1,
    restBias: 0.55,
    exploreBias: 1.5,
    playBias: 1.6,
    cursorInterest: 1.7,
    jumpiness: 1.5,
    shyness: 0.55,
    eventAffinity: Object.freeze({
      butterflyEncounter: 2.2,
      fallingLeaf: 1.4,
      yarnTrouble: 1.7,
      boxAppears: 1.6,
      mysteriousBall: 1.5,
      toySpring: 1.8,
      bubbleParty: 1.5,
      curiousBird: 1.5,
      tinyTreasure: 1.7,
      magicSparkles: 1.2,
      paperPlane: 1.4,
      flyingFish: 1.2,
      fallingStar: 1.2,
      mouseEncounter: 0.9,
      windGust: 0.8,
      littleGhost: 0.55,
      shadowVisitor: 0.5,
      thunderstorm: 0.45,
      miniTsunami: 0.5,
    }),
    signatures: Object.freeze([
      // Hangs from the ledge by its hands and swings, legs dangling, tail curled up.
      sig({ id: 'ledgeSwing', clip: 'swing', weight: 1.1, cooldownMs: 90_000, durationMs: [4500, 8000], requires: { needsLedge: true, minEnergy: 0.3 }, traitBias: { energy: 0.5, playfulness: 0.4 }, emote: 'note', sound: 'chatter' }),
      // A standing backflip, a few times in a row, with a victory pose.
      sig({ id: 'backflip', clip: 'hop', weight: 0.8, cooldownMs: 150_000, durationMs: [3400, 5200], requires: { minEnergy: 0.45, notWhileSleepy: true }, traitBias: { energy: 0.6, playfulness: 0.4 }, emote: 'sparkle', sound: 'boing' }),
      // Silly dancing: pumping arms, bouncing knees, whipping tail.
      sig({ id: 'sillyDance', clip: 'dance', weight: 0.9, cooldownMs: 100_000, durationMs: [5000, 9000], requires: { minEnergy: 0.35, notWhileSleepy: true }, traitBias: { playfulness: 0.6 }, emote: 'note', sound: 'chatter' }),
      // The iconic ponder: a long head scratch, then the armpit.
      sig({ id: 'headScratch', clip: 'scratch', weight: 1.1, cooldownMs: 60_000, durationMs: [3500, 6500], traitBias: { curiosity: 0.4 }, emote: 'question' }),
      // Ducks behind its hands and peeks out.
      sig({ id: 'peekaboo', clip: 'peek', leadIn: ['hide'], weight: 0.8, cooldownMs: 120_000, durationMs: [4500, 7500], traitBias: { playfulness: 0.5, mischief: 0.4 }, emote: 'sparkle', sound: 'chirp' }),
      // Comes over to the cursor and copies it: leans, reaches, follows every move.
      sig({ id: 'cursorMimic', clip: 'pawAt', weight: 1.4, cooldownMs: 75_000, durationMs: [4000, 7500], requires: { cursorNear: true }, movement: 'toward-cursor', traitBias: { mischief: 0.5, curiosity: 0.4 }, emote: 'question' }),
      // Chest-beating hoot.
      sig({ id: 'chestBeat', clip: 'meow', weight: 0.7, cooldownMs: 110_000, durationMs: [900, 1600], requires: { minEnergy: 0.4 }, traitBias: { mischief: 0.4 }, emote: 'exclaim', sound: 'chatter' }),
      // Hand over the brow, surveying the territory.
      sig({ id: 'surveyHorizon', clip: 'scan', weight: 0.9, cooldownMs: 70_000, durationMs: [4000, 7000], traitBias: { curiosity: 0.5 }, emote: 'question' }),
      // Primate grooming: picks over its own fur.
      sig({ id: 'pickFleas', clip: 'groom', weight: 0.7, cooldownMs: 120_000, durationMs: [5000, 9000], requires: { maxEnergy: 0.75 }, traitBias: { independence: 0.3 } }),
    ]),
  }),
  reactions: Object.freeze({
    petted: react({ clip: 'petted', emote: 'heart', sound: 'trill', durationMs: 3500, mood: 'happy' }),
    held: react({ clip: 'held', emote: 'exclaim', sound: 'squeak', durationMs: 3000, mood: 'startled' }),
    startled: react({ clip: 'startle', emote: 'exclaim', sound: 'squeak', durationMs: 2600, mood: 'startled' }),
    cursorNear: react({ clip: 'pawAt', emote: 'sparkle', durationMs: 3500, mood: 'curious' }),
    laser: react({ clip: 'crouch', emote: 'exclaim', sound: 'chatter', durationMs: 3500, mood: 'excited' }),
    yarn: react({ clip: 'pawAt', emote: 'sparkle', sound: 'chirp', durationMs: 4000, mood: 'excited' }),
    box: react({ clip: 'peek', emote: 'question', sound: 'chatter', durationMs: 4000, mood: 'curious' }),
    butterfly: react({ clip: 'hop', emote: 'sparkle', sound: 'chirp', durationMs: 4000, mood: 'excited' }),
    goldenButterfly: react({ clip: 'hop', emote: 'sparkle', sound: 'chirp', durationMs: 4500, mood: 'excited' }),
    leaf: react({ clip: 'scan', emote: 'question', durationMs: 3500, mood: 'curious' }),
    ball: react({ clip: 'pawAt', emote: 'exclaim', sound: 'boing', durationMs: 3500, mood: 'excited' }),
    mouse: react({ clip: 'startle', emote: 'exclaim', sound: 'squeak', durationMs: 2500, mood: 'scared' }),
    ghost: react({ clip: 'hide', emote: 'exclaim', sound: 'squeak', durationMs: 3500, mood: 'scared' }),
    raindrop: react({ clip: 'annoyed', emote: 'anger', durationMs: 3500, mood: 'confused' }),
    bolt: react({ clip: 'startle', emote: 'exclaim', sound: 'squeak', durationMs: 2600, mood: 'scared' }),
    bird: react({ clip: 'scan', emote: 'question', sound: 'chatter', durationMs: 4000, mood: 'curious' }),
    bubble: react({ clip: 'pawAt', emote: 'sparkle', durationMs: 3500, mood: 'happy' }),
    star: react({ clip: 'scan', emote: 'sparkle', durationMs: 3500, mood: 'curious' }),
    meteor: react({ clip: 'scan', emote: 'sparkle', durationMs: 3500, mood: 'excited' }),
    treasure: react({ clip: 'dance', emote: 'sparkle', sound: 'chatter', durationMs: 4500, mood: 'excited' }),
    sparkle: react({ clip: 'dance', emote: 'note', durationMs: 3500, mood: 'happy' }),
    dragon: react({ clip: 'hide', emote: 'exclaim', sound: 'squeak', durationMs: 4000, mood: 'scared' }),
    spring: react({ clip: 'hop', emote: 'note', sound: 'boing', durationMs: 4000, mood: 'excited' }),
  }),
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
