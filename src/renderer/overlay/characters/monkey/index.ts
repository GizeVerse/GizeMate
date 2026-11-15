// The monkey: a procedural, long-armed, hunched companion. Its own skeleton (rig.ts), authored clips
// (clips.ts), painter (draw.ts) and palettes (skins.ts); the scene owns the view transform, dirty rect,
// frame pacing and hit reporting, this file owns pose, secondary motion, geometry and drawing.
import { ANIM_CLIPS, type AnimClip } from '../../../../shared/cat';
import { MONKEY_MODULE } from '../../../../shared/characters/monkey';
import { resolveForCharacter } from '../../../../core/behavior/character';
import type { AnimInput } from '../../cat/animator';
import { applyMatX, applyMatY, clamp, clamp01, damp, lerp, pulse, TailChain, TAU, type Ctx2D } from '../../character/kit';
import type { CharacterRenderer, DrawParams, EmoteAnchor, GeometryCollector } from '../../character/types';
import { CLIP_FNS, GAIT_CFG, GAIT_CLIPS, type ClipContext } from './clips';
import { drawMonkey, drawMonkeyShadow, EAR_R, FOOT_RX, FOOT_RY, HAND_R } from './draw';
import { blendPose, copyPose, createPose, HEAD_RX, HEAD_RY, poseFinite, Rig, type Pose } from './rig';
import { getMonkeySkin } from './skins';

/** Anchor speed unit: the sim's `speed` is in cat body lengths per second. */
const SPEED_UNIT_DIP = 84;
const MAX_DT_S = 0.1;
/** Reduced motion scales every oscillation by this and slows the layers. */
const REDUCED_K = 0.35;
const REDUCED_SLOW = 0.4;

const NATIVE: Readonly<Record<string, AnimClip>> = (() => {
  const out: Record<string, AnimClip> = {};
  for (const c of ANIM_CLIPS) out[c] = resolveForCharacter(MONKEY_MODULE, c);
  return out;
})();

const BIG_LEAPS: ReadonlySet<string> = new Set(['leap', 'across', 'wallJump']);

