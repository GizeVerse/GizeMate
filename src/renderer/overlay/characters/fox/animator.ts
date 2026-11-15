// Turns the brain's clip choice into a living fox pose: clip resolution (native or alias), sampling,
// cross-fades, and the procedural layers (breathing, blinks, ear twitches, glances, look-at, one-off
// reactions, mood on ears/tail/eyes, deep sleep, reduced motion, the pendulum swing while held).
import type { AnimClip, CatReactionKind } from '../../../../shared/cat';
import { CLIP_FALLBACK } from '../../../../shared/animationCatalog';
import { MOODS, type Mood } from '../../../../shared/companion';
import { FOX_MODULE } from '../../../../shared/characters/fox';
import { clamp, clamp01, damp, easeOut, lerp, noise1, pulse, smooth, TAU } from '../../character/kit';
import type { AnimInput } from '../../character/types';
import { crossFadeMs, gaitHz, isGait, sampleClip, type ClipContext } from './clips';
import { blendPose, copyPose, createPose, sanitizePose, type Pose } from './pose';

const NATIVE: ReadonlySet<AnimClip> = new Set<AnimClip>(FOX_MODULE.clips);

/** The clip the fox actually draws for a canonical one: native, its alias, the shared fallbacks, then stand. */
export function resolveFoxClip(clip: AnimClip): AnimClip {
  if (NATIVE.has(clip)) return clip;
  let c: AnimClip | undefined = clip;
  for (let hops = 0; hops < 8 && c !== undefined; hops++) {
    const next: AnimClip | undefined = FOX_MODULE.clipAlias[c] ?? CLIP_FALLBACK[c];
    if (next === undefined) break;
    if (NATIVE.has(next)) return next;
    c = next;
  }
  return 'stand';
}

const REACTION_S: Readonly<Record<CatReactionKind, number>> = { earFlick: 0.3, tailFlick: 0.4, headTilt: 0.6 };
const HEAD_TILT_RAD = (13 * Math.PI) / 180;

const MOOD_RATE: Readonly<Record<Mood, { readonly up: number; readonly down: number }>> = {
  happy: { up: 2.5, down: 1.5 },
  curious: { up: 3, down: 2 },
  sleepy: { up: 1.2, down: 1.2 },
  startled: { up: 8, down: 2.5 },
  scared: { up: 4, down: 1.5 },
  excited: { up: 3, down: 2 },
  relaxed: { up: 1.2, down: 1.2 },
  confused: { up: 3, down: 2 },
};
const MOOD_EPS = 1e-3;
const MAX_DT_S = 0.1;
const REDUCE_RATE = 4;
const DEPTH_RATE = 1.2;

/** Clips whose tail motion is authored: mood only lightly modulates them. */
const TAIL_AUTHORED: ReadonlySet<AnimClip> = new Set<AnimClip>(['startle', 'annoyed', 'held', 'jump', 'fall', 'run', 'sleep', 'wake', 'land', 'climb', 'stalk', 'slink', 'pounce', 'swat', 'stretch', 'tailChase', 'shake', 'dance', 'rollOver']);

export class FoxAnimator {
  readonly pose: Pose = createPose();
  readonly base: Pose = createPose();
  private readonly clipPose: Pose = createPose();
  private readonly fromPose: Pose = createPose();
  private readonly ctx: ClipContext = {
    t: 0,
    cycle: 0,
    speed: 0,
    vy: 0,
    lookX: 0,
    lookY: 0,
    hasLook: false,
    arousal: 0,
    contentment: 0,
    jumpKind: null,
    impact: undefined,
    reducedMotion: false,
  };

  private clip: AnimClip | null = null;
  private clipStart = Number.NaN;
  private fadeElapsed = 0;
  private fadeDur = 0;
  private cycle = 0;
  private time = 0;
  private breathPhase = 0;
  private readonly moodW = new Float64Array(MOODS.length);
  private moodAny = false;
  private depthK = 0;
  private reduceK = 0;
  private tailBaseLP = 0;
  private tailCurlLP = 0;
  private tailLPValid = false;

