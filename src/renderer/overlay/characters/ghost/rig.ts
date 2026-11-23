// Ghost: the rig turns a pose into character-local geometry (sheet outline points, arms, face
// anchors, shadow). Everything the painter and the geometry report need is solved once per frame
// here, so draw() and measure() agree exactly.
import { clamp, finiteOr, smooth } from '../../character/kit';
import type { GhostPose } from './pose';

export const BODY_H = 60;
export const BODY_N = 16;
const HEM_FIRST = 5;
const HEM_COUNT = 7;
/** Local y of the neck line (heart pendant collar) and the face anchors, body frame. */
export const NECK_Y = -18;
export const EYE_Y = -39;
export const EYE_DX = 9.5;
export const MOUTH_Y = -29;
export const SHOULDER_X = 24;
export const SHOULDER_Y = -34;
export const ARM_LEN = 16;
export const ARM_W = 9.4;

// Sheet outline, body frame, clockwise from the top: dome and right side, a three-lobed hem, left side.
const BASE = new Float64Array([
  0, -60, 13, -57.5, 22.5, -47.5, 25.5, -33, 26.5, -18,
  27, -6, 18, 2, 9, -5, 0, 2, -9, -5, -18, 2, -27, -6,
  -26.5, -18, -25.5, -33, -22.5, -47.5, -13, -57.5,
]);
/** Fraction down the sheet (0 top, 1 hem) of each point and its lean weight. */
const FRAC = new Float64Array(BODY_N);
const LEAN_W = new Float64Array(BODY_N);
for (let i = 0; i < BODY_N; i++) {
  FRAC[i] = clamp((BASE[i * 2 + 1]! + BODY_H) / (BODY_H + 4), 0, 1);
  LEAN_W[i] = Math.pow(1 - FRAC[i]!, 1.4);
}

export class GhostRig {
  /** Posed outline points (character-local). */
  readonly pts = new Float64Array(BODY_N * 2);
  // Arms: shoulder and tip (character-local) per arm, and the stroke width.
  shLx = 0;
  shLy = 0;
  enLx = 0;
  enLy = 0;
  shRx = 0;
  shRy = 0;
  enRx = 0;
  enRy = 0;
  armW = ARM_W;
  // Face.
  eyeLx = 0;
  eyeLy = 0;
  eyeRx = 0;
  eyeRy = 0;
  eyeRX = 5.2;
  eyeRY = 7.2;
  mouthX = 0;
  mouthY = 0;
  neckAx = 0;
  neckAy = 0;
  neckBx = 0;
  neckBy = 0;
  hangX = 0;
  hangY = 1;
  topX = 0;
  topY = -BODY_H;
  hemX = 0;
  hemY = 0;
  /** Sheen highlight centre. */
  hlX = 0;
  hlY = 0;
  /** Face opacity (0 when it has turned away). */
  faceVisK = 1;
  /** Body opacity factor and extent scale of the reveal (vanish/appear). */
  rot = 0;
  scaleX = 1;
  scaleY = 1;
  // Shadow in character-local terms.
  shadowX = 0;
  shadowHalf = 17;
  shadowRh = 3.4;
  shadowAlpha = 0.16;
  /** Sparkle phase (animator-driven). */
  sparklePhase = 0;
  // Frame constants.
  private cosR = 1;
  private sinR = 0;
  private sxE = 1;
  private syE = 1;
  private scy = -26;
  private pivX = 0;
  private pivY = -30;
  private offX = 0;
  private offY = 0;
  private lean = 0;
  private mx = 0;
  private my = 0;

  /** Maps a body-frame point (with lean weight w) to character-local, result in mx/my. */
  private map(x: number, y: number, w: number): void {
    const x1 = (x + this.lean * w) * this.sxE;
    const y1 = (y - this.scy) * this.syE + this.scy;
    const dx = x1 - this.pivX;
    const dy = y1 - this.pivY;
    this.mx = this.pivX + dx * this.cosR - dy * this.sinR + this.offX;
    this.my = this.pivY + dx * this.sinR + dy * this.cosR + this.offY;
  }

