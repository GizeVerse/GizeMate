// Rabbit: the CharacterRenderer. A plush loaf of a rabbit with big expressive ears, a twitching nose
// and big hind feet; hops instead of walking. Pose, drawing and geometry are all its own (the scene
// only supplies the view transform).
import type { AnimInput, CharacterRenderer, DrawParams, EmoteAnchor, GeometryCollector } from '../../character/types';
import { clamp, finiteOr } from '../../character/kit';
import { RabbitAnimator } from './animator';
import { drawRabbit, drawRabbitShadow, shadowHalfWidth } from './draw';
import { getPalette } from './palettes';
import { applyX, applyY, EAR_POLY, FOOT_RX, FOOT_RY, HEAD_N, PAW_RX, RabbitRig } from './rig';

/**
 * Hit roles (stable indices): head 0, body 1, ears 2, forelegs 3, haunch and thighs 4, hind feet 5,
 * tail 6.
 */
const HIT_HEAD = 0;
const HIT_BODY = 1;
const HIT_EARS = 2;
const HIT_FORE = 3;
const HIT_HAUNCH = 4;
const HIT_FEET = 5;
const HIT_TAIL = 6;
const PAD = 1.2;
const ELLIPSE_STEPS = 12;

export class RabbitRenderer implements CharacterRenderer {
  readonly id = 'rabbit' as const;
  readonly anim: RabbitAnimator;
  readonly rig = new RabbitRig();
  /** The collector of the measure() call in progress (a field, so the pass allocates no closure). */
  private g: GeometryCollector | null = null;
  private sc = 1;

  constructor(random: () => number) {
    this.anim = new RabbitAnimator(random);
    this.rig.solve(this.anim.pose);
  }

  get blending(): boolean {
    return this.anim.blending;
  }

  get reacting(): boolean {
    return this.anim.reacting;
  }

  advance(input: AnimInput, simTime: number, dtMs: number, motionX: number, _motionY: number): void {
    this.anim.update(input, finiteOr(simTime, 0), dtMs, motionX);
    this.rig.solve(this.anim.pose);
  }

  resetMotion(): void {
    this.anim.reset();
  }

  private acc(x: number, y: number, r: number, hit: number): void {
    const m = this.rig.m;
    this.g!.add(applyX(m, x, y), applyY(m, x, y), r * this.sc + PAD * 0.5, hit);
  }