  private blinkTimer: number;
  private blinkAge = -1;
  private blinkDouble = false;
  private earTimer: number;
  private earAge = -1;
  private earWhich = 0;
  private glanceTimer: number;
  private glanceX = 0;
  private glanceY = 0;
  private lookHead = 0;
  private lookPX = 0.2;
  private lookPY = 0;
  private swing = 0;
  private swingVel = 0;

  private reactionSeen = Number.NaN;
  private readonly reactionStart: Record<CatReactionKind, number> = { earFlick: Number.NaN, tailFlick: Number.NaN, headTilt: Number.NaN };
  private earFlickWhich = 2;
  private tiltSign = 1;
  private reactionActive = false;

  constructor(private readonly random: () => number) {
    this.blinkTimer = 1 + random() * 3;
    this.earTimer = 2 + random() * 4;
    this.glanceTimer = 2 + random() * 3;
  }

  get currentClip(): AnimClip | null {
    return this.clip;
  }
  get blending(): boolean {
    return this.fadeElapsed < this.fadeDur;
  }
  get reacting(): boolean {
    return this.reactionActive;
  }

  /** Motion-derived state that must not survive a position snap (the swing). */
  resetMotion(): void {
    this.swing = 0;
    this.swingVel = 0;
  }

  update(input: AnimInput, simTimeMs: number, dtMs: number, motionX: number): Pose {
    const dt = clamp(Number.isFinite(dtMs) ? dtMs / 1000 : 0, 0, MAX_DT_S);
    const animSpeed = clamp(Number.isFinite(input.animSpeed) ? input.animSpeed : 1, 0.1, 3);
    const reduced = input.reducedMotion === true;
    this.reduceK = damp(this.reduceK, reduced ? 1 : 0, REDUCE_RATE, dt);
    if (Math.abs(this.reduceK - (reduced ? 1 : 0)) < 1e-3) this.reduceK = reduced ? 1 : 0;
    const sleeping = input.sleeping || input.clip === 'sleep';
    this.depthK = damp(this.depthK, sleeping ? clamp01(Number.isFinite(input.sleepDepth ?? 0) ? (input.sleepDepth ?? 0) : 0) : 0, DEPTH_RATE, dt);
    this.stepMoods(input.mood, dt);
    this.time += dt * animSpeed * (1 - 0.6 * this.reduceK);
    const speed = Number.isFinite(input.speed) ? Math.max(0, input.speed) : 0;
    const clip = resolveFoxClip(input.clip);

    const startKey = Number.isFinite(input.clipStartedAt) ? input.clipStartedAt : 0;
    if (clip !== this.clip || startKey !== this.clipStart) {
      const first = this.clip === null;
      if (!first) copyPose(this.fromPose, this.base);
      if (!isGait(clip) || (this.clip !== null && !isGait(this.clip))) this.cycle = 0;
      this.fadeDur = first ? 0 : crossFadeMs(this.clip, clip) / 1000;
      this.fadeElapsed = 0;
      this.clip = clip;
      this.clipStart = startKey;
    }

    const c = this.ctx;
    c.t = (Math.max(0, simTimeMs - this.clipStart) * animSpeed) / 1000;
    if (!Number.isFinite(c.t)) c.t = 0;
    if (isGait(clip)) this.cycle += gaitHz(clip, speed) * dt * animSpeed;
    if (!Number.isFinite(this.cycle)) this.cycle = 0;
    else if (Math.abs(this.cycle) > 1e6) this.cycle -= Math.trunc(this.cycle);
    c.cycle = this.cycle;
    c.speed = speed;
    c.vy = Number.isFinite(input.vy) ? input.vy : 0;
    c.hasLook = input.hasLook && Number.isFinite(input.lookX) && Number.isFinite(input.lookY);
    c.lookX = c.hasLook ? input.lookX : 0;
    c.lookY = c.hasLook ? input.lookY : 0;
    c.arousal = clamp01(Number.isFinite(input.arousal) ? input.arousal : 0);
    c.contentment = clamp01(Number.isFinite(input.contentment) ? input.contentment : 0);
    c.jumpKind = input.jumpKind ?? null;
    c.impact = input.impact;
    c.reducedMotion = reduced;

    sampleClip(clip, c, this.clipPose);
    sanitizePose(this.clipPose);
    if (this.fadeElapsed < this.fadeDur) {
      this.fadeElapsed += dt;
      blendPose(this.base, this.fromPose, this.clipPose, smooth(this.fadeElapsed / this.fadeDur));
    } else {
      copyPose(this.base, this.clipPose);
    }

    const p = this.pose;
    copyPose(p, this.base);
    this.applyBreath(p, sleeping, dt, animSpeed);
    this.applyMood(p, clip, c.arousal, c.contentment);
    this.applyMoodLayers(p, clip);
    this.applySleepDepth(p);
    this.applyBlink(p, dt, sleeping, animSpeed);
    this.applyEars(p, dt, sleeping, animSpeed);
    this.applyLook(p, clip, c, dt, sleeping, animSpeed);
    this.noteReaction(input.reaction, simTimeMs, animSpeed);
    this.applyReactions(p, simTimeMs, animSpeed);
    this.applyReducedMotion(p, dt);
    this.applySwing(p, clip, motionX, dt);
    sanitizePose(p);
    return p;
  }