const finite = (v: number | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Cross-fade length (s) onto a clip. */
function fadeFor(from: AnimClip | null, to: AnimClip): number {
  if (from === null) return 0;
  switch (to) {
    case 'sleep':
      return 0.5;
    case 'startle':
      return 0.06;
    case 'land':
      return 0.05;
    case 'held':
      return 0.07;
    case 'jump':
    case 'fall':
      return 0.1;
    case 'wake':
      return 0.25;
    case 'climb':
      return 0.25;
    case 'swing':
      return 0.2;
    default:
      return 0.2;
  }
}

/** Mood tuning: targets for the additive face/ear/tail layer. */
interface MoodTune {
  smile: number;
  brow: number;
  eyeMul: number;
  perk: number;
  mouth: number;
  tilt: number;
}
const MOOD_TUNE: Readonly<Record<string, MoodTune>> = {
  happy: { smile: 0.45, brow: 0.1, eyeMul: 1, perk: 0.3, mouth: 0, tilt: 0 },
  curious: { smile: 0.05, brow: 0.45, eyeMul: 1, perk: 0.7, mouth: 0, tilt: 0.12 },
  sleepy: { smile: -0.1, brow: -0.25, eyeMul: 0.55, perk: -0.5, mouth: 0, tilt: 0.05 },
  startled: { smile: -0.3, brow: 0.9, eyeMul: 1, perk: 1, mouth: 0.25, tilt: 0 },
  scared: { smile: -0.6, brow: 0.7, eyeMul: 1, perk: -0.6, mouth: 0.1, tilt: 0 },
  excited: { smile: 0.65, brow: 0.4, eyeMul: 1, perk: 0.8, mouth: 0.12, tilt: 0 },
  relaxed: { smile: 0.3, brow: 0, eyeMul: 0.78, perk: 0, mouth: 0, tilt: 0 },
  confused: { smile: -0.2, brow: 0.2, eyeMul: 1, perk: 0.2, mouth: 0, tilt: 0.2 },
};
const NO_MOOD: MoodTune = { smile: 0, brow: 0, eyeMul: 1, perk: 0, mouth: 0, tilt: 0 };

const IDLE_CLIPS: ReadonlySet<string> = new Set(['stand', 'sit', 'loaf']);
/** Idle episode kinds. */
const EP_LOOK = 0;
const EP_ARMPIT = 1;
const EP_INSPECT = 2;
const EP_TAIL = 3;
const EP_TILT = 4;
const EP_COUNT = 6;
const EP_DUR = [2.6, 1.8, 2.4, 2.2, 1.9, 1.5];

export class MonkeyRenderer implements CharacterRenderer {
  readonly id = 'monkey' as const;
  readonly rig = new Rig();
  readonly tail = new TailChain();
  /** The final posed output of the last frame. */
  readonly pose: Pose = createPose();
  private readonly base = createPose();
  private readonly from = createPose();
  private readonly tailPose = { tailBase: 0, tailCurl: 0, tailBend: 0, tailStiff: 0.3, tailPuff: 0, tailFront: 0 };
  private readonly ctxC: ClipContext = {
    t: 0, cyc: 0, speed: 0, stride: 0, vy: 0, impact: 0, k: 1, lookX: 0, lookY: 0, hasLook: false, arousal: 0, contentment: 0.5, airT: 0, flip: false, engage: 0, dir: 1, sway: 0, sleepDepth: 0,
  };
  private clip: AnimClip | null = null;
  private clipStart = Number.NaN;
  private fadeDur = 0;
  private fadeEl = 0;
  private time = 0;
  private cycle = 0;
  private airT = 0;
  private climbEngage = 0;
  private climbDir = 1;
  private climbVy = 0;
  private climbSpeed = 0;
  private reduceK = 0;
  private swA = 0;
  private swV = 0;
  private lx = 0;
  private ly = 0;
  private lookMoving = false;
  // Blink.
  private blinkAt = 2.4;
  private blinkEl = 9;
  private blinkAgain = false;
  // Idle episodes.
  private epKind = -1;
  private epEl = 0;
  private epNext = 3;
  private epSeed = 0;
  // Mood.
  private readonly mood: MoodTune = { ...NO_MOOD };
  private reactAt = Number.NaN;
  private reactKind = '';
  private reactEl = 99;
  private fading = false;
  private reactingNow = false;
  private readonly random: () => number;
  private g: GeometryCollector | null = null;
  private padB = 3.4;
  private padH = 1;
  private msc = 1;
  private readonly tp = new Float64Array(6);

  constructor(random: () => number) {
    this.random = random;
    this.epNext = 2.5 + this.random() * 3;
    this.blinkAt = 1.8 + this.random() * 2.5;
    resetBasePose(this.base);
    copyPose(this.pose, this.base);
    copyPose(this.from, this.base);
  }

  get blending(): boolean {
    return this.fading;
  }

  get reacting(): boolean {
    return this.reactingNow;
  }

  resetMotion(): void {
    this.tail.reset();
  }

  advance(input: AnimInput, simTimeMs: number, dtMs: number, motionX: number, motionY: number): void {
    const dt = clamp(Number.isFinite(dtMs) ? dtMs / 1000 : 0, 0, MAX_DT_S);
    const animSpeed = clamp(finite(input.animSpeed, 1), 0.1, 3);
    const reduced = input.reducedMotion === true;
    this.reduceK = damp(this.reduceK, reduced ? 1 : 0, 6, dt);
    const k = lerp(1, REDUCED_K, this.reduceK);
    const slow = 1 - REDUCED_SLOW * this.reduceK;
    const adt = dt * animSpeed * slow;
    this.time += adt;
    const mx = Number.isFinite(motionX) ? motionX : 0;
    const my = Number.isFinite(motionY) ? motionY : 0;
    const speed = Math.max(0, finite(input.speed, 0));
    const native = NATIVE[input.clip] ?? 'stand';

    // Clip switch: remember the current output and cross-fade onto the new clip.
    const startedAt = finite(input.clipStartedAt, 0);
    if (native !== this.clip || input.clipStartedAt !== this.clipStart) {
      const prev = this.clip;
      if (prev !== null) copyPose(this.from, this.pose);
      this.fadeDur = fadeFor(prev, native);
      this.fadeEl = 0;
      if (native === 'climb' && prev !== 'climb') {
        this.climbEngage = 0;
        this.climbSpeed = speed;
        this.climbDir = 1;
        this.climbVy = 0;
      }
      if (!GAIT_CLIPS.has(native) || (prev !== null && !GAIT_CLIPS.has(prev))) this.cycle = 0;
      this.clip = native;
      this.clipStart = input.clipStartedAt;
    }
    const c = this.ctxC;
    c.t = (Math.max(0, finite(simTimeMs, 0) - startedAt) * animSpeed * slow) / 1000;
    c.k = k;
    c.speed = speed * SPEED_UNIT_DIP;
    c.vy = finite(input.vy, 0);
    c.impact = clamp01(finite(input.impact, 0));
    c.arousal = clamp01(finite(input.arousal, 0));
    c.contentment = clamp01(finite(input.contentment, 0.5));
    c.sleepDepth = clamp01(finite(input.sleepDepth, 0));
    c.hasLook = input.hasLook && Number.isFinite(input.lookX) && Number.isFinite(input.lookY);
    c.lookX = c.hasLook ? input.lookX : 0;
    c.lookY = c.hasLook ? input.lookY : 0;

    // Gait.
    c.stride = 0;
    c.engage = 0;
    c.dir = 1;
    if (native === 'walk' || native === 'run' || native === 'climb') {
      const cfg = GAIT_CFG[native];
      let v = c.speed;
      if (native === 'climb') {
        this.climbSpeed = damp(this.climbSpeed, speed, 6, dt);
        this.climbEngage = damp(this.climbEngage, clamp01(speed / 0.2), 7, dt);
        if (dt > 0) this.climbVy = damp(this.climbVy, clamp(my / dt, -3000, 3000), 8, dt);
        if (this.climbVy > 25) this.climbDir = -1;
        else if (this.climbVy < -25) this.climbDir = 1;
        v = this.climbSpeed * SPEED_UNIT_DIP;
        c.engage = this.climbEngage;
        c.dir = this.climbDir;
      }
      const hz = clamp((v * cfg.duty) / cfg.maxStride, cfg.minHz, cfg.maxHz);
      c.stride = clamp((v * cfg.duty) / hz, cfg.minStride, cfg.maxStride);
      this.cycle += c.dir * hz * adt;
      if (!Number.isFinite(this.cycle)) this.cycle = 0;
      else if (Math.abs(this.cycle) > 1e5) this.cycle -= Math.trunc(this.cycle);
    }
    c.cyc = this.cycle - Math.floor(this.cycle);

    // Flight.
    if (native === 'jump' || native === 'fall') this.airT += adt;
    else this.airT = 0;
    c.airT = this.airT;
    c.flip = input.jumpKind !== null && input.jumpKind !== undefined && BIG_LEAPS.has(input.jumpKind);

    // Pendulum for the dangling clips: held from the scruff, swinging from the ledge.
    this.stepSway(native, c.t, k, dt, mx);
    c.sway = this.swA;

    // Author the clip.
    const base = this.base;
    (CLIP_FNS[native] ?? CLIP_FNS.stand!)(base, c);

    // Cross-fade.
    const out = this.pose;
    if (this.fadeEl < this.fadeDur) {
      this.fadeEl += dt;
      blendPose(out, this.from, base, smoothStep(this.fadeEl / this.fadeDur));
      this.fading = this.fadeEl < this.fadeDur;
    } else {
      copyPose(out, base);
      this.fading = false;
    }

    const sleeping = native === 'sleep' || input.sleeping === true;
    this.layers(out, input, native, sleeping, dt, adt, k, c);

    if (!poseFinite(out)) {
      copyPose(out, base);
      if (!poseFinite(out)) resetBasePose(out);
    }
    this.rig.solve(out);

    // Tail: gravity-ish spring chain; grounded only while upright on the floor.
    const tp = this.tailPose;
    tp.tailBase = out.tailBase;
    tp.tailCurl = out.tailCurl;
    tp.tailBend = out.tailBend;
    tp.tailStiff = out.tailStiff;
    tp.tailPuff = out.tailPuff;
    const airborne = native === 'held' || native === 'jump' || native === 'fall' || native === 'swing' || native === 'climb' || native === 'hop';
    const groundY = airborne || Math.abs(out.rot) > 0.3 || out.offY < -2 ? Number.NaN : -2.6;
    const rig = this.rig;
    this.tail.step(rig.tailRootX, rig.tailRootY, tp as unknown as Parameters<TailChain['step']>[2], dt * 1000, -mx, -my, groundY);
  }

  /** Spring-damper angle: ambient swing plus a kick from the body's motion. */
  private stepSway(native: AnimClip, t: number, k: number, dt: number, mx: number): void {
    const held = native === 'held';
    const swing = native === 'swing';
    if (!held && !swing) {
      this.swA = damp(this.swA, 0, 12, dt);
      this.swV = damp(this.swV, 0, 12, dt);
      return;
    }
    const w = held ? 7 : 5.2;
    const zeta = held ? 0.16 : 0.07;
    const amb = held ? 0.06 * Math.sin(TAU * 0.8 * t) : 0.3 * Math.sin(TAU * 0.5 * t);
    this.swV += clamp(mx, -30, 30) * 0.05 * (held ? 1 : 0.5);
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.swV += (-w * w * (this.swA - amb * k) - 2 * zeta * w * this.swV) * h;
      this.swA += this.swV * h;
    }
    this.swA = clamp(Number.isFinite(this.swA) ? this.swA : 0, -0.9, 0.9);
    if (!Number.isFinite(this.swV)) this.swV = 0;
  }

  /** Breathing, blink, look-at, idle episodes, mood and reaction on top of the clip. */
  private layers(p: Pose, input: AnimInput, native: AnimClip, sleeping: boolean, dt: number, adt: number, k: number, c: ClipContext): void {
    const arousal = c.arousal;
    // Breathing.
    const depth = c.sleepDepth;
    const rate = sleeping ? 0.24 * (1 - 0.5 * depth) : 0.28 + 0.45 * arousal;
    const amp = (sleeping ? 0.07 : 0.035 + 0.03 * arousal) * (0.6 + 0.4 * k);
    const br = Math.sin(TAU * rate * this.time);
    p.chest += br * amp;
    p.headDY += br * (sleeping ? 0.5 : 0.35) * k;
    p.hipY -= br * 0.1 * k;

    // Blink (never while asleep).
    let blink = 0;
    if (!sleeping) {
      this.blinkAt -= adt;
      if (this.blinkAt <= 0 && this.blinkEl > 0.2) {
        this.blinkEl = 0;
        this.blinkAgain = this.random() < 0.22;
        this.blinkAt = 1.8 + this.random() * 3.4;
      }
      this.blinkEl += adt;
      blink = this.blinkEl < 0.17 ? Math.sin((this.blinkEl / 0.17) * Math.PI) : 0;
      if (this.blinkAgain && this.blinkEl >= 0.17) {
        this.blinkAgain = false;
        this.blinkAt = 0.05;
      }
    }

    // Mood.
    const mt = sleeping ? NO_MOOD : (typeof input.mood === 'string' ? MOOD_TUNE[input.mood] : undefined) ?? NO_MOOD;
    const mo = this.mood;
    mo.smile = damp(mo.smile, mt.smile, 2.2, dt);
    mo.brow = damp(mo.brow, mt.brow, 2.2, dt);
    mo.eyeMul = damp(mo.eyeMul, mt.eyeMul, 2.2, dt);
    mo.perk = damp(mo.perk, mt.perk, 2.2, dt);
    mo.mouth = damp(mo.mouth, mt.mouth, 2.2, dt);
    mo.tilt = damp(mo.tilt, mt.tilt, 2.2, dt);
    const moodW = 0.6 + 0.4 * k;
    p.smile = clamp(p.smile + mo.smile * moodW, -1, 1);
    p.brow = clamp(p.brow + mo.brow * moodW, -1, 1);
    p.eyeOpen *= lerp(1, mo.eyeMul, 1);
    p.earPerk = clamp(p.earPerk + mo.perk, -1, 1);
    p.mouth = clamp01(p.mouth + mo.mouth);
    p.headRot += mo.tilt * 0.6 * k;
    if (input.mood === 'excited' && !sleeping) p.hipY -= Math.abs(Math.sin(TAU * 1.6 * this.time)) * 1.2 * k;
    if (input.mood === 'scared' && !sleeping) p.hipX += Math.sin(this.time * 38) * 0.5 * k;

    // Look-at: the head and eyes follow the target; clips choose how much (lookW).
    const lw = clamp01(p.lookW) * (sleeping ? 0 : 1);
    const hx = this.rig.headX;
    const hy = this.rig.headY;
    const tx = c.hasLook ? clamp((c.lookX - hx) / 55, -1, 1) : 0;
    const ty = c.hasLook ? clamp((c.lookY - hy) / 55, -1, 1) : 0;
    const plx = this.lx;
    const ply = this.ly;
    this.lx = damp(this.lx, tx, 7, dt);
    this.ly = damp(this.ly, ty, 7, dt);
    this.lookMoving = Math.abs(this.lx - plx) + Math.abs(this.ly - ply) > 0.004;
    p.headRot += this.ly * 0.24 * lw * k;
    p.turn += (this.lx < 0 ? this.lx * 0.9 : this.lx * 0.3) * lw;
    p.pupilX += this.lx * 0.8 * lw;
    p.pupilY += this.ly * 0.7 * lw;
    p.headDX += this.lx * 1.2 * lw * k;

    // Idle episodes on the calm clips.
    let epEnv = 0;
    if (IDLE_CLIPS.has(native) && !sleeping) {
      if (this.epKind < 0) {
        this.epNext -= adt;
        if (this.epNext <= 0) {
          this.epKind = Math.floor(this.random() * EP_COUNT) % EP_COUNT;
          this.epEl = 0;
          this.epSeed = this.random() * 6;
        }
      } else {
        this.epEl += adt;
        const D = EP_DUR[this.epKind]!;
        if (this.epEl >= D) {
          this.epKind = -1;
          this.epNext = (2.8 + this.random() * 5) * (1 + this.reduceK);
        }
      }
      if (this.epKind >= 0) {
        const D = EP_DUR[this.epKind]!;
        epEnv = pulse(this.epEl / D, 0, 0.18, 0.8, 1);
        this.applyEpisode(p, this.epKind, epEnv, this.epEl, k);
      }
    } else if (this.epKind >= 0) {
      this.epKind = -1;
      this.epNext = 2.5 + this.random() * 3;
    }

    // One-off body-language reaction from the snapshot.
    let reactEnv = 0;
    const rx = input.reaction;
    if (rx && Number.isFinite(rx.at) && rx.at !== this.reactAt) {
      this.reactAt = rx.at;
      this.reactKind = rx.kind;
      this.reactEl = 0;
    }
    if (this.reactEl < 0.8) {
      this.reactEl += adt;
      const e = clamp01(this.reactEl / (this.reactKind === 'headTilt' ? 0.6 : 0.4));
      reactEnv = Math.sin(Math.PI * e);
      if (this.reactKind === 'earFlick') p.earPerk = clamp(p.earPerk + 1.6 * reactEnv - 0.4 * Math.sin(this.reactEl * 60) * reactEnv, -1, 1);
      else if (this.reactKind === 'tailFlick') {
        p.tailBase += 0.9 * reactEnv * k;
        p.tailCurl += 1.2 * reactEnv * k;
      } else p.headRot += 0.22 * reactEnv * k;
    }

    // Blink applied last so every layer respects it.
    p.eyeOpen = clamp01(p.eyeOpen * (1 - blink));
    this.reactingNow = epEnv > 0.02 || reactEnv > 0.02 || this.lookMoving || Math.abs(this.swV) > 0.05;
  }

  private applyEpisode(p: Pose, kind: number, e: number, t: number, k: number): void {
    const ph = this.epSeed;
    const chestX = p.hipX + Math.sin(p.lean) * 26;
    const chestY = p.hipY - Math.cos(p.lean) * 26;
    switch (kind) {
      case EP_LOOK: {
        const s = Math.sin(TAU * 0.45 * t + ph);
        p.turn += 0.5 * s * e * k;
        p.headRot += 0.16 * s * e * k;
        p.pupilX += 0.7 * s * e;
        p.lookW *= 1 - e;
        break;
      }
      case EP_ARMPIT: {
        // The near hand reaches under the far arm and scratches, head tilted.
        const wig = Math.sin(t * 34) * k;
        p.handNx = lerp(p.handNx, chestX - 3 + 2.5 * wig, e);
        p.handNy = lerp(p.handNy, chestY + 11 + 2 * Math.sin(t * 34 + 1) * k, e);
        p.bendN = lerp(p.bendN, -1, e);
        p.gripN = lerp(p.gripN, 0.6, e);
        p.headRot += 0.14 * e;
        p.eyeOpen *= 1 - 0.4 * e;
        p.smile += 0.3 * e;
        break;
      }
      case EP_INSPECT: {
        // Looks at its own raised hand, turning it over.
        const wr = Math.sin(t * 5 + ph) * k;
        p.handNx = lerp(p.handNx, chestX + 15 + 1.5 * wr, e);
        p.handNy = lerp(p.handNy, chestY - 8 + 1.5 * Math.cos(t * 5), e);
        p.bendN = lerp(p.bendN, -1, e);
        p.gripN = lerp(p.gripN, 0, e);
        p.headRot += 0.18 * e;
        p.pupilX += 0.5 * e;
        p.pupilY += 0.6 * e;
        p.brow += 0.4 * e;
        p.lookW *= 1 - e;
        break;
      }
      case EP_TAIL: {
        p.tailCurl += 1.2 * Math.sin(t * 6) * e * k;
        p.tailBase += 0.4 * Math.sin(t * 4 + 1) * e * k;
        p.turn -= 0.7 * e;
        p.pupilX -= 0.7 * e;
        p.headRot += 0.1 * e;
        p.lookW *= 1 - e;
        break;
      }
      case EP_TILT: {
        p.headRot += 0.3 * e;
        p.brow += 0.6 * e;
        p.earPerk += 0.8 * e;
        p.eyeOpen = Math.min(1, p.eyeOpen + 0.2 * e);
        p.smile += 0.2 * e;
        break;
      }
      default: {
        // Chin scratch: the near hand to the chin, fingers wiggling.
        const wig = Math.sin(t * 22) * k;
        p.handNx = lerp(p.handNx, this.rig.headX + 7 + 1.5 * wig, e);
        p.handNy = lerp(p.handNy, this.rig.headY + 11 + 1.2 * Math.cos(t * 22) * k, e);
        p.bendN = lerp(p.bendN, -1, e);
        p.gripN = lerp(p.gripN, 0.4, e);
        p.headRot -= 0.12 * e;
        p.eyeOpen *= 1 - 0.3 * e;
        p.brow += 0.3 * e;
        break;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Geometry

  /** Adds a pose-space point with radius r: bounds get the full paint pad, the hit rect a small one. */
  private pt(x: number, y: number, r: number, hit: number): void {
    const m = this.rig.m;
    const X = applyMatX(m, x, y);
    const Y = applyMatY(m, x, y);
    const s = this.msc;
    this.g!.add(X, Y, (r + this.padB) * s, -1);
    if (hit >= 0) this.g!.add(X, Y, (r + this.padH) * s, hit);
  }

  /** An ellipse (centre, radii, rotation) as eight inflated samples. */
  private ell(cx: number, cy: number, rx: number, ry: number, rot: number, hit: number): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      const ex = rx * 1.09 * Math.cos(a);
      const ey = ry * 1.09 * Math.sin(a);
      this.pt(cx + ex * c - ey * s, cy + ex * s + ey * c, 0, hit);
    }
  }

  /** A head-local point mapped into pose space. */
  private hpt(lx: number, ly: number, r: number, hit: number): void {
    const rig = this.rig;
    const c = Math.cos(rig.headRot);
    const s = Math.sin(rig.headRot);
    this.pt(rig.headX + lx * c - ly * s, rig.headY + lx * s + ly * c, r, hit);
  }

  measure(g: GeometryCollector): void {
    this.g = g;
    const rig = this.rig;
    const m = rig.m;
    this.msc = Math.max(Math.hypot(m[0]!, m[1]!), Math.hypot(m[2]!, m[3]!), 0.5);
    // Torso (hit 1).
    const pe = rig.pelvis;
    const ce = rig.chestE;
    this.ell(pe.cx, pe.cy, pe.rx, pe.ry, pe.rot, 1);
    this.ell(ce.cx, ce.cy, ce.rx, ce.ry, ce.rot, 1);
    // Head (hit 0): skull, muzzle and both ears.
    const turn = clamp(this.pose.turn, -1, 1);
    const perk = clamp(this.pose.earPerk, -1, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      this.hpt(HEAD_RX * 1.09 * Math.cos(a), HEAD_RY * 1.09 * Math.sin(a), 0, 0);
    }
    const mzx = 2 + 5 * turn + 5.6;
    this.hpt(mzx + 7.6, 5.2, 0, 0);
    this.hpt(mzx, 5.2 + 5.6, 0, 0);
    this.hpt(8.4 - 2.4 * turn, -7.5 - 2 * perk, EAR_R, 0);
    this.hpt(-9.6 + 2.6 * turn, -3.6 - 2.2 * perk, EAR_R, 0);
    // Arms (hits 2, 3): shoulder, elbow, hand (with fingers).
    for (let s = 0; s < 2; s++) {
      const o = s * 2;
      const hit = 2 + s;
      this.pt(rig.sh[o]!, rig.sh[o + 1]!, 3.8, hit);
      this.pt(rig.el[o]!, rig.el[o + 1]!, 3.8, hit);
      this.pt(rig.hand[o]!, rig.hand[o + 1]!, HAND_R + 3.4, hit);
    }
    // Legs (hits 4, 5): hip, knee, foot.
    for (let s = 0; s < 2; s++) {
      const o = s * 2;
      const hit = 4 + s;
      this.pt(rig.hip[o]!, rig.hip[o + 1]!, 4.5, hit);
      this.pt(rig.knee[o]!, rig.knee[o + 1]!, 4.2, hit);
      this.pt(rig.foot[o]! + 2, rig.foot[o + 1]!, FOOT_RX + 1.2, -1);
      this.pt(rig.foot[o]! + 2 + FOOT_RX, rig.foot[o + 1]!, FOOT_RY * 0.6, hit);
      this.pt(rig.foot[o]! + 2 - FOOT_RX, rig.foot[o + 1]!, FOOT_RY * 0.6, hit);
      this.pt(rig.foot[o]! + 2, rig.foot[o + 1]! - FOOT_RY, 0, hit);
      this.pt(rig.foot[o]! + 2, rig.foot[o + 1]! + FOOT_RY, 0, hit);
    }
    // Tail (hit 6 for the root half; the rest is paint only).
    const tail = this.tail;
    const n = tail.count;
    for (let i = 0; i < n; i++) this.pt(tail.x[i]!, tail.y[i]!, 3.2 * tail.puff, i <= n * 0.55 ? 6 : -1);
    const k = clamp(this.pose.shadow, 0, 1.5);
    g.addGround(m[0]! * rig.bodyX + m[4]!, 27 * k * Math.abs(m[0]!) + 4, 4.2 * k + 0.8);
    this.g = null;
  }

  trackedPoints(out: Float64Array): void {
    const rig = this.rig;
    const m = rig.m;
    const tail = this.tail;
    const tip = tail.count - 1;
    const hc = Math.cos(rig.headRot);
    const hs = Math.sin(rig.headRot);
    const px = this.tp;
    px[0] = tail.x[tip]!;
    px[1] = tail.y[tip]!;
    px[2] = rig.headX + HEAD_RX * hc;
    px[3] = rig.headY + HEAD_RX * hs;
    px[4] = rig.hand[0]!;
    px[5] = rig.hand[1]!;
    for (let i = 0; i < 3; i++) {
      out[i * 2] = applyMatX(m, px[i * 2]!, px[i * 2 + 1]!);
      out[i * 2 + 1] = applyMatY(m, px[i * 2]!, px[i * 2 + 1]!);
    }
  }

  emoteAnchor(out: EmoteAnchor): void {
    const rig = this.rig;
    out.x = applyMatX(rig.m, rig.headX, rig.headY);
    out.y = applyMatY(rig.m, rig.headX, rig.headY);
    out.lift = HEAD_RY + 17;
    out.side = 5;
  }

  draw(ctx: Ctx2D, o: DrawParams): void {
    drawMonkey(ctx, this.rig, this.pose, this.tail, getMonkeySkin(o.skin), { outline: o.outline, shadow: o.shadow, pixelsPerUnit: o.pixelsPerUnit, accessory: o.accessory });
  }

  drawShadow(ctx: Ctx2D): void {
    drawMonkeyShadow(ctx, this.rig, this.pose);
  }
}

function smoothStep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function resetBasePose(p: Pose): void {
  CLIP_FNS.stand!(p, { t: 0, cyc: 0, speed: 0, stride: 0, vy: 0, impact: 0, k: 1, lookX: 0, lookY: 0, hasLook: false, arousal: 0, contentment: 0.5, airT: 0, flip: false, engage: 0, dir: 1, sway: 0, sleepDepth: 0 });
}

export function createMonkeyRenderer(random: () => number): CharacterRenderer {
  return new MonkeyRenderer(random);
}
