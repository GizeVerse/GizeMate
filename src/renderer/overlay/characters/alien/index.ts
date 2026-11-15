// The alien as a CharacterRenderer: a slim grey-green humanoid with an oversized head, almond eyes and
// two springy glowing antennae, levitating above the ground. Pose, rig and painter live beside this
// file; this class is the seam (geometry roles, tracked points, emote anchor, draw).
import type { AnimInput, CharacterRenderer, DrawParams, EmoteAnchor, GeometryCollector } from '../../character/types';
import type { Ctx2D } from '../../character/kit';
import { AlienAnimator } from './animator';
import { ARM_W, BULB_R, drawAlien, drawAlienShadow, HAND_R, LEG_W, SCAN_BOTTOM, SCAN_FRONT, SCAN_LEN, SCAN_TOP, type DrawState } from './draw';
import { getPalette, type AlienPalette } from './palettes';
import { invisibleBelow, SMOOTH_INVISIBLE_ALPHA } from '../visibility';
import { AlienRig, HEAD_POINTS, HEAD_RX, TORSO_POINTS } from './rig';

/**
 * Hit roles (indices into the scene's hit rects): head 0, torso 1, back arm 2, front arm 3, back leg 4,
 * front leg 5, back antenna 6, front antenna 7.
 */
export class AlienRenderer implements CharacterRenderer {
  readonly id = 'alien' as const;
  readonly animator: AlienAnimator;
  readonly rig = new AlienRig();
  private pal: AlienPalette = getPalette('green');
  private pixel = false;
  private hidden = false;
  /** Alpha below which the body is invisible (pixel mode hardens alpha, so it is higher there). */
  private invisibleBelow = SMOOTH_INVISIBLE_ALPHA;
  private readonly st: DrawState;
  private g: GeometryCollector | null = null;

  constructor(random: () => number) {
    this.animator = new AlienAnimator(random);
    this.st = { pose: this.animator.pose, clock: 0, calm: 0, glowL: 0.55, glowR: 0.55 };
    // First solve so measure/draw work before the first advance.
    this.rig.solve(this.animator.pose, 0, 0, 0, 0.55, 0.55);
  }

  get pose(): AnimatorPose {
    return this.animator.pose;
  }

  get blending(): boolean {
    return this.animator.blending;
  }

  get reacting(): boolean {
    return this.animator.reacting;
  }

  advance(input: AnimInput, simTime: number, dtMs: number, motionX: number, motionY: number): void {
    const pose = this.animator.update(input, simTime, dtMs, motionX);
    this.rig.solve(pose, this.animator.dtSec, motionX, motionY, this.animator.glowLeft, this.animator.glowRight);
  }

  resetMotion(): void {
    this.animator.reset();
    this.rig.reset(this.animator.pose);
  }

  /** Hit role while visible, -1 (drawn bounds only) while teleported away. */
  private role(r: number): number {
    return this.hidden ? -1 : r;
  }

  private add(x: number, y: number, r: number, hit: number): void {
    this.g!.add(x, y, r, hit);
  }