  // ---- layers ---------------------------------------------------------------------------------

  private mood(m: Mood): number {
    return this.moodW[MOODS.indexOf(m)]!;
  }

  private stepMoods(mood: Mood | undefined, dt: number): void {
    let any = false;
    for (let i = 0; i < MOODS.length; i++) {
      const m = MOODS[i]!;
      const rate = MOOD_RATE[m];
      const target = mood === m ? 1 : 0;
      const cur = this.moodW[i]!;
      const next = damp(cur, target, target > cur ? rate.up : rate.down, dt);
      this.moodW[i] = next < MOOD_EPS ? 0 : next;
      if (this.moodW[i]! > 0) any = true;
    }
    this.moodAny = any;
  }

  private applyBreath(p: Pose, sleeping: boolean, dt: number, animSpeed: number): void {
    const deep = this.depthK;
    const rate = sleeping ? lerp(0.32, 0.17, deep) : 0.34;
    this.breathPhase += dt * animSpeed * rate * TAU * (1 - 0.5 * this.reduceK);
    if (this.breathPhase > 1e6) this.breathPhase -= 1e6 * Math.floor(this.breathPhase / 1e6);
    const amp = (sleeping ? lerp(1.3, 0.7, deep) : 1) * p.breath * (1 - 0.45 * this.reduceK);
    const b = Math.sin(this.breathPhase);
    p.bodyH *= 1 + 0.028 * amp * b;
    p.bodyY -= 0.28 * amp * b;
    p.headY -= 0.25 * amp * b;
    p.sqY *= 1 + 0.004 * amp * b;
  }

  private applyBlink(p: Pose, dt: number, sleeping: boolean, animSpeed: number): void {
    if (sleeping) return;
    if (this.blinkAge < 0) {
      this.blinkTimer -= dt * animSpeed;
      if (this.blinkTimer <= 0) {
        this.blinkAge = 0;
        this.blinkDouble = this.random() < 0.15;
      }
    } else {
      this.blinkAge += dt * animSpeed;
      if (this.blinkAge >= 0.16) {
        if (this.blinkDouble) {
          this.blinkDouble = false;
          this.blinkAge = 0;
        } else {
          this.blinkAge = -1;
          this.blinkTimer = 2 + this.random() * 4.5;
        }
      }
    }
    if (this.blinkAge >= 0 && p.blinkOK > 0.5) {
      const k = Math.sin(Math.PI * clamp01(this.blinkAge / 0.16));
      p.eyeOpen *= 1 - k;
    }
  }

