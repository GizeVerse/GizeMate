// The cat as a CharacterRenderer: CatPuppet/Rig/drawCat/drawShadow/accessory wrapped unchanged. The
// cat anatomy that used to live in scene.ts (geometry, tracked points, emote anchor, hit roles) is here.
import type { AnimInput } from '../cat/animator';
import { drawCat, drawShadow, earCorners, type Ctx2D } from '../cat/draw';
import { clamp } from '../cat/math';
import { LEG_COUNT, LEG_FF, LEG_FN } from '../cat/pose';
import { CatPuppet } from '../cat/puppet';
import { applyMatX, applyMatY, HEAD_RX, HEAD_RY, PAW_RX, TORSO_POINTS } from '../cat/rig';
import { getSkin } from '../cat/skins';
import type { CharacterRenderer, DrawParams, EmoteAnchor, GeometryCollector } from './types';

/** Points on the head oval of the head's hit rect, and the slack covering the polygon's chords. */
const HEAD_HIT_STEPS = 12;
const HEAD_HIT_SLACK = 0.7;

/**
 * Hit roles (indices into the scene's hit rects): head 0, body 1, front legs 2, tail base 3,
 * hind legs 4, front paws 5, hind paws 6.
 */
export class CatRenderer implements CharacterRenderer {
  readonly id = 'cat' as const;
  readonly puppet: CatPuppet;
  private readonly earPts = new Float64Array(6);
  /** The collector of the measure() call in progress (a field, so the pass allocates no closure). */
  private g: GeometryCollector | null = null;

  constructor(random: () => number) {
    this.puppet = new CatPuppet(random);
  }

  get blending(): boolean {
    return this.puppet.animator.blending;
  }

  get reacting(): boolean {
    return this.puppet.animator.reacting;
  }

  advance(input: AnimInput, simTime: number, dtMs: number, motionX: number, motionY: number): void {
    this.puppet.advance(input, simTime, dtMs, motionX, motionY);
  }

  resetMotion(): void {
    this.puppet.resetTail();
  }

  /** Adds a posed cat-local point with radius r to the collector. */
  private acc(px: number, py: number, r: number, hit: number): void {
    const m = this.puppet.rig.m;
    this.g!.add(applyMatX(m, px, py), applyMatY(m, px, py), r, hit);
  }

