// Fox renderer: a genuinely different animal from the cat. A long, low, sleek quadruped with a long
// snout, tall pointed ears, long socked legs and a brush as big as its body, its own rig, clips, tail
// physics and painter. Implements the CharacterRenderer seam (pose, geometry, hit roles, drawing).
import { applyMatX, applyMatY, clamp01 } from '../../character/kit';
import type { AnimInput, CharacterRenderer, DrawParams, EmoteAnchor, GeometryCollector } from '../../character/types';
import { FoxAnimator } from './animator';
import { drawFox, drawFoxShadow, dustExtent, EAR_FAR_SRC, EAR_NEAR_SRC, earGeom, HEAD_POINTS, HEAD_SHAPE, headPoint, HP, JAW_SHAPE, shadowExtent } from './draw';
import { LEG_COUNT, LEG_FF, LEG_FN } from './pose';
import { LEG_SPECS, PAW_RX, Rig, TORSO_POINTS } from './rig';
import { getFoxSkin } from './skins';
import { FoxTail } from './tail';

/**
 * Hit roles (indices into the scene's hit rects): head with ears 0, body and neck 1, front legs 2,
 * tail base 3, hind legs and haunch 4, front paws 5, hind paws 6, tail tip 7.
 */
export class FoxRenderer implements CharacterRenderer {
  readonly id = 'fox' as const;
  readonly animator: FoxAnimator;
  readonly rig = new Rig();
  readonly tail = new FoxTail();
  private readonly earPts = new Float64Array(6);
  private readonly shadow = { cx: 0, half: 0, rh: 0 };
  private readonly dust = { cx: 0, half: 0, h: 0 };
  private g: GeometryCollector | null = null;

  constructor(random: () => number) {
    this.animator = new FoxAnimator(random);
  }

  get pose() {
    return this.animator.pose;
  }
  get blending(): boolean {
    return this.animator.blending;
  }
  get reacting(): boolean {
    return this.animator.reacting;
  }

  advance(input: AnimInput, simTime: number, dtMs: number, motionX: number, motionY: number): void {
    const p = this.animator.update(input, simTime, dtMs, motionX);
    const rig = this.rig;
    rig.solve(p);
    // Ground line in the pose's own frame (where the view's y = 0 is), or none when the body is rolled, turned or hanging.
    const m = rig.m;
    let ground = Number.NaN;
    if (p.shadow > 0.4 && Math.abs(m[1]!) < 0.2 && m[3]! > 0.5) ground = -m[5]! / m[3]!;
    const mx = Number.isFinite(motionX) ? motionX : 0;
    const my = Number.isFinite(motionY) ? motionY : 0;
    this.tail.step(rig.tailRootX, rig.tailRootY, p, dtMs, mx, my, ground, input.reducedMotion === true ? 1 : 0);
  }

  resetMotion(): void {
    this.tail.reset();
    this.animator.resetMotion();
  }

  private acc(px: number, py: number, r: number, hit: number): void {
    const m = this.rig.m;
    this.g!.add(applyMatX(m, px, py), applyMatY(m, px, py), r, hit);
  }

  private accHead(lx: number, ly: number, r: number, hit: number): void {
    headPoint(this.rig, lx, ly);
    this.acc(HP.x, HP.y, r, hit);
  }