  private applyEars(p: Pose, dt: number, sleeping: boolean, animSpeed: number): void {
    if (sleeping) return;
    if (this.earAge < 0) {
      this.earTimer -= dt * animSpeed;
      if (this.earTimer <= 0) {
        this.earAge = 0;
        this.earWhich = this.random() < 0.4 ? 0 : this.random() < 0.5 ? 1 : 2;
      }
    } else {
      this.earAge += dt * animSpeed;
      if (this.earAge >= 0.34) {
        this.earAge = -1;
        this.earTimer = 3 + this.random() * 6;
      }
    }
    if (this.earAge >= 0) {
      const k = Math.sin(Math.PI * clamp01(this.earAge / 0.34)) * (1 - 0.6 * this.reduceK);
      if (this.earWhich !== 1) p.earFR += 0.5 * k;
      if (this.earWhich !== 0) p.earNR += 0.5 * k;
    }
  }

  private applyLook(p: Pose, clip: AnimClip, c: ClipContext, dt: number, sleeping: boolean, animSpeed: number): void {
    // Idle glances of the eyes when nothing is looked at.
    this.glanceTimer -= dt * animSpeed;
    if (this.glanceTimer <= 0) {
      this.glanceTimer = 1.6 + this.random() * 3.6;
      const r = this.random();
      this.glanceX = r < 0.3 ? 0 : (this.random() - 0.5) * 1.4;
      this.glanceY = (this.random() - 0.5) * 0.5;
    }
    let tx = 0.2 + this.glanceX;
    let ty = this.glanceY;
    let head = 0;
    const w = clamp01(p.lookW) * (sleeping || clip === 'held' ? 0 : 1);
    if (c.hasLook && w > 0) {
      const dx = c.lookX - p.headX;
      const dy = c.lookY - p.headY;
      const ang = Math.atan2(-dy, Math.max(dx, 6));
      head = clamp(ang, -0.55, 0.65) * 0.55 * w;
      tx = clamp(dx / 40, -1, 1) * 0.9;
      ty = clamp(dy / 40, -1, 1) * 0.6;
    }
    this.lookHead = damp(this.lookHead, head, 7, dt);
    this.lookPX = damp(this.lookPX, tx, 12, dt);
    this.lookPY = damp(this.lookPY, ty, 12, dt);
    p.headRot += this.lookHead * (1 - 0.4 * this.reduceK);
    p.pupilX = clamp(p.pupilX + this.lookPX - 0.2, -1, 1);
    p.pupilY = clamp(p.pupilY + this.lookPY, -1, 1);
  }

  private applyMood(p: Pose, clip: AnimClip, arousal: number, content: number): void {
    const w = TAIL_AUTHORED.has(clip) ? 0.25 : 1;
    const t = this.time;
    p.tailBase += w * ((content - 0.5) * 0.25 + 0.06 * Math.sin(TAU * 0.37 * t));
    p.tailCurl += w * (content * 0.25 + 0.12 * Math.sin(TAU * 0.45 * t + 0.7) + arousal * 0.28 * Math.sin(TAU * 2.4 * t));
    p.earNR -= 0.1 * arousal * w;
    p.earFR -= 0.08 * arousal * w;
  }

  private applySleepDepth(p: Pose): void {
    const d = this.depthK;
    if (d <= 0) return;
    p.bodyH *= 1 - 0.03 * d;
    p.bodyY += 0.3 * d;
    p.headY += 0.6 * d;
    p.earNR += 0.06 * d;
    p.earFR += 0.06 * d;
  }

