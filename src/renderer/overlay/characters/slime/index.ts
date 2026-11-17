// Slime renderer: a glossy jelly blob drawn from one closed spline. A spring drives the volume-preserving
// stretch (so every squash overshoots), a second one the sideways lean, and a travelling ripple gives the
// surface its shimmer. Eyes, mouth, core, highlight and bubbles float inside the body. Everything is
// allocation-free after construction; every number is guarded to be finite.
import { ANIM_CLIPS, type AnimClip } from '../../../../shared/cat';
import { CLIP_FALLBACK, CLIP_META } from '../../../../shared/animationCatalog';
import { SLIME_MODULE } from '../../../../shared/characters/slime';
import type { AnimInput, CharacterRenderer, Ctx2D, DrawParams, EmoteAnchor, GeometryCollector } from '../../character/types';
import {
  clamp,
  clamp01,
  damp,
  drawBlobShadow,
  drawPendantBetween,
  fillShape,
  finiteOr,
  isFineDetail,
  isPixelMode,
  smooth,
  strokeOutline,
  TAU,
  traceClosedSpline,
  unitPx,
  wrap01,
} from '../../character/kit';
import { createTgt, H0, resetTgt, sampleClip, W0, type ClipCtx, type Tgt } from './clips';
import { getSlimePalette } from './skins';
import { invisibleBelow, SMOOTH_INVISIBLE_ALPHA } from '../visibility';

/** Points on the body spline. */
/** Longest frame step the animation integrates (the pacing policy draws up to ~100 ms frames). */
const MAX_DT = 0.1;
/** Spring substep: with w <= 60 a step of 12.5 ms keeps w*h at 0.75. */
const SPRING_STEP_S = 0.0125;
const N = 22;
/** Radius added around every drawn point for the outline and the spline's overshoot. */
const PAD = 3.2;
/** Where the grip point of the held clip sits (src/core/interaction/held.ts: HELD_SCRUFF_DIP, y). */
const HOLD_TOP_Y = 58;
const REACTION_S = 0.6;

// ---- clip resolution (the sim resolves too; the renderer must also cope with any raw clip) ------------------

const NATIVE: ReadonlySet<AnimClip> = new Set(SLIME_MODULE.clips);
const RESOLVED = new Map<AnimClip, AnimClip>();
for (const clip of ANIM_CLIPS) {
  let c: AnimClip = clip;
  for (let hops = 0; hops < 8 && !NATIVE.has(c); hops++) c = SLIME_MODULE.clipAlias[c] ?? CLIP_FALLBACK[c] ?? 'stand';
  RESOLVED.set(clip, NATIVE.has(c) ? c : 'stand');
}
/** The native clip that draws `clip` (itself, its alias or the shared fallback). */
export const resolveSlimeClip = (clip: AnimClip): AnimClip => RESOLVED.get(clip) ?? 'stand';

/** How much each clip lets the eyes follow the look target. */
const LOOK_WEIGHT: Partial<Record<AnimClip, number>> = { sleep: 0, wake: 0.2, petted: 0, held: 0, vanish: 0.3, appear: 0.5, stretch: 0.6, dance: 0.3, shake: 0, squish: 0.2, startle: 0.5, groom: 0, scratch: 0, rollOver: 0, tailChase: 0, hiss: 0.3, swat: 0.3, impact: 0, pawAt: 0.5 };
/** Pseudopod: length at extension 1, and its width. */
const ARM_LEN = 16;
const ARM_WIDTH = 6.4;

const sgnPow = (v: number, p: number): number => (v < 0 ? -Math.pow(-v, p) : Math.pow(v, p));

/**
 * Height (above the body bottom) of the pendant collar: 0.4 of the body, but kept under the mouth of the face
 * frame (the heart hangs below the collar and must not cover the face in loaf, held or fall), never below 0.15.
 */
export function pendantCollarHeight(bodyH: number, faceFromBottom: number, fit: number): number {
  const underMouth = faceFromBottom - 6.4 * fit - 5;
  return Math.max(0.15 * bodyH, Math.min(0.4 * bodyH, underMouth));
}

export class SlimeRenderer implements CharacterRenderer {
  readonly id = 'slime' as const;
  private readonly random: () => number;
  private readonly seed: number;
  // Targets and the smoothed pose.
  private readonly T: Tgt = createTgt();
  private readonly cur: Tgt = createTgt();
  private readonly cx: ClipCtx = { t: 0, tl: 0, clock: 0, phase: 0, sp: 0, vy: 0, impact: 0, lookX: 0, lookY: 0, hasLook: false, arousal: 0, depth: 0, rm: 0, seed: 0 };
  // Springs.
  private sv = 0;
  private lv = 0;
  private clock = 0;
  private phase = 0;
  private ripple = 0;
  private rm = 0;
  private started = false;
  private clip: AnimClip = 'stand';
  private clipAt = Number.NaN;
  private blendUntil = -1;
  private prevVx = 0;
  private blinkLeft = 0;
  private nextBlink = 2.5;
  private reactAt = Number.NaN;
  private reactKind = 0;
  private reactT = REACTION_S;
  private _blending = false;
  private _reacting = false;
  // Geometry of the current pose.
  private readonly pts = new Float64Array(N * 2);
  private Ww = W0;
  private Hh = H0;
  private Hb = H0 * 0.3;
  private Ht = H0 * 0.7;
  private lift = 0;
  private cr = 1;
  private sr = 0;
  private px = 0;
  private py = 0;
  private minY = 0;
  private maxY = 0;
  private dripLen = 0;
  private puddleK = 1;
  private shadowK = 1;
  /** Pseudopod: base, tip and width in local view coordinates (armOn when it is out). */
  private armOn = false;
  private abx = 0;
  private aby = 0;
  private atx = 0;
  private aty = 0;
  private armW = ARM_WIDTH;
  // Face frame (body frame, y up) of the current pose.
  private fx = 0;
  private fy = 0;
  private fct = 1;
  private fst = 0;
  private fit = 1;
  /** Pixel mode of the last draw: hardenAlpha erases what is fainter than PIXEL_KEEP_ALPHA, so the token-hit threshold follows the mode of the last draw. */
  private invisible = SMOOTH_INVISIBLE_ALPHA;
  private eyeGap = 8;