  solve(p: GhostPose, hemPhase: number): void {
    const spin = finiteOr(p.spin, 0);
    const cs = Math.cos(spin);
    this.sxE = p.sx * (0.5 + 0.5 * Math.abs(cs));
    this.syE = p.sy;
    this.scy = p.scaleCY;
    this.pivX = p.pivX;
    this.pivY = p.pivY;
    this.offX = p.offX;
    this.offY = p.offY;
    this.lean = p.lean;
    this.rot = p.rot;
    this.cosR = Math.cos(p.rot);
    this.sinR = Math.sin(p.rot);
    this.scaleX = this.sxE;
    this.scaleY = p.sy;
    this.faceVisK = smooth((cs + 0.2) / 0.6) * p.faceVis;

    const pts = this.pts;
    for (let i = 0; i < BODY_N; i++) {
      let x = BASE[i * 2]!;
      let y = BASE[i * 2 + 1]!;
      const j = i - HEM_FIRST;
      if (j >= 0 && j < HEM_COUNT) {
        const ph = hemPhase + j * 1.1;
        const edge = j === 0 || j === HEM_COUNT - 1;
        y += p.hemAmp * Math.sin(ph) + p.hemDrop * (j & 1 ? 1 : 0.55);
        y -= p.hemFlare * (Math.abs(x) / 27) * 7;
        x += p.hemSway * Math.sin(hemPhase * 0.7 + j * 0.8 + 1) * (edge ? 0.4 : 1);
        x *= p.hemWide;
      } else if (i === 4 || i === 12) {
        x *= 1 + (p.hemWide - 1) * 0.5;
      }
      this.map(x, y, LEAN_W[i]!);
      pts[i * 2] = this.mx;
      pts[i * 2 + 1] = this.my;
    }

    // Arms, in front of the body at the shoulder line.
    const len = ARM_LEN * clamp(p.armLen, 0, 1.4);
    const aL = clamp(p.armL, -0.1, 3.1);
    const aR = clamp(p.armR, -0.1, 3.1);
    const sw = LEAN_W[3]!;
    this.map(-SHOULDER_X, SHOULDER_Y, sw);
    this.shLx = this.mx;
    this.shLy = this.my;
    this.map(-SHOULDER_X - Math.sin(aL) * len, SHOULDER_Y + Math.cos(aL) * len, sw);
    this.enLx = this.mx;
    this.enLy = this.my;
    this.map(SHOULDER_X, SHOULDER_Y, sw);
    this.shRx = this.mx;
    this.shRy = this.my;
    this.map(SHOULDER_X + Math.sin(aR) * len, SHOULDER_Y + Math.cos(aR) * len, sw);
    this.enRx = this.mx;
    this.enRy = this.my;
    this.armW = ARM_W * (0.9 + 0.1 * clamp(p.armLen, 0.3, 1));

    // Face. Looking moves the eyes inside the sheet; a turned head slides the whole face sideways.
    const fw = 0.45;
    const fx = p.faceX + Math.sin(spin) * 13;
    const fy = p.faceY;
    const lx = clamp(p.lookX, -1.2, 1.2) * 2.6;
    const ly = clamp(p.lookY, -1.2, 1.2) * 1.8;
    this.map(fx - EYE_DX + lx, EYE_Y + fy + ly, fw);
    this.eyeLx = this.mx;
    this.eyeLy = this.my;
    this.map(fx + EYE_DX + lx, EYE_Y + fy + ly, fw);
    this.eyeRx = this.mx;
    this.eyeRy = this.my;
    this.eyeRX = 5.2 * p.eyeSize * Math.max(0.2, this.sxE);
    this.eyeRY = 7.2 * p.eyeSize * Math.max(0.2, p.sy);
    this.map(fx + lx * 0.6, MOUTH_Y + fy + ly * 0.5, fw);
    this.mouthX = this.mx;
    this.mouthY = this.my;

    // Pendant collar and hang direction (follows the body through every pose).
    this.map(fx - 15, NECK_Y, 0.5);
    this.neckAx = this.mx;
    this.neckAy = this.my;
    this.map(fx + 15, NECK_Y, 0.5);
    this.neckBx = this.mx;
    this.neckBy = this.my;
    this.hangX = -this.sinR;
    this.hangY = this.cosR;

    this.map(0, -BODY_H, 1);
    this.topX = this.mx;
    this.topY = this.my;
    this.map(-14, -46, 0.3);
    this.hlX = this.mx;
    this.hlY = this.my;
    this.map(0, 0, 0);
    this.hemX = this.mx;
    this.hemY = this.my;

    // Shadow: small and faint, on the ground line, smaller the higher the ghost floats.
    const hover = clamp(-p.offY, 0, 120);
    const k = clamp(1 - (hover - 8) / 90, 0.4, 1.1) * clamp(p.shadowK, 0.3, 1.5);
    this.shadowX = p.offX;
    this.shadowHalf = 17 * k;
    this.shadowRh = 3.3 * k + 0.4;
    this.shadowAlpha = 0.17 * clamp(k, 0.3, 1.2) * clamp(p.vis, 0, 1) * clamp(p.alpha, 0, 1);
  }
}