  private applyMoodLayers(p: Pose, clip: AnimClip): void {
    if (!this.moodAny) return;
    const t = this.time;
    const tw = TAIL_AUTHORED.has(clip) ? 0.35 : 1;
    const happy = this.mood('happy');
    if (happy > 0) {
      p.tailBase += 0.2 * tw * happy;
      p.tailCurl += 0.12 * tw * happy;
      p.eyeSquint += 0.12 * happy;
      p.blush = Math.min(1, p.blush + 0.2 * happy);
    }
    const curious = this.mood('curious');
    if (curious > 0) {
      p.earNR -= 0.15 * curious;
      p.earFR -= 0.12 * curious;
      p.headRot += 0.06 * curious * Math.sin(TAU * 0.13 * t);
    }
    const sleepy = this.mood('sleepy');
    if (sleepy > 0) {
      p.eyeOpen *= 1 - 0.4 * sleepy;
      p.earNR += 0.12 * sleepy;
      p.earFR += 0.12 * sleepy;
      p.headY += 1.2 * sleepy;
      p.tailCurl -= 0.1 * tw * sleepy;
    }
    const startled = this.mood('startled');
    if (startled > 0) {
      p.earNF += 0.4 * startled;
      p.earFF += 0.4 * startled;
      p.earNR += 0.2 * startled;
      p.earFR += 0.2 * startled;
    }
    const scared = this.mood('scared');
    if (scared > 0) {
      p.earNR += 0.35 * scared;
      p.earFR += 0.3 * scared;
      p.earNF += 0.3 * scared;
      p.earFF += 0.3 * scared;
      p.tailBase -= 0.5 * tw * scared;
      p.tailCurl -= 0.3 * tw * scared;
      p.tailPuff = clamp01(p.tailPuff + 0.35 * scared);
      p.bodyY += 1.4 * scared;
      p.headY += 2.5 * scared;
    }
    const excited = this.mood('excited');
    if (excited > 0) {
      p.tailBase += 0.15 * tw * excited;
      p.tailCurl += 0.35 * tw * excited * Math.sin(TAU * 3.4 * t);
      p.earNR -= 0.08 * excited;
    }
    const relaxed = this.mood('relaxed');
    if (relaxed > 0) {
      p.eyeOpen *= 1 - 0.42 * relaxed;
      p.earNR += 0.08 * relaxed;
      p.tailCurl += 0.1 * tw * relaxed * Math.sin(TAU * 0.2 * t);
    }
    const confused = this.mood('confused');
    if (confused > 0) {
      p.earFR -= 0.25 * confused;
      p.earNR += 0.12 * confused;
      p.headRot += 0.08 * confused * Math.sin(TAU * 0.35 * t);
    }
    p.earNR = clamp(p.earNR, -0.8, 1.4);
    p.earFR = clamp(p.earFR, -0.8, 1.4);
    p.earNF = clamp01(p.earNF);
    p.earFF = clamp01(p.earFF);
    p.eyeSquint = clamp01(p.eyeSquint);
    p.eyeOpen = clamp01(p.eyeOpen);
  }

  // ---- reactions ----------------------------------------------------------------------------

  private noteReaction(r: AnimInput['reaction'], simTimeMs: number, animSpeed: number): void {
    if (!r || !Number.isFinite(r.at) || r.at === this.reactionSeen) return;
    const dur = REACTION_S[r.kind];
    if (dur === undefined) return;
    this.reactionSeen = r.at;
    if (this.reactionAge(r.kind, simTimeMs, animSpeed) < dur) return;
    this.reactionStart[r.kind] = r.at;
    const h = noise1(Math.floor(r.at), 71);
    if (r.kind === 'earFlick') this.earFlickWhich = h < -0.3 ? 0 : h < 0.3 ? 1 : 2;
    else if (r.kind === 'headTilt') this.tiltSign = h < 0 ? -1 : 1;
  }

  private reactionAge(kind: CatReactionKind, simTimeMs: number, animSpeed: number): number {
    return ((simTimeMs - this.reactionStart[kind]) * animSpeed) / 1000;
  }