  private accEllipse(cx: number, cy: number, rx: number, ry: number, rot: number, hit: number): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const slack = 0.05 * Math.max(rx, ry) + PAD;
    for (let i = 0; i < ELLIPSE_STEPS; i++) {
      const a = (i * Math.PI * 2) / ELLIPSE_STEPS;
      const ex = rx * Math.cos(a);
      const ey = ry * Math.sin(a);
      this.acc(cx + ex * c - ey * s, cy + ex * s + ey * c, slack, hit);
    }
  }

  measure(g: GeometryCollector): void {
    this.g = g;
    const rig = this.rig;
    const m = rig.m;
    this.sc = Math.max(Math.hypot(m[0]!, m[1]!), Math.hypot(m[2]!, m[3]!), 1);
    const p = this.anim.pose;

    // Body, haunch and the thighs that join the hind feet to the haunch.
    this.accEllipse(rig.bx, rig.by, rig.brx, rig.bry, rig.bAng, HIT_BODY);
    this.acc(rig.nx0, rig.ny0, 8.5, HIT_BODY);
    this.acc(rig.nx1, rig.ny1, 8.5, HIT_BODY);
    this.accEllipse(rig.hx, rig.hy, rig.hrx, rig.hry, 0, HIT_HAUNCH);
    const tw = rig.hry * 0.45;
    for (let f = 0; f < 2; f++) {
      const fx = f === 0 ? rig.hnX : rig.hfX;
      const fy = f === 0 ? rig.hnY : rig.hfY;
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        this.acc(rig.hx + (fx - rig.hx) * t, rig.hy + (fy - rig.hy) * t, tw, HIT_HAUNCH);
      }
    }
    this.accEllipse(rig.hnX, rig.hnY, FOOT_RX, FOOT_RY, rig.hnA, HIT_FEET);
    this.accEllipse(rig.hfX, rig.hfY, FOOT_RX, FOOT_RY, rig.hfA, HIT_FEET);

    // Head and face.
    for (let i = 0; i < HEAD_N; i++) this.acc(rig.headPts[i * 2]!, rig.headPts[i * 2 + 1]!, 1, HIT_HEAD);
    this.acc(rig.noseX, rig.noseY, 2.6, HIT_HEAD);
    // Whiskers reach out from the muzzle (bounds only).
    this.acc(rig.hX(26, -5), rig.hY(26, -5), 1, -1);
    this.acc(rig.hX(26, 13), rig.hY(26, 13), 1, -1);
    this.acc(rig.hX(20, -7), rig.hY(20, -7), 1, -1);

    // Ears.
    for (let i = 0; i < EAR_POLY / 2; i++) {
      this.acc(rig.earN[i * 2]!, rig.earN[i * 2 + 1]!, 1, HIT_EARS);
      this.acc(rig.earF[i * 2]!, rig.earF[i * 2 + 1]!, 1, HIT_EARS);
    }

    // Forelegs: elbows, paws.
    for (let f = 0; f < 2; f++) {
      const l = f === 0 ? rig.fn : rig.ff;
      this.acc(l.rx, l.ry, 3.5, HIT_FORE);
      this.acc(l.kx, l.ky, 4.2, HIT_FORE);
      this.acc(l.fx, l.fy, PAW_RX, HIT_FORE);
    }

    // Tail.
    this.accEllipse(rig.tailX, rig.tailY, rig.tailR, rig.tailR, 0, HIT_TAIL);

    // Shadow: the same extent drawRabbitShadow paints (upper bound: no airborne shrink).
    const k = clamp(p.shadow, 0, 1.5);
    const cx = m[0]! * rig.bx + m[2]! * rig.by + m[4]!;
    g.addGround(cx, shadowHalfWidth(rig, k, 0) * Math.abs(m[0]!) + 2, 4.2 * k + 0.8 + 1);
    this.g = null;
  }

  trackedPoints(out: Float64Array): void {
    const rig = this.rig;
    const m = rig.m;
    for (let i = 0; i < 3; i++) {
      const lx = i === 0 ? rig.tailX : i === 1 ? rig.earNTipX : rig.fn.fx;
      const ly = i === 0 ? rig.tailY : i === 1 ? rig.earNTipY : rig.fn.fy;
      out[i * 2] = applyX(m, lx, ly);
      out[i * 2 + 1] = applyY(m, lx, ly);
    }
  }

  emoteAnchor(out: EmoteAnchor): void {
    const rig = this.rig;
    const m = rig.m;
    // The top-most expressive point: an ear tip when the ears stand, the head when they droop.
    let tx = rig.headX;
    let ty = rig.headY - 10;
    if (rig.earNTipY < ty) {
      tx = rig.earNTipX;
      ty = rig.earNTipY;
    }
    if (rig.earFTipY < ty) {
      tx = rig.earFTipX;
      ty = rig.earFTipY;
    }
    out.x = applyX(m, tx, ty);
    out.y = applyY(m, tx, ty);
    out.lift = 13;
    out.side = 5;
  }

  draw(ctx: Parameters<CharacterRenderer['draw']>[0], o: DrawParams): void {
    drawRabbit(ctx, this.anim, this.rig, getPalette(o.skin), o);
  }

  drawShadow(ctx: Parameters<CharacterRenderer['draw']>[0]): void {
    drawRabbitShadow(ctx, this.rig, this.anim.pose);
  }
}

export function createRabbitRenderer(random: () => number): CharacterRenderer {
  return new RabbitRenderer(random);
}
