// The cat simulation, layer 10 of 10: the active character (GizeMate). Everything a CharacterModule
// changes about behaviour that the shared layers do not already read from it: the clip the character
// actually draws (locomotion style, aliases), its stimulus reactions (petted, held, startled, cursor
// near, laser, world props), the signature actions (autonomous, weighted, cooldown-limited, interruptible
// one-offs: lead-in, optional travel or teleport, main clip, emote, sound) and their runtime.
//
// The cat's module is all-neutral (no signatures, no reactions, every multiplier 1, every clip listed):
// nothing in this layer draws a random number for it, and every override returns what the layer
// below returned, so a seeded cat is byte-identical. The layer owns its own random stream.
import type { AnimClip } from '../../shared/cat';
import { canSwitch } from '../../shared/animationCatalog';
import { sevenTraitsOf } from '../../shared/characters/seven';
import type { ReactionSpec, SignatureAction, StimulusKey } from '../../shared/characters/types';
import type { Mood } from '../../shared/companion';
import type { Rect } from '../../shared/geometry';
import { clamp } from '../../shared/geometry';
import type { Activity } from './activity';
import { buildSteps, isNeutral, locomotionClip, multipliersOf, resolveForCharacter, signatureWeight, teleportTarget, totalMs, type SigStep, type SignatureContext } from './character';
import type { Candidate, CharacterTuning, DecisionView, SignatureOffer } from './decide';
import type { RequestStatus } from './simCore';
import type { TransitionCause } from './states';
import { SimLaser } from './simLaser';
import { mulberry32 } from './random';

/** How long a reaction's mood nudge shows when the spec gives no duration, ms. */
const DEFAULT_REACTION_MS = 2500;
/** A prop within this many body widths of the character triggers its reaction. */
const PROP_REACT_BL = 6;
/** Travel steps end within this many body widths of their goal. */
const TRAVEL_ARRIVE_BL = 0.3;
/** A cursor within this many body widths counts as near (the cursorNear requirement). */
const CURSOR_NEAR_BL = 5;
/** Effective sleepiness above this counts as sleepy (notWhileSleepy). */
const SLEEPY_Z = 0.6;

interface SigRun {
  act: Activity;
  def: SignatureAction;
  steps: SigStep[];
  idx: number;
  stepAt: number;
  /** The relocation of a teleport happened. */
  relocated: boolean;
  travelTo: number | null;
}

/** FNV-1a over a few parts: the seed of this layer's own random stream. */
function seedOf(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0x5b, 0x01000193);
  }
  return h >>> 0;
}

export abstract class SimCharacter extends SimLaser {
  /** This layer's own stream: signature durations and teleport draws never touch the shared one. */
  private readonly sigRandom = mulberry32(seedOf('signature', this.character.id, this.cat.catId));
  private readonly sigLastAt = new Map<string, number>();
  private sigAnyAt = -Infinity;
  private sig: SigRun | null = null;
  private pendingSigId: string | null = null;
  private readonly tuning: CharacterTuning | null = isNeutral(this.character) ? null : { ...multipliersOf(this.character), signatures: [] };
  private moodNudge: { mood: Mood; until: number } | null = null;
  /** The activity a prop reaction already fired for (once per activity). */
  private propReactedAct: Activity | null = null;

  // ---- clips -------------------------------------------------------------------------------------------

  /** The clip the character draws for what the layers below chose: reaction clip, locomotion style, alias/fallback. */
  protected charClip(raw: AnimClip): AnimClip {
    const spec = this.reactionFor(raw);
    const styled = locomotionClip(this.character, spec ? spec.clip : raw);
    return resolveForCharacter(this.character, styled);
  }

  /** The reaction spec that replaces the clip right now, if the character has one for the stimulus at hand. */
  private reactionFor(raw: AnimClip): ReactionSpec | undefined {
    const r = this.character.reactions;
    const a = this.act;
    const m = this.mover;
    if (m.onWall || m.airborne) return undefined;
    switch (a.state) {
      case 'beingPetted':
        return raw === 'petted' ? r.petted : undefined;
      case 'held':
        return raw === 'held' ? r.held : undefined;
      case 'startled':
        return raw === 'startle' ? r.startled : undefined;
      case 'watchingCursor':
        return raw === 'sit' ? r.cursorNear : undefined;
      default:
        break;
    }
    if (a.variant === 'laser' && (raw === 'stand' || raw === 'sit')) return r.laser;
    if (a.variant === 'event' && (raw === 'stand' || raw === 'sit' || raw === 'crouch')) return this.propReaction();
    return undefined;
  }

  /** The reaction of the nearest prop the character has a spec for, within PROP_REACT_BL body widths. */
  private propReaction(): ReactionSpec | undefined {
    const r = this.character.reactions;
    const m = this.mover;
    let best: ReactionSpec | undefined;
    let bestD = PROP_REACT_BL * m.bodyWidth;
    for (const p of this.props) {
      const spec = r[p.kind];
      if (!spec) continue;
      const d = Math.abs(p.x - m.x);
      if (d <= bestD) {
        bestD = d;
        best = spec;
      }
    }
    if (best && this.propReactedAct !== this.act) {
      this.propReactedAct = this.act;
      this.fireReaction(best);
    }
    return best;
  }