  constructor(random: () => number) {
    this.random = random;
    this.seed = finiteOr(random(), 0.5) * 100;
    this.cx.seed = this.seed;
    this.nextBlink = 1.5 + this.random() * 3;
    this.rebuild();
  }

  get blending(): boolean {
    return this._blending;
  }

  get reacting(): boolean {
    return this._reacting;
  }

  resetMotion(): void {
    this.sv = 0;
    this.lv = 0;
    this.prevVx = 0;
    this.cur.lean = this.T.lean;
  }

  // ---- animation -------------------------------------------------------------------------------------------

  advance(input: AnimInput, simTime: number, dtMs: number, motionX: number, motionY: number): void {
    const dt = clamp(finiteOr(dtMs, 0) / 1000, 0, MAX_DT);
    const now = finiteOr(simTime, 0);
    const T = this.T;
    const cur = this.cur;
    const cx = this.cx;
    const wantRm = input.reducedMotion === true ? 1 : 0;
    if (!this.started) {
      this.rm = wantRm;
      this.started = true;
    }
    this.rm = damp(this.rm, wantRm, 4, dt);
    const rm = this.rm;
    this.clock += dt;

    const clip = resolveSlimeClip(input.clip);
    const clipAt = finiteOr(input.clipStartedAt, 0);
    if (clip !== this.clip || clipAt !== this.clipAt) this.onClip(clip, clipAt, now);
    const animSpeed = clamp(finiteOr(input.animSpeed, 1), 0.2, 3);
    const t = Math.max(0, (now - clipAt) / 1000) * animSpeed;
    const loopSlow = 1 - 0.4 * rm;
    const speed = Math.max(0, finiteOr(input.speed, 0));

    // Gait phase (bounce and hop run a cycle whose rate follows the speed).
    const still = speed < 0.05;
    if (clip === 'bounce' || clip === 'hop') {
      const hz = clip === 'bounce' ? (still ? 1.7 : clamp(1.15 + 0.7 * speed, 1.3, 3)) : still ? 1.5 : clamp(1.1 + 0.6 * speed, 1.2, 2.4);
      this.phase = wrap01(this.phase + hz * animSpeed * loopSlow * dt);
    }
    cx.t = t;
    cx.tl = t * loopSlow;
    cx.clock = this.clock;
    cx.phase = this.phase;
    cx.sp = still ? (clip === 'bounce' ? 0.6 : 0.4) : clamp(speed / 2.5, 0, 1);
    cx.vy = finiteOr(input.vy, 0);
    cx.impact = clamp01(finiteOr(input.impact ?? 0, 0));
    cx.hasLook = input.hasLook === true && Number.isFinite(input.lookX) && Number.isFinite(input.lookY);
    cx.lookX = cx.hasLook ? input.lookX : 0;
    cx.lookY = cx.hasLook ? input.lookY : 0;
    cx.arousal = clamp01(finiteOr(input.arousal, 0));
    cx.depth = clamp01(finiteOr(input.sleepDepth ?? 0, 0));
    cx.rm = rm;

    resetTgt(T);
    sampleClip(clip, T, cx);
    this.layers(input, clip, dt, rm, cx);

    // Ease the pose towards the target. The stretch and the lean are springs; the rest follows quickly.
    const k = 14;
    cur.lift = damp(cur.lift, T.lift, 40, dt);
    cur.flat = damp(cur.flat, T.flat, k, dt);
    cur.tear = damp(cur.tear, T.tear, k, dt);
    cur.tip = damp(cur.tip, T.tip, k, dt);
    cur.faceH = damp(cur.faceH, T.faceH, k, dt);
    cur.faceX = damp(cur.faceX, T.faceX, k, dt);
    cur.tilt = damp(cur.tilt, T.tilt, 12, dt);
    cur.eyeOpen = damp(cur.eyeOpen, T.eyeOpen, 22, dt);
    cur.eyeScale = damp(cur.eyeScale, T.eyeScale, k, dt);
    cur.happy = damp(cur.happy, T.happy, 18, dt);
    cur.sleepEye = damp(cur.sleepEye, T.sleepEye, 12, dt);
    cur.pupX = damp(cur.pupX, T.pupX, 10, dt);
    cur.pupY = damp(cur.pupY, T.pupY, 10, dt);
    cur.mouthOpen = damp(cur.mouthOpen, T.mouthOpen, 16, dt);
    cur.smile = damp(cur.smile, T.smile, 10, dt);
    cur.blush = damp(cur.blush, T.blush, 6, dt);
    cur.bubble = T.bubble > cur.bubble ? damp(cur.bubble, T.bubble, 14, dt) : damp(cur.bubble, T.bubble, 30, dt);
    cur.bubbleRise = T.bubbleRise;
    cur.bubblePop = T.bubblePop;
    cur.jig = damp(cur.jig, T.jig, 8, dt);
    cur.rot = damp(cur.rot, T.rot, 14, dt);
    cur.ox = damp(cur.ox, T.ox, 14, dt);
    cur.pivX = damp(cur.pivX, T.pivX, 14, dt);
    cur.pivY = damp(cur.pivY, T.pivY, 14, dt);
    cur.hold = damp(cur.hold, T.hold, 14, dt);
    cur.scl = damp(cur.scl, T.scl, 14, dt);
    cur.alpha = damp(cur.alpha, T.alpha, 16, dt);
    cur.puddle = damp(cur.puddle, T.puddle, 18, dt);
    cur.arm = damp(cur.arm, T.arm, 26, dt);
    cur.armA = damp(cur.armA, T.armA, 22, dt);
    cur.armY = damp(cur.armY, T.armY, 14, dt);
    cur.armFront = T.armFront;

    // Velocity lean and the kick of a sudden start or stop on the top of the body.
    const mx = finiteOr(motionX, 0);
    const vx = dt > 0.002 ? clamp(mx / dt, -900, 900) : this.prevVx;
    const lean = T.lean + clamp(vx * 0.0007, -0.14, 0.14) * (1 - 0.6 * rm);
    if (dt > 0.002) this.lv -= clamp((vx - this.prevVx) * 0.0018, -1.6, 1.6) * (1 - 0.6 * rm);
    this.prevVx = vx;
    void motionY;
    if (dt > 0) {
      const zeta = 0.42 + 0.4 * rm;
      // Substep so a long frame (previews at 12 fps, a deep-sleep 90 ms frame) stays stable: w * h <= ~0.75.
      const steps = Math.max(2, Math.ceil(dt / SPRING_STEP_S));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const w = clamp(T.omega, 10, 60);
        this.sv += (w * w * (T.s - cur.s) - 2 * zeta * w * this.sv) * h;
        cur.s += this.sv * h;
        const wl = 22;
        this.lv += (wl * wl * (lean - cur.lean) - 2 * 0.35 * wl * this.lv) * h;
        cur.lean += this.lv * h;
      }
    } else {
      cur.s = T.s;
      cur.lean = lean;
    }
    if (!Number.isFinite(cur.s) || !Number.isFinite(this.sv)) {
      cur.s = 0;
      this.sv = 0;
    }
    if (!Number.isFinite(cur.lean) || !Number.isFinite(this.lv)) {
      cur.lean = 0;
      this.lv = 0;
    }
    cur.s = clamp(cur.s, -1.1, 0.75);
    cur.lean = clamp(cur.lean, -0.6, 0.6);
    this.ripple += dt * (9 + 6 * cx.arousal);
    if (this.ripple > 1e4) this.ripple = 0;