  measure(g: GeometryCollector): void {
    this.g = g;
    const puppet = this.puppet;
    const rig = puppet.rig;
    const tail = puppet.tail;
    const m = rig.m;

    for (let i = 0; i < TORSO_POINTS; i++) this.acc(rig.torso[i * 2]!, rig.torso[i * 2 + 1]!, 0.5, 1);
    this.acc(rig.hx - rig.hrx, rig.hy, 0, 1);
    this.acc(rig.hx + rig.hrx, rig.hy, 0, 1);
    this.acc(rig.hx, rig.hy + rig.hry, 0, 1);
    // Head including ears, drawn bounds: corners of a rotated box.
    const hc = Math.cos(rig.headRot);
    const hs = Math.sin(rig.headRot);
    const hf = rig.headFlip < 0 ? -1 : 1;
    for (let i = 0; i < 4; i++) {
      const lx = i & 1 ? HEAD_RX + 1 : -HEAD_RX - 1;
      const ly = (i & 2 ? HEAD_RY + 1 : -HEAD_RY - 9) * hf;
      this.acc(rig.headX + lx * hc + ly * hs, rig.headY - lx * hs + ly * hc, 0, -1);
    }
    // Head hit region (v1.2): the head oval and the two ears as drawn. The box above swings its
    // empty ear-room corners ahead of the face when the head tips down, which put a pouncing or
    // striking cat's region ~7 DIP closer to the cursor than anything painted (HIT_FRONT_EXTENT_DIP).
    for (let i = 0; i < HEAD_HIT_STEPS; i++) {
      const a = (i * 2 * Math.PI) / HEAD_HIT_STEPS;
      const lx = (HEAD_RX + 1) * Math.cos(a);
      const ly = (HEAD_RY + 1) * Math.sin(a) * hf;
      this.acc(rig.headX + lx * hc + ly * hs, rig.headY - lx * hs + ly * hc, HEAD_HIT_SLACK, 0);
    }
    const pose = puppet.pose;
    const ears = this.earPts;
    for (let e = 0; e < 2; e++) {
      earCorners(pose, e === 0 ? 0 : 1, ears);
      for (let i = 0; i < 3; i++) {
        const lx = ears[i * 2]!;
        const ly = ears[i * 2 + 1]! * hf;
        this.acc(rig.headX + lx * hc + ly * hs, rig.headY - lx * hs + ly * hc, 0.5, 0);
      }
    }
    // Room around the ear tips and the whiskers: drawn bounds only, not interactive. Whiskers (drawCat's
    // drawWhiskers) fan out from the face, which shifts with the face turn, and tilt
    // with pose.whisker by up to ~0.6 rad.
    for (let i = 0; i < 2; i++) {
      const lx = i ? 10 : -14;
      const ly = -25 * hf;
      this.acc(rig.headX + lx * hc + ly * hs, rig.headY - lx * hs + ly * hc, 1, -1);
    }
    const turn = clamp(pose.faceTurn, -2, 1);
    const fx = 3.6 + turn * 4.2;
    const back = 1 - 0.4 * clamp(turn + 1, 0, 1);
    for (let i = 0; i < 4; i++) {
      const lx = i & 1 ? fx + 22 : fx - 9 - 11.5 * back;
      const ly = (i & 2 ? 18.7 : -5.3) * hf;
      this.acc(rig.headX + lx * hc + ly * hs, rig.headY - lx * hs + ly * hc, 0.5, -1);
    }
    // Legs per pair (front, hind): knees and legs down to the paw centres, and the paws in a rect of
    // their own. One box over all four legs would span the gap between the pairs at the full width of
    // a knee or paw: on a wall the paws grip the wall line, so it reached into the window the cat
    // clings to over a band where nothing is drawn.
    for (let i = 0; i < LEG_COUNT; i++) {
      const l = rig.legs[i]!;
      const front = i === LEG_FN || i === LEG_FF;
      this.acc(l.kx, l.ky, 4.5, front ? 2 : 4);
      this.acc(l.fx, l.fy, 0, front ? 2 : 4);
      this.acc(l.fx, l.fy, PAW_RX, front ? 5 : 6);
    }
    const n = tail.count;
    for (let i = 0; i < n; i++) this.acc(tail.x[i]!, tail.y[i]!, tail.radius(i) + 1, i <= n * 0.5 ? 3 : -1);
    // Shadow: same extent as drawShadow (upper bound: no airborne shrink).
    const k = clamp(pose.shadow, 0, 1.5);
    g.addGround(m[0]! * rig.bodyX + m[4]!, 27 * k * Math.abs(m[0]!) + 4, 4.2 * k + 0.8);
    this.g = null;
  }

  trackedPoints(out: Float64Array): void {
    // Tail tip, a point at the front of the head (so head turns and tilts count, not just its centre)
    // and the near front paw; after the pose matrix.
    const rig = this.puppet.rig;
    const m = rig.m;
    const tail = this.puppet.tail;
    const tip = tail.count - 1;
    const paw = rig.legs[LEG_FN]!;
    const hx = rig.headX + HEAD_RX * Math.cos(rig.headRot);
    const hy = rig.headY - HEAD_RX * Math.sin(rig.headRot);
    for (let i = 0; i < 3; i++) {
      const lx = i === 0 ? tail.x[tip]! : i === 1 ? hx : paw.fx;
      const ly = i === 0 ? tail.y[tip]! : i === 1 ? hy : paw.fy;
      out[i * 2] = applyMatX(m, lx, ly);
      out[i * 2 + 1] = applyMatY(m, lx, ly);
    }
  }

  emoteAnchor(out: EmoteAnchor): void {
    const rig = this.puppet.rig;
    out.x = applyMatX(rig.m, rig.headX, rig.headY);
    out.y = applyMatY(rig.m, rig.headX, rig.headY);
    out.lift = HEAD_RY + 17;
    out.side = 5;
  }

  draw(ctx: Ctx2D, o: DrawParams): void {
    drawCat(ctx, this.puppet, getSkin(o.skin), { outline: o.outline, shadow: o.shadow, pixelsPerUnit: o.pixelsPerUnit, accessory: o.accessory });
  }

  drawShadow(ctx: Ctx2D): void {
    drawShadow(ctx, this.puppet.rig, this.puppet.pose);
  }
}

export function createCatRenderer(random: () => number): CatRenderer {
  return new CatRenderer(random);
}