  /** A reaction's emote, sound and mood nudge (its clip is applied by charClip). */
  private fireReaction(spec: ReactionSpec): void {
    if (spec.emote) this.emotes.show(spec.emote, this.now, true);
    if (spec.sound) {
      // The default voice cue of this very tick (a purr on a pet) makes way for the character's own.
      if (this.sound !== null && this.sound.at === this.now) {
        this.sound = null;
        this.lastSoundAt = -Infinity;
      }
      this.playSound(spec.sound);
    }
    if (spec.mood) this.moodNudge = { mood: spec.mood, until: this.now + (spec.durationMs ?? DEFAULT_REACTION_MS) };
  }

  /** The mood the output shows: a running reaction's nudge, else the companion's own. */
  protected outputMood(): Mood {
    const n = this.moodNudge;
    if (n && this.now < n.until) return n.mood;
    this.moodNudge = null;
    return this.mood;
  }

  // ---- decisions -----------------------------------------------------------------------------------------

  protected override decisionView(): DecisionView {
    const v = super.decisionView();
    if (this.tuning) v.character = { ...this.tuning, signatures: this.signatureOffers() };
    return v;
  }

  protected override signatureOffers(): SignatureOffer[] {
    const sigs = this.character.behavior.signatures;
    if (sigs.length === 0 || this.mode !== 'normal') return [];
    const m = this.mover;
    if (m.held || m.airborne || m.onWall || this.laserModeOn() || this.worldEventSnapshot() !== null || this.props.length > 0) return [];
    const stay = this.stay !== null;
    const onLedge = m.attachedSurface !== null;
    const cursor = this.cursorInfo();
    const seven = sevenTraitsOf({ traits: this.traits, drives: this.cat.drives });
    const base = {
      energy: this.cat.stats.energy,
      mood: this.mood,
      sleepy: this.zEffNow() > SLEEPY_Z,
      onLedge,
      atWall: this.ambushSpot() !== null,
      cursorNear: cursor !== null && cursor.distBodyLengths < CURSOR_NEAR_BL,
      seven,
      sinceAnyMs: this.now - this.sigAnyAt,
      typing: this.typingGate(),
      canRelocate: m.grounded && !onLedge && !stay,
    };
    const out: SignatureOffer[] = [];
    for (const sig of sigs) {
      // On a window top or strip only the ledge-bound actions are offered (the stay plan owns the rest).
      if (stay && sig.requires?.needsLedge !== true) continue;
      const first = sig.leadIn?.[0] ?? (sig.movement === 'teleport' ? 'vanish' : sig.clip);
      const ctx: SignatureContext = {
        ...base,
        sinceMs: this.now - (this.sigLastAt.get(sig.id) ?? -Infinity),
        clipSwitchable: canSwitch(this.clip, resolveForCharacter(this.character, first), Math.max(0, (this.now - this.clipStartedAt) / 1000)),
      };
      const w = signatureWeight(sig, ctx);
      if (w > 0) out.push({ id: sig.id, weight: w });
    }
    return out;
  }

  protected override requestCandidate(c: Candidate, cause: TransitionCause): RequestStatus {
    this.pendingSigId = c.signatureId ?? null;
    try {
      return super.requestCandidate(c, cause);
    } finally {
      this.pendingSigId = null;
    }
  }

  // ---- activities ----------------------------------------------------------------------------------------

  protected override enterActivity(a: Activity): void {
    super.enterActivity(a);
    const id = this.pendingSigId;
    if (a.state === 'idle' && a.variant === 'signature' && id !== null) {
      this.beginSignature(a, id);
      return;
    }
    const r = this.character.reactions;
    switch (a.state) {
      case 'beingPetted':
        if (r.petted) this.fireReaction(r.petted);
        break;
      case 'held':
        if (r.held) this.fireReaction(r.held);
        break;
      case 'startled':
        if (r.startled) this.fireReaction(r.startled);
        break;
      case 'watchingCursor':
        if (r.cursorNear) this.fireReaction(r.cursorNear);
        break;
      default:
        if (a.variant === 'laser' && r.laser) this.fireReaction(r.laser);
    }
  }

  protected override exitActivity(a: Activity): void {
    if (this.sig && this.sig.act === a) this.endSignature();
    super.exitActivity(a);
  }

  protected override updateActivity(): void {
    super.updateActivity();
    const s = this.sig;
    if (s && s.act === this.act && !this.act.done) this.stepSignature(s);
  }

  // ---- signature runtime -------------------------------------------------------------------------------