  measure(g: GeometryCollector): void {
    this.g = g;
    const rig = this.rig;
    const pose = this.animator.pose;
    const sc = rig.scale;
    // Teleported away (vanish/appear): the space stays reported for the dirty rect, but only a token spot is clickable.
    const invisible = pose.alpha < this.invisibleBelow;
    this.hidden = invisible;
    for (let i = 0; i < HEAD_POINTS; i++) this.add(rig.head[i * 2]!, rig.head[i * 2 + 1]!, 1.2, this.role(0));
    for (let i = 0; i < TORSO_POINTS; i++) this.add(rig.torso[i * 2]!, rig.torso[i * 2 + 1]!, 1.2, this.role(1));
    if (invisible) this.add(rig.hcx, rig.hcy, 4, 0);
    for (let s = 0; s < 2; s++) {
      const a = rig.arm[s]!;
      this.add(a[0]!, a[1]!, ARM_W * 0.5 * sc + 1.7, this.role(2 + s));
      this.add(a[2]!, a[3]!, ARM_W * 0.5 * sc + 1.7, this.role(2 + s));
      this.add(a[4]!, a[5]!, HAND_R * sc + 1.7, this.role(2 + s));
      const l = rig.leg[s]!;
      this.add(l[0]!, l[1]!, LEG_W * 0.5 * sc + 1.7, this.role(4 + s));
      this.add(l[2]!, l[3]!, LEG_W * 0.5 * sc + 1.7, this.role(4 + s));
      this.add(l[4]! + 1.2, l[5]! + 0.6, 3.6 * sc + 1.7, this.role(4 + s));
      const an = rig.antenna[s]!;
      this.add(an.bx, an.by, 1.8, this.role(6 + s));
      this.add(an.cx, an.cy, 1.8, this.role(6 + s));
      this.add(an.tx, an.ty, BULB_R + 0.8, this.role(6 + s));
      // The tip's halo and highlights: drawn bounds only.
      this.add(an.tx, an.ty, BULB_R + 6.5, -1);
    }
    // Face features can poke past the head outline at the extremes of a turn: drawn bounds only.
    this.add(rig.hcx, rig.hcy, HEAD_RX + 1.5, -1);
    // Pendant (when worn) hangs below the collar.
    this.add(rig.collarAx + rig.hangX * 16, rig.collarAy + rig.hangY * 16, 8, -1);
    this.add(rig.collarBx + rig.hangX * 16, rig.collarBy + rig.hangY * 16, 8, -1);
    // Effects.
    if (pose.scan >= 0) {
      const cx = rig.hcx + SCAN_FRONT;
      for (let i = 0; i < 4; i++) this.add(cx + (i & 1 ? SCAN_LEN / 2 : -SCAN_LEN / 2), i & 2 ? SCAN_TOP - 2 : SCAN_BOTTOM + 9, 2, -1);
    }
    if (pose.beam >= 0) {
      const a = rig.antenna[0]!;
      const b = rig.antenna[1]!;
      const mx = (a.tx + b.tx) / 2;
      const my = (a.ty + b.ty) / 2;
      for (let i = 0; i < 4; i++) this.add(mx + (i & 1 ? 27 : -27), i & 2 ? my + 2 : my - 41, 2, -1);
      this.add(a.tx, a.ty, 10, -1);
      this.add(b.tx, b.ty, 10, -1);
    }
    if (pose.shim > 0.002) {
      for (let i = 0; i < 4; i++) this.add(rig.hcx + (i & 1 ? 21 : -21), i & 2 ? -120 : 4, 2, -1);
    }
    const k = rig.shadowK;
    g.addGround(rig.shadowX, 20 * k + 4, 4 * k + 1.5);
    this.g = null;
  }

  trackedPoints(out: Float64Array): void {
    const rig = this.rig;
    const tip = rig.antenna[1]!;
    const hand = rig.arm[1]!;
    out[0] = tip.tx;
    out[1] = tip.ty;
    out[2] = rig.hcx + rig.exx * HEAD_RX;
    out[3] = rig.hcy + rig.exy * HEAD_RX;
    out[4] = hand[4]!;
    out[5] = hand[5]!;
  }

  emoteAnchor(out: EmoteAnchor): void {
    out.x = this.rig.hcx;
    out.y = this.rig.hcy;
    out.lift = 40;
    out.side = 5;
  }

  draw(ctx: Ctx2D, o: DrawParams): void {
    this.pal = getPalette(o.skin);
    const ppu = Number.isFinite(o.pixelsPerUnit) && o.pixelsPerUnit > 0 ? o.pixelsPerUnit : 1;
    const outline = Number.isFinite(o.outline) ? Math.min(8, Math.max(0.3, o.outline)) : 1.6;
    this.pixel = ppu < 0.6;
    this.invisibleBelow = invisibleBelow(ppu);
    const st = this.st;
    st.clock = this.animator.clock;
    st.calm = this.animator.calm;
    st.glowL = this.animator.glowLeft;
    st.glowR = this.animator.glowRight;
    drawAlien(ctx, this.rig, st, this.pal, { outline, shadow: o.shadow, pixelsPerUnit: ppu, accessory: o.accessory });
  }

  drawShadow(ctx: Ctx2D): void {
    drawAlienShadow(ctx, this.rig, this.pal, this.pixel);
  }
}

type AnimatorPose = AlienAnimator['pose'];

export function createAlienRenderer(random: () => number): CharacterRenderer {
  return new AlienRenderer(random);
}