  measure(g: GeometryCollector): void {
    this.g = g;
    const rig = this.rig;
    const p = this.animator.pose;
    const tail = this.tail;
    const m = rig.m;

    for (let i = 0; i < TORSO_POINTS; i++) this.acc(rig.torso[i * 2]!, rig.torso[i * 2 + 1]!, 1.2, 1);
    this.acc(rig.nx0, rig.ny0, rig.neckW * 0.5 + 0.5, 1);
    this.acc(rig.nx1, rig.ny1, rig.neckW * 0.5 + 0.5, 1);
    this.acc(rig.hx, rig.hy, 0, 1);
    this.acc(rig.hx - rig.hrx, rig.hy, 0.6, 1);
    this.acc(rig.hx + rig.hrx, rig.hy, 0.6, 1);
    this.acc(rig.hx, rig.hy + rig.hry, 0.6, 4);
    this.acc(rig.hx, rig.hy - rig.hry, 0.6, 1);

    // Head: the face outline, the open jaw and both ears as drawn.
    for (let i = 0; i < HEAD_POINTS; i++) this.accHead(HEAD_SHAPE[i * 2]!, HEAD_SHAPE[i * 2 + 1]!, 1.4, 0);
    const open = clamp01(p.mouthOpen);
    if (open > 0.04) {
      const ja = open * 0.62;
      const jc = Math.cos(ja);
      const js = Math.sin(ja);
      for (let i = 0; i < JAW_SHAPE.length / 2; i++) {
        const x = JAW_SHAPE[i * 2]! - 8.5;
        const y = JAW_SHAPE[i * 2 + 1]! - 4.6;
        this.accHead(8.5 + x * jc - y * js, 4.6 + x * js + y * jc, 1.2, 0);
      }
    }
    const ears = this.earPts;
    for (let e = 0; e < 2; e++) {
      earGeom(e === 0 ? EAR_FAR_SRC : EAR_NEAR_SRC, e === 0 ? p.earFR : p.earNR, e === 0 ? p.earFF : p.earNF, ears);
      for (let i = 0; i < 3; i++) this.accHead(ears[i * 2]!, ears[i * 2 + 1]!, 1.2, 0);
    }

    for (let i = 0; i < LEG_COUNT; i++) {
      const l = rig.legs[i]!;
      const spec = LEG_SPECS[i]!;
      const front = i === LEG_FN || i === LEG_FF;
      const role = front ? 2 : 4;
      this.acc(l.rx, l.ry, spec.w1 * 0.5, role);
      this.acc(l.kx, l.ky, spec.w1 * 0.5 + 0.8, role);
      this.acc(l.fx, l.fy, 1, role);
      this.acc(l.fx + 1.2, l.fy - 1.6, PAW_RX + 1, front ? 5 : 6);
    }
    const n = tail.count;
    for (let i = 0; i < n; i++) this.acc(tail.x[i]!, tail.y[i]!, tail.radius(i) + 1.2, i <= (n >> 1) ? 3 : 7);

    // The pendant, when worn, hangs from the neck towards the world's down: room for it (bounds only).
    const det = m[0]! * m[3]! - m[1]! * m[2]!;
    let hx = 0;
    let hy = 1;
    if (Math.abs(det) > 1e-4) {
      hx = -m[2]! / det;
      hy = m[0]! / det;
    }
    const nmx = (rig.nx0 + rig.nx1) / 2;
    const nmy = (rig.ny0 + rig.ny1) / 2;
    this.acc(nmx + hx * 12, nmy + hy * 12, 9, -1);

    const sh = this.shadow;
    shadowExtent(rig, p, sh);
    g.addGround(sh.cx, sh.half, sh.rh);
    // The dust puff of a vanish / appear: room for it in the bounds (never a hit region).
    if (p.dust > 0.01) {
      const d = this.dust;
      dustExtent(rig, p, d);
      g.add(d.cx - d.half, -6, 10, -1);
      g.add(d.cx + d.half, -6, 10, -1);
      g.add(d.cx, -10, 16, -1);
    }
    this.g = null;
  }

  trackedPoints(out: Float64Array): void {
    // Brush tip, the nose and the near front paw, after the pose matrix.
    const rig = this.rig;
    const m = rig.m;
    const tail = this.tail;
    const tip = tail.count - 1;
    headPoint(rig, 22, 1);
    const nx = HP.x;
    const ny = HP.y;
    const paw = rig.legs[LEG_FN]!;
    for (let i = 0; i < 3; i++) {
      const lx = i === 0 ? tail.x[tip]! : i === 1 ? nx : paw.fx;
      const ly = i === 0 ? tail.y[tip]! : i === 1 ? ny : paw.fy;
      out[i * 2] = applyMatX(m, lx, ly);
      out[i * 2 + 1] = applyMatY(m, lx, ly);
    }
  }

  emoteAnchor(out: EmoteAnchor): void {
    const rig = this.rig;
    out.x = applyMatX(rig.m, rig.headX, rig.headY);
    out.y = applyMatY(rig.m, rig.headX, rig.headY);
    out.lift = 34;
    out.side = 4;
  }

  draw(ctx: DrawCtx, o: DrawParams): void {
    drawFox(ctx, this.rig, this.animator.pose, this.tail, getFoxSkin(o.skin), o);
  }

  drawShadow(ctx: DrawCtx): void {
    drawFoxShadow(ctx, this.rig, this.animator.pose);
  }
}

type DrawCtx = Parameters<CharacterRenderer['draw']>[0];

export function createFoxRenderer(random: () => number): CharacterRenderer {
  return new FoxRenderer(random);
}