  private reactionPhase(kind: CatReactionKind, simTimeMs: number, animSpeed: number): number {
    const s = this.reactionAge(kind, simTimeMs, animSpeed) / REACTION_S[kind];
    return s >= 0 && s < 1 ? s : -1;
  }

  private applyReactions(p: Pose, simTimeMs: number, animSpeed: number): void {
    let active = false;
    const ear = this.reactionPhase('earFlick', simTimeMs, animSpeed);
    if (ear >= 0) {
      active = true;
      const e = ear < 0.25 ? easeOut(ear / 0.25) : 1 - smooth((ear - 0.25) / 0.75);
      if (this.earFlickWhich !== 1) p.earFR += 0.6 * e;
      if (this.earFlickWhich !== 0) p.earNR += 0.6 * e;
    }
    const tail = this.reactionPhase('tailFlick', simTimeMs, animSpeed);
    if (tail >= 0) {
      active = true;
      const w = Math.sin(TAU * tail) * (1 - tail) * clamp(p.rollY, -1, 1);
      p.tailCurl += 1.4 * w;
      p.tailBase += 0.3 * w;
      p.tailStiff = lerp(p.tailStiff, 0.95, Math.sin(Math.PI * tail));
    }
    const tilt = this.reactionPhase('headTilt', simTimeMs, animSpeed);
    if (tilt >= 0) {
      active = true;
      p.headRot += this.tiltSign * HEAD_TILT_RAD * pulse(tilt, 0, 0.3, 0.6, 1);
      p.earFR -= 0.2 * this.tiltSign * pulse(tilt, 0, 0.3, 0.6, 1);
    }
    this.reactionActive = active;
  }

  /** Reduced motion: the brush is low-passed, hops and shudders shrink, a spin never goes edge-on. Eased in and out. */
  private applyReducedMotion(p: Pose, dt: number): void {
    const k = this.reduceK;
    if (k <= 0) {
      this.tailLPValid = false;
      return;
    }
    if (!this.tailLPValid) {
      this.tailBaseLP = p.tailBase;
      this.tailCurlLP = p.tailCurl;
      this.tailLPValid = true;
    } else {
      this.tailBaseLP = damp(this.tailBaseLP, p.tailBase, 1, dt);
      this.tailCurlLP = damp(this.tailCurlLP, p.tailCurl, 1, dt);
    }
    const blend = 0.7 * k;
    p.tailBase = lerp(p.tailBase, this.tailBaseLP, blend);
    p.tailCurl = lerp(p.tailCurl, this.tailCurlLP, blend);
    p.offX *= 1 - 0.6 * k;
    p.rot *= 1 - 0.5 * k;
    if (p.offY < 0) p.offY *= 1 - 0.5 * k;
    p.turnX = lerp(p.turnX, 1, 0.75 * k);
    p.earNR = lerp(p.earNR, this.base.earNR, 0.3 * k);
    p.earFR = lerp(p.earFR, this.base.earFR, 0.3 * k);
  }

  private applySwing(p: Pose, clip: AnimClip, motionX: number, dt: number): void {
    if (dt <= 0) return;
    const vx = Number.isFinite(motionX) ? clamp(motionX / dt, -3000, 3000) : 0;
    if (clip === 'held') {
      const target = clamp(-vx * 0.0012, -0.6, 0.6) + 0.05 * Math.sin(TAU * 0.6 * this.time);
      const acc = -38 * (this.swing - target) - 4.5 * this.swingVel;
      this.swingVel += acc * dt;
      this.swing += this.swingVel * dt;
      this.swing = clamp(this.swing, -0.8, 0.8);
    } else {
      this.swing = damp(this.swing, 0, 10, dt);
      this.swingVel = 0;
    }
    if (Math.abs(this.swing) > 1e-4) p.rot += this.swing * (1 - 0.4 * this.reduceK);
  }
}
