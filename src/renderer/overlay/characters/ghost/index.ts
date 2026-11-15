// Ghost renderer: a procedural translucent sheet ghost (no legs: it floats). Animator -> pose -> rig
// -> painter, the same architecture as the cat, with its own anatomy, clips and secondary motion.
import type { AnimInput } from '../../cat/animator';
import type { CharacterRenderer, DrawParams, EmoteAnchor, GeometryCollector } from '../../character/types';
import type { Ctx2D } from '../../character/kit';
import { GhostAnimator } from './animator';
import { drawGhost, drawGhostShadow, sparkleAt, SPARKLE_COUNT, type SparkleSpot } from './draw';
import type { GhostPose } from './pose';
import { BODY_N, GhostRig } from './rig';

/** Hit roles: upper sheet 0, lower sheet and hem 1, left arm 2, right arm 3. */
const HIT_UPPER = 0;
const HIT_LOWER = 1;
const HIT_ARM_L = 2;
const HIT_ARM_R = 3;
/** Below this reveal the ghost is invisible: it keeps one tiny hit point so it never vanishes from the hit region. */
const INVISIBLE = 0.08;

export class GhostRenderer implements CharacterRenderer {
  readonly id = 'ghost' as const;
  private readonly animator: GhostAnimator;
  private readonly rig = new GhostRig();
  private pose: GhostPose;
  private readonly spot: SparkleSpot = { x: 0, y: 0, s: 0, a: 0 };

  constructor(random: () => number) {
    this.animator = new GhostAnimator(random);
    this.pose = this.animator.pose;
    this.rig.solve(this.pose, 0);
  }

  get blending(): boolean {
    return this.animator.blending;
  }

  get reacting(): boolean {
    return this.animator.reacting;
  }

  advance(input: AnimInput, simTime: number, dtMs: number, motionX: number, motionY: number): void {
    this.pose = this.animator.update(input, simTime, dtMs, motionX, motionY);
    this.rig.solve(this.pose, this.animator.hemPhase);
  }

  resetMotion(): void {
    this.animator.resetMotion();
  }

  measure(g: GeometryCollector): void {
    const rig = this.rig;
    const p = this.pose;
    const pts = rig.pts;
    const visible = p.vis * p.alpha >= INVISIBLE;
    const glowR = p.glow > 0.02 ? 4.5 : 0;
    for (let i = 0; i < BODY_N; i++) {
      const x = pts[i * 2]!;
      const y = pts[i * 2 + 1]!;
      const upper = i <= 4 || i >= 12;
      g.add(x, y, 1.4, visible ? (upper ? HIT_UPPER : HIT_LOWER) : -1);
      if (visible && upper && i >= 3 && i <= 13) g.add(x, y, 1.4, HIT_LOWER);
      if (glowR > 0) g.add(x, y, glowR, -1);
    }
    if (!visible) {
      const cx = (rig.topX + rig.hemX) / 2;
      const cy = (rig.topY + rig.hemY) / 2;
      g.add(cx, cy, 4, HIT_UPPER);
    }
    const ar = rig.armW / 2 + 0.6;
    g.add(rig.shLx, rig.shLy, ar, visible ? HIT_ARM_L : -1);
    g.add(rig.enLx, rig.enLy, ar, visible ? HIT_ARM_L : -1);
    g.add(rig.shRx, rig.shRy, ar, visible ? HIT_ARM_R : -1);
    g.add(rig.enRx, rig.enRy, ar, visible ? HIT_ARM_R : -1);
    if (p.sparkle > 0.02) {
      for (let i = 0; i < SPARKLE_COUNT; i++) {
        sparkleAt(rig, i, this.animator.sparklePhase, this.spot);
        g.add(this.spot.x, this.spot.y, 7, -1);
      }
    }
    g.addGround(rig.shadowX, rig.shadowHalf, rig.shadowRh);
  }

  trackedPoints(out: Float64Array): void {
    const rig = this.rig;
    out[0] = rig.topX;
    out[1] = rig.topY;
    out[2] = rig.pts[6 * 2]!;
    out[3] = rig.pts[6 * 2 + 1]!;
    out[4] = rig.enRx;
    out[5] = rig.enRy;
  }

  emoteAnchor(out: EmoteAnchor): void {
    out.x = this.rig.topX;
    out.y = this.rig.topY;
    out.lift = 15;
    out.side = 5;
  }

  draw(ctx: Ctx2D, o: DrawParams): void {
    drawGhost(ctx, this.rig, this.pose, o, this.animator.sparklePhase);
  }

  drawShadow(ctx: Ctx2D): void {
    drawGhostShadow(ctx, this.rig);
  }
}

export function createGhostRenderer(random: () => number): CharacterRenderer {
  return new GhostRenderer(random);
}
