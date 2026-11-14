// The character contract (GizeMate). Pure, platform-agnostic data: everything the shared engine,
// the renderers, the settings UI and the hosts need to know about one companion. The engine never
// switches on a character name; it reads these fields. Adding a character means adding one module
// file here, one renderer under src/renderer/overlay/characters/<id>/ and its strings in
// src/shared/i18n/.
import type { AnimClip, Emote, SoundCue } from '../cat';
import type { Mood, PropKind, WorldEventId } from '../companion';

export const CHARACTER_IDS = ['cat', 'monkey', 'fox', 'rabbit', 'ghost', 'slime', 'alien'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];
/** The companion every existing install has; also the fallback for any unknown id. */
export const DEFAULT_CHARACTER: CharacterId = 'cat';

export type CharacterKind = 'animal' | 'fantasy';
export type Locomotion = 'walk' | 'hop' | 'float' | 'bounce' | 'glide';

/**
 * The seven personality dimensions (0..1). A read-only view derived from a companion's stored
 * traits and drives; a character's module supplies the means used when a NEW companion of that
 * character is born. Stable over time; mood is what changes.
 */
export interface SevenTraits {
  readonly curiosity: number;
  readonly energy: number;
  readonly playfulness: number;
  readonly sociability: number;
  readonly mischief: number;
  readonly affection: number;
  readonly independence: number;
}
export type TraitName = keyof SevenTraits;

/** A signature behaviour: an autonomous action only this character performs, picked by the shared weighted engine. */
export interface SignatureAction {
  /** Unique within the character; also the persisted counter token (content-free). */
  readonly id: string;
  /** The clip that carries the action. */
  readonly clip: AnimClip;
  /** Optional clips played before the main clip (lead-in), in order. */
  readonly leadIn?: readonly AnimClip[];
  /** Base selection weight among all autonomous actions (1 = as likely as a common idle variation). */
  readonly weight: number;
  readonly cooldownMs: number;
  /** How long the main clip plays (ms, min and max); one-shot clips use their own length when longer. */
  readonly durationMs: readonly [number, number];
  readonly requires?: {
    readonly minEnergy?: number;
    readonly maxEnergy?: number;
    readonly moods?: readonly Mood[];
    readonly needsLedge?: boolean;
    readonly needsWall?: boolean;
    readonly cursorNear?: boolean;
    readonly notWhileSleepy?: boolean;
  };
  /** Weight multiplier per trait: 1 + bias * (trait - 0.5) * 2, clamped to 0.1..3. */
  readonly traitBias?: Readonly<Partial<Record<TraitName, number>>>;
  /** What happens to the anchor during the action. 'teleport' relocates it while hidden (ghost). */
  readonly movement?: 'none' | 'toward-cursor' | 'away-from-cursor' | 'random-hop' | 'teleport';
  readonly emote?: Emote;
  readonly sound?: SoundCue;
}

/** How the character answers a stimulus (a prop kind, the laser, being petted, held or startled). */
export interface ReactionSpec {
  readonly clip: AnimClip;
  readonly emote?: Emote;
  readonly sound?: SoundCue;
  /** How long the reaction plays (ms); omitted = the clip's own length or the engine default. */
  readonly durationMs?: number;
  /** Mood nudge applied while it plays. */
  readonly mood?: Mood;
}
export type StimulusKey = PropKind | 'laser' | 'petted' | 'held' | 'startled' | 'cursorNear';

/** The voice of a character: the sound layer applies it to the shared cue synthesis. Audio stays off by default. */
export interface SoundProfile {
  /** Pitch multiplier on the cue frequencies (0.5..2). */
  readonly pitch: number;
  readonly voice: 'soft' | 'bright' | 'hollow' | 'squelchy' | 'synthetic';
  /** Relative loudness before the user's volume (0.2..1). */
  readonly gain: number;
  /** Minimum time between two cues of this character (ms): never repetitive. */
  readonly cooldownMs: number;
  /** The cue this character uses for its general voice, petting and delight. */
  readonly cues: {
    readonly voice: SoundCue;
    readonly happy: SoundCue;
    readonly startled: SoundCue;
    readonly move?: SoundCue;
  };
}

export interface CharacterModule {
  readonly id: CharacterId;
  readonly kind: CharacterKind;
  readonly locomotion: Locomotion;
  /** i18n key prefix: `character.<id>`; the keys name, tagline, description, personality, interactions live under it. */
  readonly i18nPrefix: string;
  /** Nominal footprint at size 1.0 in DIP and the movement scale versus the cat's gait limits. */
  readonly body: {
    readonly widthDip: number;
    readonly heightDip: number;
    /** Multiplier on the cat's gait speed limits (GAIT_LIMIT_DIP). */
    readonly gaitScale: number;
    /** How far in front of the body each clip's hit region may reach (DIP at size 1); missing clips use the cat's values. */
    readonly hitFrontExtentDip: Readonly<Partial<Record<AnimClip, number>>>;
  };
  /** Palette ids the user can choose in Customize; the first is the default. */
  readonly skins: readonly string[];
  /** Clips this character's renderer draws natively. */
  readonly clips: readonly AnimClip[];
  /** Clips drawn as another clip of this character (applied before the shared fallbacks). */
  readonly clipAlias: Readonly<Partial<Record<AnimClip, AnimClip>>>;
  /** Personality defaults for a newly born companion of this character. */
  readonly personality: { readonly means: SevenTraits; readonly spread: number };
  /** Tuning of the shared decision engine. 1 = unchanged; the cat is all 1. */
  readonly behavior: {
    readonly speedScale: number;
    readonly restBias: number;
    readonly exploreBias: number;
    readonly playBias: number;
    readonly cursorInterest: number;
    readonly jumpiness: number;
    readonly shyness: number;
    /** Weight multipliers on the 26 world events (missing = 1; 0 disables). */
    readonly eventAffinity: Readonly<Partial<Record<WorldEventId, number>>>;
    readonly signatures: readonly SignatureAction[];
  };
  readonly reactions: Readonly<Partial<Record<StimulusKey, ReactionSpec>>>;
  readonly sound: SoundProfile;
  /** Which content-free memory kinds this character records ('all' = every kind the engine knows). */
  readonly memory: { readonly kinds: 'all' | readonly string[] };
  readonly capabilities: {
    readonly climbsEdges: boolean;
    readonly flies: boolean;
    readonly passesThrough: boolean;
    readonly squashes: boolean;
  };
}