    this._blending = now < this.blendUntil;
    this._reacting = this.reactT < REACTION_S;
    this.rebuild();
  }

  private onClip(clip: AnimClip, at: number, now: number): void {
    const prev = this.clip;
    const cur = this.cur;
    // Re-forming from a flat puddle: the jelly wobbles.
    if (cur.s < -0.45 && clip !== 'sleep' && clip !== 'hide' && clip !== 'peek' && clip !== 'loaf' && clip !== 'vanish') this.sv += 1.2;
    if (clip === 'bounce' || clip === 'hop') {
      if (prev !== 'bounce' && prev !== 'hop') this.phase = 0;
    }
    this.clip = clip;
    this.clipAt = at;
    const fade = CLIP_META[clip]?.fadeInMs ?? 200;
    this.blendUntil = now + Math.max(160, fade + 120);
  }

  /** Mood, look, blink and reaction layers on top of the clip's target. */
  private layers(input: AnimInput, clip: AnimClip, dt: number, rm: number, cx: ClipCtx): void {
    const T = this.T;
    const sleeping = clip === 'sleep' || input.sleeping === true;
    T.jig += 0.02 * cx.arousal;
    if (clip !== 'annoyed') T.smile += 0.2 * (clamp01(finiteOr(input.contentment, 0.5)) - 0.5);
    switch (input.mood) {
      case 'happy':
        T.smile += 0.25;
        T.blush += 0.2;
        break;
      case 'excited':
        T.jig += 0.03;
        T.eyeScale *= 1.06;
        T.mouthOpen += 0.1;
        break;
      case 'sleepy':
        if (!sleeping) T.eyeOpen *= 0.65;
        break;
      case 'startled':
        T.eyeScale *= 1.18;
        T.mouthOpen += 0.2;
        break;
      case 'scared':
        T.eyeScale *= 1.14;
        T.lean -= 0.03;
        T.jig += 0.03;
        break;
      case 'relaxed':
        T.eyeOpen *= 0.86;
        T.smile += 0.15;
        break;
      case 'curious':
        T.eyeScale *= 1.06;
        T.tear += 0.08;
        break;
      case 'confused':
        T.tilt += 0.2;
        break;
      default:
        break;
    }
    if (cx.hasLook) {
      const w = LOOK_WEIGHT[clip] ?? 1;
      if (w > 0) {
        T.pupX += clamp(cx.lookX / 60, -1, 1) * 1.6 * w;
        T.pupY += clamp(cx.lookY / 60, -1, 1) * 1.3 * w;
        T.faceX += clamp(cx.lookX / 90, -1, 1) * 0.18 * w;
      }
    }
    // Blinks (never while asleep, squeezed shut or hidden).
    if (this.blinkLeft > 0) {
      this.blinkLeft = Math.max(0, this.blinkLeft - dt);
      const p = 1 - this.blinkLeft / 0.16;
      T.eyeOpen *= 1 - Math.sin(Math.PI * clamp01(p)) * 0.92;
    } else if (!sleeping && T.eyeOpen > 0.3 && T.happy < 0.3) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        this.blinkLeft = 0.16;
        this.nextBlink = this.random() < 0.2 ? 0.25 : 2.2 + this.random() * 3.3;
      }
    }
    // One-off body-language reactions: jiggle sideways, wiggle the top, tilt the face.
    const r = input.reaction;
    if (r && r.at !== this.reactAt) {
      this.reactAt = r.at;
      this.reactKind = r.kind === 'earFlick' ? 1 : r.kind === 'tailFlick' ? 2 : 3;
      this.reactT = 0;
    }
    if (this.reactT < REACTION_S) {
      this.reactT += dt;
      const e = Math.sin((Math.PI * clamp01(this.reactT / REACTION_S)));
      if (this.reactKind === 1) T.lean += 0.12 * e * Math.sin(TAU * 5 * this.reactT);
      else if (this.reactKind === 2) {
        T.tear += 0.5 * e;
        T.tip += 0.3 * e;
      } else T.tilt += 0.4 * e;
    }
    // Reduced motion: smaller amplitudes, no shimmer.
    if (rm > 0) {
      const k = 1 - rm;
      T.s *= 1 - 0.55 * rm;
      T.lift *= 1 - 0.7 * rm;
      T.lean *= 1 - 0.6 * rm;
      T.jig *= 1 - 0.85 * rm;
      T.tear *= 1 - 0.4 * rm;
      T.tip *= 1 - 0.6 * rm;
      T.rot *= 1 - 0.5 * rm;
      T.arm *= 1 - 0.35 * rm;
      T.tilt *= 1 - 0.5 * rm;
      T.faceX *= 1 - 0.3 * rm;
      void k;
    }
  }

  // ---- geometry ----------------------------------------------------------------------------------------------

  /** Body-frame point (x, height above the ground) to local view coordinates, into this.px / this.py. */
  private put(x: number, yG: number): void {
    const c = this.cur;
    const bx = (x + c.lean * (yG - this.lift)) * c.scl + c.ox;
    const by = -yG * c.scl;
    const dx = bx - c.pivX;
    const dy = by - c.pivY;
    this.px = c.pivX + dx * this.cr - dy * this.sr;
    this.py = c.pivY + dx * this.sr + dy * this.cr;
  }

  /** Half width of the body at `yFromBottom` above its bottom (the same shape rebuild() traces). */
  private halfWidthAt(yFromBottom: number): number {
    const u = yFromBottom - this.Hb;
    let w: number;
    if (u >= 0) {
      const r = clamp(u / this.Ht, 0, 1);
      const sn = Math.pow(r, 1 / 0.95);
      w = this.Ww * Math.pow(Math.sqrt(Math.max(0, 1 - sn * sn)), 0.92);
      w *= 1 - this.cur.tear * 0.85 * smooth((r - 0.15) / 0.85);
    } else {
      const sn = Math.pow(clamp(-u / this.Hb, 0, 1), 2);
      w = this.Ww * Math.pow(Math.sqrt(Math.max(0, 1 - sn * sn)), 0.92);
    }
    return Math.max(1, w);
  }

  private rebuild(): void {
    const c = this.cur;
    const Hh = clamp(H0 * Math.exp(c.s), 10, 92);
    const Ww = clamp(W0 * Math.exp(-c.s * 0.95) * (1 + 0.5 * c.flat), 13, 62);
    this.Hh = Hh;
    this.Ww = Ww;
    this.Hb = Hh * 0.3;
    this.Ht = Hh - this.Hb;
    const tipExtra = c.tip * 0.45 * Hh;
    // Held: the top of the body hangs from the grip point.
    this.lift = c.hold > 0.001 ? c.lift + (HOLD_TOP_Y - Hh - tipExtra - c.lift) * clamp01(c.hold) : c.lift;
    const rot = clamp(finiteOr(c.rot, 0), -0.6, 0.6);
    this.cr = Math.cos(rot);
    this.sr = Math.sin(rot);
    const jig = clamp(c.jig + 0.02 * Math.min(1, Math.abs(this.sv) * 0.5) + 0.03 * Math.min(1, Math.abs(this.lv)), 0, 0.14);
    const ph = this.ripple;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      const a = (TAU * i) / N;
      const co = Math.cos(a);
      const sn = Math.sin(a);
      let x = Ww * sgnPow(co, 0.92);
      let yu: number;
      if (sn > 0) {
        const r = Math.pow(sn, 0.95);
        yu = this.Ht * r;
        x *= 1 - c.tear * 0.85 * smooth((r - 0.15) / 0.85);
        yu += tipExtra * Math.pow(r, 4);
      } else {
        yu = -this.Hb * Math.pow(-sn, 0.5);
      }
      const rip = 1 + jig * (Math.sin(3 * a + ph) + 0.55 * Math.sin(5 * a - 1.3 * ph)) * (0.2 + 0.8 * Math.max(0, sn));
      x *= rip;
      if (sn > 0) yu *= rip;
      const yG = Math.max(this.lift, this.lift + this.Hb + yu);
      this.put(x, yG);
      const X = Number.isFinite(this.px) ? this.px : 0;
      const Y = Number.isFinite(this.py) ? this.py : 0;
      this.pts[i * 2] = X;
      this.pts[i * 2 + 1] = Y;
      if (Y < minY) minY = Y;
      if (Y > maxY) maxY = Y;
    }
    this.minY = minY;
    this.maxY = maxY;

    // Pseudopod: a lobe out of the side of the body (base just inside the edge at its height).
    this.armOn = c.arm > 0.04 && c.alpha > 0.01;
    if (this.armOn) {
      const ayb = clamp(c.armY, 0.1, 0.9) * Hh;
      const abx = Math.max(2, this.halfWidthAt(ayb) - 1.5);
      const aby = this.lift + ayb;
      const len = ARM_LEN * clamp(c.arm, 0, 1.4);
      const ang = clamp(finiteOr(c.armA, 0), -1.5, 3.4);
      this.put(abx, aby);
      this.abx = this.px;
      this.aby = this.py;
      this.put(abx + Math.cos(ang) * len, aby + Math.sin(ang) * len);
      this.atx = Number.isFinite(this.px) ? this.px : this.abx;
      this.aty = Number.isFinite(this.py) ? this.py : this.aby;
      this.armW = ARM_WIDTH * clamp(0.55 + 0.45 * c.arm, 0.55, 1) * c.scl;
    }
    // Face frame.
    const fh = clamp(c.faceH, 0.3, 0.8);
    const fyFromBottom = fh * Hh;
    const hw = this.halfWidthAt(fyFromBottom);
    this.fx = clamp(c.faceX, -0.6, 0.6) * Ww * 0.55;
    this.fx = clamp(this.fx, -hw * 0.45, hw * 0.45);
    this.fy = this.lift + fyFromBottom;
    this.fct = Math.cos(c.tilt);
    this.fst = Math.sin(c.tilt);
    this.fit = clamp(Math.min(Hh / 34, hw / 14), 0.5, 1);
    this.eyeGap = Math.min(clamp(Ww * 0.24 + 1.5, 5.5, 9.5), hw * 0.5);

    const air = c.puddle < 0.5 && c.hold < 0.5;
    this.dripLen = air ? clamp(this.lift * 0.2 + Math.max(0, c.s) * 5, 0, 6) : 0;
    this.puddleK = clamp(1 - this.lift / 5, 0, 1) * clamp(c.puddle, 0, 1.6) * (1 - clamp01(c.hold));
    const clipAir = this.clip === 'jump' || this.clip === 'fall';
    this.shadowK = (1 - clamp01(c.hold)) * (clipAir ? 0.5 : 1) / (1 + this.lift / 50);
  }

  /** Face-frame offset (dx, dy up) to local view coordinates (this.px / this.py). */
  private putFace(dx: number, dy: number): void {
    this.put(this.fx + dx * this.fct - dy * this.fst, this.fy + dx * this.fst + dy * this.fct);
  }

  private puddleRx(): number {
    return (this.Ww * (1 + 0.04 * this.cur.puddle) + 1.4 + 3 * this.cur.flat) * this.cur.scl;
  }

  // ---- seam: geometry, anchors -------------------------------------------------------------------------------

  measure(g: GeometryCollector): void {
    const P = this.pts;
    const span = Math.max(1e-3, this.maxY - this.minY);
    // Faded out (the vanish clip): the space stays reported for the dirty rect, but only a token spot is clickable.
    if (this.cur.alpha < this.invisible) {
      for (let i = 0; i < N; i++) g.add(P[i * 2]!, P[i * 2 + 1]!, PAD, -1);
      if (this.armOn) g.add(this.atx, this.aty, this.armW * 0.65 + PAD, -1);
      this.put(0, this.lift);
      g.add(this.px, this.py - 3, 3, 0);
      this.put(0, 0);
      g.addGround(this.px, this.puddleRx() + 5, 6.4);
      return;
    }
    for (let i = 0; i < N; i++) {
      const x = P[i * 2]!;
      const y = P[i * 2 + 1]!;
      const f = (y - this.minY) / span;
      const primary = f < 0.34 ? 1 : f > 0.68 ? 2 : 0;
      g.add(x, y, PAD, primary);
      // Overlap the neighbouring band near a band edge so the rectangles leave no gap inside the body.
      if (f > 0.34 - 0.14 && f < 0.34 + 0.14) g.add(x, y, PAD, primary === 1 ? 0 : 1);
      if (f > 0.68 - 0.14 && f < 0.68 + 0.14) g.add(x, y, PAD, primary === 2 ? 0 : 2);
    }
    if (this.armOn) {
      const r = this.armW * 0.65 + PAD;
      g.add(this.abx, this.aby, r, 5);
      g.add((this.abx + this.atx) / 2, (this.aby + this.aty) / 2, r, 5);
      g.add(this.atx, this.aty, r, 5);
    }
    this.put(0, this.lift);
    const gx = this.px;
    const gy = this.py;
    if (this.puddleK > 0.02) {
      const rx = this.puddleRx();
      g.add(gx, gy - 0.4, 3.2, 3);
      g.add(gx - rx + 3, gy - 0.4, 3.2, 3);
      g.add(gx + rx - 3, gy - 0.4, 3.2, 3);
    }
    if (this.dripLen > 0.8) {
      g.add(gx, gy + this.dripLen, 3.8, 4);
    }
    // The shadow (upper bound: no airborne shrink).
    this.put(0, 0);
    g.addGround(this.px, this.puddleRx() + 5, 6.4);
    // Bubble.
    if (this.cur.bubble > 0.02) {
      const r = this.bubbleGeom();
      g.add(this.bx, this.by, r * 1.45 + PAD, -1);
    }
  }

  trackedPoints(out: Float64Array): void {
    const P = this.pts;
    const top = (N / 4) | 0;
    const left = (N / 2) | 0;
    out[0] = P[top * 2]!;
    out[1] = P[top * 2 + 1]!;
    out[2] = P[left * 2]!;
    out[3] = P[left * 2 + 1]!;
    out[4] = P[0]!;
    out[5] = P[1]!;
  }

  emoteAnchor(out: EmoteAnchor): void {
    const top = (N / 4) | 0;
    out.x = this.pts[top * 2]!;
    out.y = this.pts[top * 2 + 1]!;
    out.lift = 14;
    out.side = 3;
  }

  // ---- drawing ---------------------------------------------------------------------------------------------

  private bx = 0;
  private by = 0;

  /** The bubble's centre (this.bx / this.by) and radius. */
  private bubbleGeom(): number {
    const c = this.cur;
    const small = this.clip === 'sleep' || this.clip === 'wake';
    const b = clamp01(c.bubble);
    const wob = 1 + 0.04 * Math.sin(this.clock * 9);
    const r = (small ? 2 + 5.5 * b : 2 + 13 * b) * wob;
    const rise = clamp01(c.bubbleRise);
    const mouthDy = -6.4 * this.fit;
    this.putFace(5 + r * 0.8 + rise * 26, mouthDy + r * 0.3 + rise * 34 - (small ? 1 : 0));
    this.bx = this.px;
    this.by = this.py;
    return r;
  }

  drawShadow(ctx: Ctx2D): void {
    this.put(0, 0);
    drawBlobShadow(ctx, this.px, 0, (this.Ww * 0.95 + 4) * this.cur.scl * (this.shadowK > 0 ? 1 : 0), 5.2, 0.24 * this.shadowK * this.cur.alpha);
  }

  draw(ctx: Ctx2D, o: DrawParams): void {
    const c = this.cur;
    if (!(c.alpha > 0.004)) return;
    const pal = getSlimePalette(o.skin);
    const ol = Math.max(0.1, finiteOr(o.outline, 1.6));
    const ppu = finiteOr(o.pixelsPerUnit, 1);
    const pix = isPixelMode(ppu);
    this.invisible = invisibleBelow(ppu);
    const fine = isFineDetail(ppu);
    const up = unitPx(ppu);
    const P = this.pts;
    ctx.save();
    ctx.globalAlpha *= clamp01(c.alpha);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (o.shadow && this.shadowK > 0.01) {
      this.put(0, 0);
      drawBlobShadow(ctx, this.px, 0, (this.Ww * 0.95 + 4) * c.scl, 5.2, 0.24 * this.shadowK);
    }

    // Group 1: puddle lip, drips and the body: all outlined first, then all filled.
    this.put(0, this.lift);
    const gx = this.px;
    const gy = this.py;
    const pk = this.puddleK;
    const rx = this.puddleRx();
    const ry = 1.9 + 0.9 * clamp(pk, 0, 1.5);
    const lump = !pix && pk > 0.3;
    // Lip.
    if (pk > 0.02) {
      ctx.beginPath();
      ctx.ellipse(gx, gy - 0.3, rx, ry * Math.min(1, pk + 0.2), 0, 0, TAU);
      if (lump) {
        ctx.moveTo(gx - rx + 5.6, gy - 0.8);
        ctx.ellipse(gx - rx + 3.2, gy - 0.8, 2.4, 1.9, 0, 0, TAU);
        ctx.moveTo(gx + rx - 0.8, gy - 0.8);
        ctx.ellipse(gx + rx - 3.2, gy - 0.8, 2.4, 1.9, 0, 0, TAU);
      }
      strokeOutline(ctx, pal.outline, ol);
    }
    const armBehind = this.armOn && c.armFront < 0.5;
    if (armBehind) this.drawArm(ctx, pal.outline, ol, true);
    // Body.
    ctx.beginPath();
    traceClosedSpline(ctx, P, N);
    if (this.dripLen > 0.8) {
      const dl = this.dripLen;
      ctx.moveTo(gx + 3, gy + dl * 0.5);
      ctx.ellipse(gx, gy + dl * 0.5, 3, 2 + dl * 0.5, 0, 0, TAU);
    }
    strokeOutline(ctx, pal.outline, ol);
    if (armBehind) this.drawArm(ctx, pal.body, ol, false);
    if (pk > 0.02) {
      ctx.beginPath();
      ctx.ellipse(gx, gy - 0.3, rx, ry * Math.min(1, pk + 0.2), 0, 0, TAU);
      if (lump) {
        ctx.moveTo(gx - rx + 5.6, gy - 0.8);
        ctx.ellipse(gx - rx + 3.2, gy - 0.8, 2.4, 1.9, 0, 0, TAU);
        ctx.moveTo(gx + rx - 0.8, gy - 0.8);
        ctx.ellipse(gx + rx - 3.2, gy - 0.8, 2.4, 1.9, 0, 0, TAU);
      }
      fillShape(ctx, pal.lip);
    }
    ctx.beginPath();
    traceClosedSpline(ctx, P, N);
    if (this.dripLen > 0.8) {
      const dl = this.dripLen;
      ctx.moveTo(gx + 3, gy + dl * 0.5);
      ctx.ellipse(gx, gy + dl * 0.5, 3, 2 + dl * 0.5, 0, 0, TAU);
    }
    fillShape(ctx, pal.body);

    this.drawInside(ctx, pal, pix, fine, up);
    this.drawFace(ctx, pal, pix, fine, up);
    if (this.armOn && c.armFront >= 0.5) {
      this.drawArm(ctx, pal.outline, ol, true);
      this.drawArm(ctx, pal.body, ol, false);
    }
    if (c.bubble > 0.02) this.drawBubble(ctx, pal, pix, ol);
    if (o.accessory === 'heartPendant') this.drawPendant(ctx, pal.outline, ol, ppu);
    ctx.restore();
  }

  /** The pseudopod: a thick rounded stroke ending in a small bulb; the outline pass strokes it wider. */
  private drawArm(ctx: Ctx2D, color: string, ol: number, outlinePass: boolean): void {
    const grow = outlinePass ? ol * 2 : 0;
    const r = this.armW * 0.62 + grow * 0.5;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(0.1, this.armW + grow);
    ctx.beginPath();
    ctx.moveTo(this.abx, this.aby);
    ctx.lineTo(this.atx, this.aty);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.atx, this.aty, r, 0, TAU);
    ctx.fill();
  }

  /** Core, highlight and the tiny bubbles floating in the jelly. */
  private drawInside(ctx: Ctx2D, pal: ReturnType<typeof getSlimePalette>, pix: boolean, fine: boolean, up: number): void {
    const c = this.cur;
    const Hh = this.Hh;
    const Ww = this.Ww;
    const rot = this.sr !== 0 ? Math.atan2(this.sr, this.cr) : 0;
    // Core: a darker bean low in the belly.
    const coreY = this.lift + Hh * 0.27;
    const chw = this.halfWidthAt(Hh * 0.27);
    this.put(-c.lean * 3 + Math.sin(this.clock * 1.3 + this.seed) * 1.2, coreY);
    ctx.beginPath();
    ctx.ellipse(this.px, this.py, Math.max(2, Math.min(Ww * 0.46, chw * 0.62)) * c.scl, Math.max(1.6, Hh * 0.13) * c.scl, rot, 0, TAU);
    ctx.fillStyle = pal.core;
    ctx.fill();
    // Highlight: a glossy bean up on the left shoulder.
    if (Hh > 17) {
      const hy = Hh * 0.78;
      const hhw = this.halfWidthAt(hy);
      this.put(-Math.min(hhw * 0.55, Ww * 0.42), this.lift + hy);
      const hx = this.px;
      const hyy = this.py;
      ctx.beginPath();
      ctx.ellipse(hx, hyy, Math.max(1.8, Math.min(Ww * 0.22, hhw * 0.3)) * c.scl, Math.max(1.2, Hh * 0.07) * c.scl, rot - 0.65, 0, TAU);
      ctx.fillStyle = pal.light;
      const ga0 = ctx.globalAlpha;
      ctx.globalAlpha = ga0 * 0.85;
      ctx.fill();
      ctx.globalAlpha = ga0;
      if (!pix) {
        this.put(-Math.min(hhw * 0.55, Ww * 0.42) + 4.2, this.lift + hy - Hh * 0.1);
        ctx.beginPath();
        ctx.arc(this.px, this.py, Math.max(0.8, 1 * c.scl), 0, TAU);
        ctx.fill();
      }
    }
    // Tiny bubbles drifting up inside the jelly.
    if (fine && Hh > 30 && c.hold < 0.5) {
      ctx.fillStyle = pal.light;
      const ga1 = ctx.globalAlpha;
      ctx.globalAlpha = ga1 * 0.5;
      for (let i = 0; i < 3; i++) {
        const u = wrap01(this.clock * 0.05 + i / 3 + this.seed * 0.01);
        const bx = (i - 1) * Ww * 0.42 + Math.sin(this.clock * 0.7 + i * 2) * 2;
        const by = this.lift + Hh * (0.14 + 0.42 * u);
        if (Math.abs(bx) < this.halfWidthAt(by - this.lift) * 0.7) {
          this.put(bx, by);
          ctx.beginPath();
          ctx.arc(this.px, this.py, (1 + (i % 2) * 0.5) * c.scl, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = ga1;
    }
    void up;
  }

  private drawFace(ctx: Ctx2D, pal: ReturnType<typeof getSlimePalette>, pix: boolean, fine: boolean, up: number): void {
    const c = this.cur;
    const fit = this.fit;
    const scl = c.scl;
    const rot = (this.sr !== 0 ? Math.atan2(this.sr, this.cr) : 0) - c.tilt;
    const eg = this.eyeGap;
    const rx = 3.1 * fit * clamp(c.eyeScale, 0.6, 1.5);
    const lw = Math.max(1.7 * fit, up * 1.1);
    const open = clamp(c.eyeOpen, 0, 1.2);
    const px = clamp(c.pupX, -2, 2) * fit;
    const py = -clamp(c.pupY, -2, 2) * 0.8 * fit;
    ctx.lineWidth = lw;
    ctx.strokeStyle = pal.eye;
    for (let s = -1; s <= 1; s += 2) {
      this.putFace(s * eg + px, py);
      const ex = this.px;
      const ey = this.py;
      if (c.happy > 0.5) {
        ctx.beginPath();
        ctx.arc(ex, ey + 1.1 * fit * scl, rx * 1.05 * scl, Math.PI + 0.3 + rot, TAU - 0.3 + rot);
        ctx.stroke();
      } else if (c.sleepEye > 0.5 || open < 0.14) {
        ctx.beginPath();
        ctx.moveTo(ex - rx * scl, ey - 0.4);
        ctx.quadraticCurveTo(ex, ey + 2.6 * fit * scl, ex + rx * scl, ey - 0.4);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(ex, ey, rx * scl, Math.max(0.6, 3.7 * fit * clamp(c.eyeScale, 0.6, 1.5) * clamp(open, 0.12, 1.2)) * scl, rot, 0, TAU);
        ctx.fillStyle = pal.eye;
        ctx.fill();
        if (!pix && open > 0.4) {
          ctx.beginPath();
          ctx.arc(ex - 0.95 * fit * scl, ey - 1.25 * fit * scl * Math.min(1, open), Math.max(0.6, 1.05 * fit * scl), 0, TAU);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }
      // Cheek.
      if (!pix && c.blush > 0.12 && eg * 2 + 12 < this.halfWidthAt(this.fy - this.lift) * 2.1) {
        this.putFace(s * (eg + 5.6 * fit), -3.6 * fit);
        ctx.beginPath();
        ctx.ellipse(this.px, this.py, 2.6 * fit * scl, 1.6 * fit * scl, rot, 0, TAU);
        ctx.fillStyle = pal.cheek;
        const ga2 = ctx.globalAlpha;
        ctx.globalAlpha = ga2 * clamp01(c.blush) * 0.6;
        ctx.fill();
        ctx.globalAlpha = ga2;
      }
    }
    // Mouth.
    const mo = clamp(c.mouthOpen, 0, 1.4);
    if (fit < 0.6 && mo < 0.3) return;
    const mw = 3.3 * fit * (1 + 0.4 * Math.min(1, mo));
    const my = -6.4 * fit - (mo > 0.3 ? mo * 0.8 : 0);
    if (mo > 0.12) {
      this.putFace(0, my);
      ctx.beginPath();
      ctx.ellipse(this.px, this.py, mw * (0.62 + 0.25 * Math.min(1, mo)) * scl, (0.9 + 3.2 * Math.min(1.3, mo) * fit) * scl, rot, 0, TAU);
      ctx.fillStyle = pal.mouth;
      ctx.fill();
      if (fine && mo > 0.55) {
        ctx.beginPath();
        ctx.ellipse(this.px, this.py + 1.4 * fit * scl, mw * 0.4 * scl, 1.1 * fit * scl, rot, 0, TAU);
        ctx.fillStyle = pal.cheek;
        ctx.fill();
      }
    } else {
      const sm = clamp(c.smile, -1, 1.2);
      this.putFace(-mw, my);
      const ax = this.px;
      const ay = this.py;
      this.putFace(mw, my);
      const bx = this.px;
      const by = this.py;
      this.putFace(0, my - 3.1 * sm * fit);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(this.px, this.py + (sm < 0 ? 0 : 0), bx, by);
      ctx.lineWidth = Math.max(1.5 * fit, up);
      ctx.strokeStyle = pal.eye;
      ctx.stroke();
    }
  }

  private drawBubble(ctx: Ctx2D, pal: ReturnType<typeof getSlimePalette>, pix: boolean, ol: number): void {
    const c = this.cur;
    const r0 = this.bubbleGeom();
    const pop = clamp01(c.bubblePop);
    const r = r0 * (1 + 0.35 * pop);
    ctx.save();
    ctx.globalAlpha *= 1 - pop;
    ctx.beginPath();
    ctx.arc(this.bx, this.by, r, 0, TAU);
    if (!pix) {
      const ga3 = ctx.globalAlpha;
      ctx.globalAlpha = ga3 * 0.55;
      ctx.fillStyle = pal.bubble;
      ctx.fill();
      ctx.globalAlpha = ga3;
    }
    ctx.lineWidth = Math.max(1.1, ol * 0.8);
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    if (!pix && r > 3.5) {
      ctx.beginPath();
      ctx.arc(this.bx, this.by, r * 0.62, Math.PI * 1.1, Math.PI * 1.55);
      ctx.lineWidth = Math.max(0.9, r * 0.12);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The shared heart pendant on a collar across the chest, below the face: follows the body in every pose. */
  private drawPendant(ctx: Ctx2D, outline: string, ol: number, ppu: number): void {
    const yb = pendantCollarHeight(this.Hh, this.fy - this.lift, this.fit);
    const hw = this.halfWidthAt(yb);
    const half = clamp(hw * 0.4, 3, 9);
    const y = this.lift + yb;
    this.put(-half, y);
    const ax = this.px;
    const ay = this.py;
    this.put(half, y);
    const bx = this.px;
    const by = this.py;
    const k = clamp(Math.min(this.Hh / 46, hw / 30) * this.cur.scl, 0.4, 0.95);
    drawPendantBetween(ctx, ax, ay, bx, by, -this.sr, this.cr, k, outline, ol, ppu);
  }
}

export function createSlimeRenderer(random: () => number): CharacterRenderer {
  return new SlimeRenderer(random);
}