  private beginSignature(a: Activity, id: string): void {
    const def = this.character.behavior.signatures.find((x) => x.id === id);
    if (!def) return;
    const steps = buildSteps(def, this.sigRandom(), { reducedMotion: this.reducedNow() });
    this.sigLastAt.set(id, this.now);
    this.sigAnyAt = this.now;
    this.sig = { act: a, def, steps, idx: -1, stepAt: this.now, relocated: false, travelTo: null };
    // The activity lasts as long as its script (the generic dwell then hands over to the next decision).
    a.dwellMs = totalMs(steps) + 800;
    this.phase(a, 'sit');
    this.nextStep(this.sig);
  }

  private endSignature(): void {
    const s = this.sig;
    this.sig = null;
    if (!s) return;
    if (this.oneShot) this.oneShot = null;
    this.stop();
  }

  /** Moves to the next step of the script (or ends it). */
  private nextStep(s: SigRun): void {
    for (;;) {
      s.idx++;
      s.stepAt = this.now;
      const step = s.steps[s.idx];
      if (!step) {
        this.endSignature();
        this.finish();
        return;
      }
      this.startStep(s, step);
      // A zero-length step (the reduced-motion swap) completes at once.
      if (step.ms > 0) return;
      this.completeStep(s, step);
    }
  }

  private startStep(s: SigRun, step: SigStep): void {
    const def = s.def;
    switch (step.kind) {
      case 'travel':
        this.oneShot = null;
        s.travelTo = this.travelGoal(def);
        if (s.travelTo === null) {
          step.ms = 0;
          return;
        }
        this.goTo({ x: s.travelTo, y: this.mover.y }, this.reducedNow() || def.movement !== 'away-from-cursor' ? 'walk' : 'run', false);
        return;
      case 'vanish':
      case 'appear':
        if (step.ms > 0) this.playOneShot(resolveForCharacter(this.character, step.clip), step.ms);
        return;
      case 'main':
        this.playOneShot(resolveForCharacter(this.character, step.clip), step.ms);
        if (def.emote) this.emotes.show(def.emote, this.now, true);
        if (def.sound) this.playSound(def.sound);
        return;
      default:
        this.playOneShot(resolveForCharacter(this.character, step.clip), step.ms);
    }
  }

  /** What happens when a step ends: the teleport relocates while the character is hidden. */
  private completeStep(s: SigRun, step: SigStep): void {
    if (step.kind === 'travel') this.stop();
    if (step.kind === 'vanish' && s.def.movement === 'teleport' && !s.relocated) this.relocateWhileHidden(s);
  }

  private stepSignature(s: SigRun): void {
    const step = s.steps[s.idx];
    if (!step) return;
    const elapsed = this.now - s.stepAt;
    if (step.kind === 'travel') {
      const m = this.mover;
      const arrived = s.travelTo === null || Math.abs(m.x - s.travelTo) <= TRAVEL_ARRIVE_BL * m.bodyWidth;
      if (!arrived && elapsed < step.ms) return;
      this.completeStep(s, step);
      this.nextStep(s);
      return;
    }
    if (elapsed < step.ms) return;
    this.completeStep(s, step);
    this.nextStep(s);
  }

  /** The x a moving signature walks to (null: nothing to walk to), within the walkable span. */
  private travelGoal(def: SignatureAction): number | null {
    const m = this.mover;
    const range = m.walkRange;
    if (!range || !m.grounded) return null;
    const bw = m.bodyWidth;
    const cursor = this.env?.cursor;
    let target: number;
    switch (def.movement) {
      case 'toward-cursor': {
        if (!cursor || !Number.isFinite(cursor.x)) return null;
        const side = cursor.x >= m.x ? 1 : -1;
        target = cursor.x - side * 2.5 * bw;
        if ((target - m.x) * side <= 0) return null;
        target = m.x + side * Math.min(Math.abs(target - m.x), 4 * bw);
        break;
      }
      case 'away-from-cursor': {
        if (!cursor || !Number.isFinite(cursor.x)) return null;
        const side = cursor.x >= m.x ? -1 : 1;
        target = m.x + side * (2 + 2 * this.sigRandom()) * bw;
        break;
      }
      default: {
        const side = this.sigRandom() < 0.5 ? -1 : 1;
        target = m.x + side * (1.5 + 2.5 * this.sigRandom()) * bw;
      }
    }
    target = clamp(target, range.x0, range.x1);
    return Math.abs(target - m.x) >= 0.5 * bw ? target : null;
  }

  /** The teleport: puts the anchor somewhere else on the floor while the character is hidden; never off the usable area. */
  private relocateWhileHidden(s: SigRun): void {
    s.relocated = true;
    const m = this.mover;
    const area: Rect | undefined = m.fullWorldModel.display(m.displayId)?.workAreaPx;
    if (!area) return;
    const x = teleportTarget(m.x, { x0: area.x, x1: area.x + area.width }, m.bodyWidth, this.sigRandom(), this.sigRandom());
    if (m.relocate({ x, y: m.y })) this.snapNext = true;
  }

  /** The module's per-stimulus spec lookup for tools and tests (the clip is applied by charClip). */
  protected reactionSpecs(): Readonly<Partial<Record<StimulusKey, ReactionSpec>>> {
    return this.character.reactions;
  }
}
