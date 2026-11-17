// Slime: a glossy jelly blob with no limbs. It moves by bouncing, squashes and stretches with every
// step, wobbles after every landing and treats everything as a game. The renderer
// (src/renderer/overlay/characters/slime/) draws every clip below natively; the rest are aliases of those.
import type { CharacterModule, ReactionSpec, SignatureAction, StimulusKey } from './types';

export const SLIME_MODULE: CharacterModule = Object.freeze({
  id: 'slime',
  kind: 'fantasy',
  locomotion: 'bounce',
  i18nPrefix: 'character.slime',
  body: Object.freeze({
    widthDip: 70,
    heightDip: 58,
    gaitScale: 0.95,
    // A flat puddle or a splat spreads sideways; a stretch or a bounce reaches a little further than the stand.
    hitFrontExtentDip: Object.freeze({ bounce: 44, hop: 40, stretch: 46, land: 52, impact: 54, pawAt: 56, swat: 62, groom: 50, scratch: 50, rollOver: 54, tailChase: 46, hiss: 50, meow: 46, squish: 54, hide: 54, sleep: 52, vanish: 54, appear: 54, startle: 44, dance: 44 }),
  }),
  skins: Object.freeze(['lime', 'berry', 'ocean', 'sunset']),
  clips: Object.freeze([
    'stand', 'sit', 'loaf', 'sleep', 'wake', 'yawn', 'crouch', 'jump', 'fall', 'land', 'startle', 'annoyed', 'confused',
    'petted', 'held', 'shake', 'hide', 'bounce', 'hop', 'vanish', 'appear', 'squish', 'stretch', 'scan', 'beam', 'peek', 'dance',
    // Authored with the pseudopod, the puff and the flop (they used to be aliases of shake, squish, yawn, startle, land and dance).
    'groom', 'scratch', 'pawAt', 'swat', 'meow', 'hiss', 'impact', 'rollOver', 'tailChase',
  ] as const),
  clipAlias: Object.freeze({
    walk: 'bounce',
    run: 'bounce',
    stalk: 'hop',
    slink: 'hop',
    sprint: 'bounce',
    float: 'hop',
    swing: 'held',
    pounce: 'jump',
    climb: 'stretch',
    balance: 'crouch',
    slip: 'startle',
    landRecover: 'shake',
    grumpy: 'annoyed',
    edgeSit: 'sit',
  }),
  personality: Object.freeze({
    means: Object.freeze({ curiosity: 0.55, energy: 0.72, playfulness: 0.95, sociability: 0.7, mischief: 0.45, affection: 0.8, independence: 0.25 }),
    spread: 0.15,
  }),
  behavior: Object.freeze({
    speedScale: 0.95,
    restBias: 0.8,
    exploreBias: 1.15,
    playBias: 1.5,
    cursorInterest: 1.4,
    jumpiness: 1.5,
    shyness: 0.7,
    eventAffinity: Object.freeze({
      bubbleParty: 2.2,
      butterflyEncounter: 1.6,
      toySpring: 1.8,
      yarnTrouble: 1.4,
      boxAppears: 1.3,
      fallingLeaf: 1.3,
      miniTsunami: 1.5,
      magicSparkles: 1.5,
      tinyTreasure: 1.2,
      thunderstorm: 0.6,
      shadowVisitor: 0.6,
      mouseEncounter: 0.8,
      windGust: 0.8,
    }),
    signatures: Object.freeze([
      // Reaches tall toward the cursor, as if it wanted a closer look.
      { id: 'stretchToCursor', clip: 'stretch', weight: 1.3, cooldownMs: 45_000, durationMs: [1600, 2200], traitBias: { curiosity: 0.6, sociability: 0.5 }, movement: 'toward-cursor', emote: 'sparkle', sound: 'boing' },
      // Crouches and springs twice, high.
      { id: 'doubleBounce', clip: 'bounce', leadIn: ['crouch'], weight: 1.2, cooldownMs: 35_000, durationMs: [1100, 1500], requires: { minEnergy: 0.3, notWhileSleepy: true }, traitBias: { energy: 0.6, playfulness: 0.6 }, emote: 'note', sound: 'boing' },
      // Melts into a puddle, rests there a while, then re-forms with a wobble.
      { id: 'meltPuddle', clip: 'hide', leadIn: ['squish'], weight: 0.8, cooldownMs: 90_000, durationMs: [2600, 4500], traitBias: { mischief: 0.4 }, sound: 'squelch' },
      // A wobble dance that shakes the whole body to a beat.
      { id: 'wobbleDance', clip: 'dance', weight: 1.1, cooldownMs: 70_000, durationMs: [3500, 6000], requires: { minEnergy: 0.35, notWhileSleepy: true }, traitBias: { playfulness: 0.7, energy: 0.4 }, emote: 'note', sound: 'squelch' },
      // Tall, flat, ball: tries on shapes while looking around.
      { id: 'shapeShift', clip: 'scan', weight: 1, cooldownMs: 60_000, durationMs: [3200, 4800], traitBias: { curiosity: 0.6 }, emote: 'sparkle' },
      // Blows a bubble, lets it go and watches it float away.
      { id: 'bubbleBlow', clip: 'beam', weight: 1.1, cooldownMs: 60_000, durationMs: [1400, 1400], requires: { notWhileSleepy: true }, traitBias: { playfulness: 0.5 }, emote: 'sparkle', sound: 'squelch' },
      // Sinks into a puddle and peeks out to see whether anyone is looking.
      { id: 'peekaboo', clip: 'peek', leadIn: ['hide'], weight: 0.7, cooldownMs: 100_000, durationMs: [3200, 5200], traitBias: { mischief: 0.5, independence: -0.3 }, emote: 'question' },
      // Shakes itself like jelly on a plate.
      { id: 'jellyShake', clip: 'shake', weight: 0.8, cooldownMs: 50_000, durationMs: [1100, 1400], requires: { minEnergy: 0.4 }, traitBias: { energy: 0.4 }, sound: 'squelch' },
    ] satisfies SignatureAction[]),
  }),
  reactions: Object.freeze({
    petted: { clip: 'petted', emote: 'heart', sound: 'squelch', mood: 'happy' },
    held: { clip: 'held', emote: 'sparkle', sound: 'boing', mood: 'excited' },
    startled: { clip: 'startle', emote: 'exclaim', sound: 'squeak', mood: 'startled' },
    cursorNear: { clip: 'stretch', emote: 'sparkle', mood: 'curious' },
    laser: { clip: 'bounce', emote: 'exclaim', sound: 'boing', durationMs: 3200, mood: 'excited' },
    yarn: { clip: 'squish', emote: 'sparkle', sound: 'squelch', durationMs: 2200, mood: 'happy' },
    box: { clip: 'hide', emote: 'question', sound: 'squelch', durationMs: 2800, mood: 'curious' },
    butterfly: { clip: 'bounce', emote: 'heart', sound: 'boing', durationMs: 3000, mood: 'excited' },
    goldenButterfly: { clip: 'stretch', emote: 'sparkle', sound: 'boing', durationMs: 2400, mood: 'excited' },
    leaf: { clip: 'dance', emote: 'note', durationMs: 2600, mood: 'happy' },
    mouse: { clip: 'peek', emote: 'question', sound: 'squeak', durationMs: 2600, mood: 'curious' },
    ball: { clip: 'bounce', emote: 'note', sound: 'boing', durationMs: 2800, mood: 'excited' },
    ghost: { clip: 'peek', emote: 'question', durationMs: 2600, mood: 'curious' },
    bolt: { clip: 'startle', emote: 'exclaim', sound: 'squeak', mood: 'startled' },
    bubble: { clip: 'beam', emote: 'sparkle', sound: 'squelch', mood: 'happy' },
    wave: { clip: 'squish', emote: 'sparkle', sound: 'splash', durationMs: 2400, mood: 'happy' },
    splash: { clip: 'bounce', emote: 'note', sound: 'splash', durationMs: 2400, mood: 'excited' },
    spring: { clip: 'bounce', emote: 'note', sound: 'boing', durationMs: 3000, mood: 'excited' },
    sparkle: { clip: 'dance', emote: 'sparkle', durationMs: 2600, mood: 'happy' },
  } satisfies Partial<Record<StimulusKey, ReactionSpec>>),
  sound: Object.freeze({
    pitch: 1,
    voice: 'squelchy',
    gain: 0.8,
    cooldownMs: 2500,
    cues: Object.freeze({ voice: 'squelch', happy: 'boing', startled: 'squeak', move: 'boing' }),
  }),
  memory: Object.freeze({ kinds: 'all' }),
  capabilities: Object.freeze({ climbsEdges: false, flies: false, passesThrough: false, squashes: true }),
});
