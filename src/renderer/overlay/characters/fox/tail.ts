// The fox's brush: a chain of points pulled towards the pose's target shape (base angle plus curl) with a
// per-point spring offset, so the big tail lags behind body motion, overshoots a little and stays stable
// for any frame time. Allocation-free; resets on long gaps or non-finite state.
import { clamp, lerp } from '../../character/kit';
import type { Pose } from './pose';

export const TAIL_POINTS = 9;
export const TAIL_SEG_LEN = 5.3;
/** Half-width of the brush at each point (bushy in the middle, pointed at the tip). */
export const TAIL_RADIUS: readonly number[] = [3.2, 4.9, 6.4, 7.4, 7.6, 7.0, 5.7, 3.9, 1.5];
/** The first point of the white tip. */
export const TAIL_TIP_FROM = 6;

const STEP_S = 1 / 120;
const MAX_STEPS = 30;
const RESET_GAP_MS = 250;
const MAX_SHIFT = 40;

export class FoxTail {
  readonly x = new Float64Array(TAIL_POINTS);
  readonly y = new Float64Array(TAIL_POINTS);
  private readonly tx = new Float64Array(TAIL_POINTS);
  private readonly ty = new Float64Array(TAIL_POINTS);
  private readonly ox = new Float64Array(TAIL_POINTS);
  private readonly oy = new Float64Array(TAIL_POINTS);
  private readonly vx = new Float64Array(TAIL_POINTS);
  private readonly vy = new Float64Array(TAIL_POINTS);
  private ready = false;
  puff = 1;
  front = false;
  /** Drawn over the head (a sleeping fox's brush across its nose). */
  over = false;

  get count(): number {
    return TAIL_POINTS;
  }

  radius(i: number): number {
    return TAIL_RADIUS[i]! * this.puff;
  }

  reset(): void {
    this.ready = false;
  }

  private computeTarget(rootX: number, rootY: number, base: number, curl: number, bend: number): void {
    this.tx[0] = rootX;
    this.ty[0] = rootY;
    const expo = lerp(2, 0.55, clamp(bend, 0, 1));
    for (let i = 1; i < TAIL_POINTS; i++) {
      const s = (i - 0.5) / (TAIL_POINTS - 1);
      const a = base + curl * Math.pow(s, expo);
      this.tx[i] = this.tx[i - 1]! - Math.cos(a) * TAIL_SEG_LEN;
      this.ty[i] = this.ty[i - 1]! - Math.sin(a) * TAIL_SEG_LEN;
    }
  }

  private place(rootX: number, rootY: number, groundY: number): void {
    this.x[0] = rootX;
    this.y[0] = rootY;
    for (let i = 1; i < TAIL_POINTS; i++) {
      let px = this.tx[i]! + this.ox[i]!;
      let py = this.ty[i]! + this.oy[i]!;
      let dx = px - this.x[i - 1]!;
      let dy = py - this.y[i - 1]!;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        dx = (dx / d) * TAIL_SEG_LEN;
        dy = (dy / d) * TAIL_SEG_LEN;
      } else {
        dx = -TAIL_SEG_LEN;
        dy = 0;
      }
      px = this.x[i - 1]! + dx;
      py = this.y[i - 1]! + dy;
      if (Number.isFinite(groundY)) {
        const lim = groundY - this.radius(i) * 0.55;
        if (py > lim) py = lim;
      }
      this.x[i] = px;
      this.y[i] = py;
    }
  }

  /**
   * @param shiftX,shiftY body motion this frame (character-local); the tail lags behind it.
   * @param groundY clamp the points above this local y, or NaN for none.
   * @param calm 0..1 reduced motion: the spring is stiffer and the lag smaller.
   */
  step(rootX: number, rootY: number, p: Pose, dtMs: number, shiftX: number, shiftY: number, groundY: number, calm: number): void {
    this.computeTarget(rootX, rootY, p.tailBase, p.tailCurl, p.tailBend);
    this.puff = 1 + 0.4 * clamp(p.tailPuff, 0, 1);
    this.front = p.tailFront > 0.5 && p.tailFront <= 1.5;
    this.over = p.tailFront > 1.5;
    const valid = Number.isFinite(dtMs) && dtMs > 0;
    if (!this.ready || (valid && dtMs > RESET_GAP_MS) || !Number.isFinite(rootX) || !Number.isFinite(rootY)) {
      this.ox.fill(0);
      this.oy.fill(0);
      this.vx.fill(0);
      this.vy.fill(0);
      this.ready = true;
      this.place(rootX, rootY, groundY);
      return;
    }
    if (!valid) {
      this.place(rootX, rootY, groundY);
      return;
    }
    const lag = 0.8 * (1 - 0.6 * clamp(calm, 0, 1));
    const sx = Number.isFinite(shiftX) && Math.abs(shiftX) + Math.abs(shiftY) < MAX_SHIFT ? shiftX : 0;
    const sy = Number.isFinite(shiftY) && Math.abs(shiftX) + Math.abs(shiftY) < MAX_SHIFT ? shiftY : 0;
    const stiff = clamp(p.tailStiff, 0, 1);
    const k = lerp(70, 190, stiff) * (1 + 1.5 * calm);
    const c = 2 * Math.sqrt(k) * lerp(0.3, 0.5, calm);
    for (let i = 1; i < TAIL_POINTS; i++) {
      const w = i / (TAIL_POINTS - 1);
      this.ox[i] = this.ox[i]! - sx * lag * w;
      this.oy[i] = this.oy[i]! - sy * lag * w;
    }
    let steps = Math.min(MAX_STEPS, Math.max(1, Math.round(dtMs / 1000 / STEP_S)));
    const h = Math.min(0.1, dtMs / 1000) / steps;
    while (steps-- > 0) {
      for (let i = 1; i < TAIL_POINTS; i++) {
        const w = i / (TAIL_POINTS - 1);
        const ax = -k * this.ox[i]! - c * this.vx[i]!;
        const ay = -k * this.oy[i]! - c * this.vy[i]!;
        this.vx[i] = this.vx[i]! + ax * h;
        this.vy[i] = this.vy[i]! + ay * h;
        const lim = 16 * w;
        this.ox[i] = clamp(this.ox[i]! + this.vx[i]! * h, -lim, lim);
        this.oy[i] = clamp(this.oy[i]! + this.vy[i]! * h, -lim, lim);
      }
    }
    this.place(rootX, rootY, groundY);
    for (let i = 0; i < TAIL_POINTS; i++) {
      if (!Number.isFinite(this.x[i]!) || !Number.isFinite(this.y[i]!)) {
        this.ready = false;
        this.ox.fill(0);
        this.oy.fill(0);
        this.vx.fill(0);
        this.vy.fill(0);
        this.place(rootX, rootY, groundY);
        this.ready = true;
        break;
      }
    }
  }
}
