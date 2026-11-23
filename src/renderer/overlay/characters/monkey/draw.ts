// Monkey painter: two-pass outline-then-fill language (every group is outlined, then filled, so
// overlapping parts of a group merge into one exterior outline), flat fills, subtle highlight shapes,
// dark glossy eyes with a catch-light. Allocation-free: module-level scratch, one Painter state.
import type { CatAccessory } from '../../../../shared/cat';
import { clamp, clamp01, drawBlobShadow, drawPendantBetween, isFineDetail, isPixelMode, TAU, type Ctx2D, type TailChain } from '../../character/kit';
import { HEAD_RX, HEAD_RY, SHIN, THIGH, UPPER_ARM, FORE_ARM, type Pose, type Rig } from './rig';
import type { MonkeySkin } from './skins';

const HALO_W = 1.1;
const TAIL_W0 = 5.4;
const TAIL_W1 = 3.6;
const ARM_W1 = 7.6;
const ARM_W2 = 6.6;
const LEG_W1 = 9;
const LEG_W2 = 7.6;
export const HAND_R = 4.4;
export const FOOT_RX = 6;
export const FOOT_RY = 3.7;
export const EAR_R = 5.6;
const TOOTH = '#fff4e2';

let ctx!: Ctx2D;
let sk!: MonkeySkin;
let ol = 1.6;
let unit = 1;
let pixel = false;
let fine = true;
let halo = false;
/** Minimum limb stroke so thin parts survive pixel mode. */
let minW = 0;

function outlineSeg(ax: number, ay: number, bx: number, by: number, w: number): void {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = halo ? (sk.halo as string) : sk.outline;
  ctx.lineWidth = Math.max(minW, w) + 2 * (ol + (halo ? HALO_W : 0));
  ctx.stroke();
}

function fillSeg(ax: number, ay: number, bx: number, by: number, w: number, color: string): void {
  if (halo) return;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(minW, w);
  ctx.stroke();
}

function ellPath(cx: number, cy: number, rx: number, ry: number, rot: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
}

function outlineEll(cx: number, cy: number, rx: number, ry: number, rot: number): void {
  ellPath(cx, cy, rx, ry, rot);
  ctx.strokeStyle = halo ? (sk.halo as string) : sk.outline;
  ctx.lineWidth = 2 * (ol + (halo ? HALO_W : 0));
  ctx.stroke();
}

function fillEll(cx: number, cy: number, rx: number, ry: number, rot: number, color: string): void {
  if (halo) return;
  ellPath(cx, cy, rx, ry, rot);
  ctx.fillStyle = color;
  ctx.fill();
}

function stroke(color: string, w: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.1, w);
  ctx.stroke();
}

// ---------------------------------------------------------------------------------------------

export function drawMonkey(c: Ctx2D, rig: Rig, p: Pose, tail: TailChain, skin: MonkeySkin, o: { outline: number; shadow: boolean; pixelsPerUnit: number; accessory?: CatAccessory | undefined }): void {
  ctx = c;
  sk = skin;
  ol = Number.isFinite(o.outline) ? Math.max(0.5, o.outline) : 1.6;
  const ppu0 = Number.isFinite(o.pixelsPerUnit) ? o.pixelsPerUnit : 1;
  unit = 1 / Math.max(1e-3, ppu0);
  pixel = isPixelMode(ppu0);
  fine = isFineDetail(ppu0);
  minW = pixel ? 5 : 0;
  if (o.shadow) drawMonkeyShadow(c, rig, p);
  c.save();
  const m = rig.m;
  c.transform(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (skin.halo !== null) {
    halo = true;
    paintBody(rig, p, tail, false, 0);
  }
  halo = false;
  paintBody(rig, p, tail, o.accessory === 'heartPendant', ppu0);
  c.restore();
}

function paintBody(rig: Rig, p: Pose, tail: TailChain, pendant: boolean, ppu: number): void {
  paintTail(tail);
  paintLeg(rig, 1);
  paintArm(rig, 1, p, 0);
  paintTorso(rig, p);
  paintLeg(rig, 0);
  // A near arm thrown up beside the head goes behind it; a hand at the face stays in front.
  const behind = Math.hypot(rig.hand[0]! - rig.headX, rig.hand[1]! - rig.headY) > 19 && rig.hand[1]! < rig.sh[1]! - 8;
  const back = p.armBack > 0.5;
  if (behind) paintArm(rig, 0, p, 0);
  else if (back) paintArm(rig, 0, p, 1);
  if (pendant && !halo && !(rig.hand[1]! > rig.chestY + 4 && rig.headY < rig.chestY - 3)) paintPendant(rig, ppu);
  paintHead(rig, p);
  if (back && !behind) paintArm(rig, 0, p, 2);
  else if (!behind) paintArm(rig, 0, p, 0);
  // The pendant hangs in front of the chest, over a hanging arm; with the head down on the chest (sleep) it stays under the head.
  if (pendant && !halo && rig.hand[1]! > rig.chestY + 4 && rig.headY < rig.chestY - 3) paintPendant(rig, ppu);
}

function paintPendant(rig: Rig, ppu: number): void {
    const ux = rig.ux;
    const uy = rig.uy;
    const nx = rig.neckX - ux * 1.5;
    const ny = rig.neckY - uy * 1.5;
    // The heart hangs toward world down (the pose matrix maps it back into the body frame), also mid-backflip or swing.
    const m = rig.m;
    const det = m[0]! * m[3]! - m[1]! * m[2]!;
    let hx = -ux + rig.fx * 0.3;
    let hy = -uy + rig.fy * 0.3;
    if (Math.abs(det) > 1e-4) {
      hx = -m[2]! / det;
      hy = m[0]! / det;
    }
    drawPendantBetween(ctx, nx - rig.fx * 6.5, ny - rig.fy * 6.5, nx + rig.fx * 6.5, ny + rig.fy * 6.5, hx, hy, 1.1, sk.outline, ol, ppu);
  }

function paintTail(tail: TailChain): void {
  const n = tail.count;
  const xs = tail.x;
  const ys = tail.y;
  const puff = tail.puff;
  for (let i = 0; i < n - 1; i++) outlineSeg(xs[i]!, ys[i]!, xs[i + 1]!, ys[i + 1]!, tailW(i, n) * puff);
  for (let i = 0; i < n - 1; i++) {
    const tip = sk.tailTip !== null && i >= n - 4;
    fillSeg(xs[i]!, ys[i]!, xs[i + 1]!, ys[i + 1]!, tailW(i, n) * puff, tip ? (sk.tailTip as string) : sk.fur);
  }
}

const tailW = (i: number, n: number): number => TAIL_W0 + (TAIL_W1 - TAIL_W0) * (i / Math.max(1, n - 2));

function paintTorso(rig: Rig, p: Pose): void {
  const pe = rig.pelvis;
  const ce = rig.chestE;
  outlineEll(pe.cx, pe.cy, pe.rx, pe.ry, pe.rot);
  outlineEll(ce.cx, ce.cy, ce.rx, ce.ry, ce.rot);
  fillEll(pe.cx, pe.cy, pe.rx, pe.ry, pe.rot, sk.fur);
  fillEll(ce.cx, ce.cy, ce.rx, ce.ry, ce.rot, sk.fur);
  if (halo) return;
  const b = rig.belly;
  const k = clamp(p.chest, 0.7, 1.5);
  fillEll(b.cx - rig.fx * 0.8, b.cy - rig.fy * 0.8, b.rx - 2, 5.6 * k, b.rot, sk.belly);
  if (fine) {
    // A soft highlight along the back.
    ctx.save();
    ctx.globalAlpha *= 0.28;
    fillEll(ce.cx - rig.fx * 5.5 + rig.ux * 1, ce.cy - rig.fy * 5.5 + rig.uy * 1, 8, 3, ce.rot, sk.furLight);
    ctx.restore();
  }
}

function paintLeg(rig: Rig, side: number): void {
  const o = side * 2;
  const hx = rig.hip[o]!;
  const hy = rig.hip[o + 1]!;
  const kx = rig.knee[o]!;
  const ky = rig.knee[o + 1]!;
  const fx = rig.foot[o]!;
  const fy = rig.foot[o + 1]!;
  const far = side === 1;
  const body = far ? sk.furDark : sk.fur;
  let rot = (Math.atan2(fy - ky, fx - kx) - Math.PI / 2) * 0.5;
  if (Math.abs(fy - -3.4) < 0.8) rot = 0;
  rot = clamp(rot, -0.9, 0.9);
  const ex = fx + 2 * Math.cos(rot);
  const ey = fy + 2 * Math.sin(rot);
  outlineSeg(hx, hy, kx, ky, LEG_W1);
  outlineSeg(kx, ky, fx, fy, LEG_W2);
  outlineEll(ex, ey, FOOT_RX, FOOT_RY, rot);
  fillSeg(hx, hy, kx, ky, LEG_W1, body);
  fillSeg(kx, ky, fx, fy, LEG_W2, body);
  fillEll(ex, ey, FOOT_RX, FOOT_RY, rot, sk.hand);
}

/** part 0: the whole arm; 1: the limb without the hand (drawn behind the head); 2: the hand alone (drawn over it). */
function paintArm(rig: Rig, side: number, p: Pose, part: number): void {
  const o = side * 2;
  const sx = rig.sh[o]!;
  const sy = rig.sh[o + 1]!;
  const ex = rig.el[o]!;
  const ey = rig.el[o + 1]!;
  const hx = rig.hand[o]!;
  const hy = rig.hand[o + 1]!;
  const far = side === 1;
  const body = far ? sk.furDark : sk.fur;
  const grip = side === 0 ? p.gripN : p.gripF;
  const a = Math.atan2(hy - ey, hx - ex);
  if (part !== 2) {
    outlineSeg(sx, sy, ex, ey, ARM_W1);
    outlineSeg(ex, ey, hx, hy, ARM_W2);
  }
  if (part === 1) {
    fillSeg(sx, sy, ex, ey, ARM_W1, body);
    fillSeg(ex, ey, hx, hy, ARM_W2, body);
    return;
  }
  outlineEll(hx, hy, HAND_R, HAND_R, 0);
  const showFingers = !pixel && grip < 0.55;
  if (showFingers) for (let i = -1; i <= 1; i++) outlineEll(hx + Math.cos(a + i * 0.55) * (HAND_R + 1.3), hy + Math.sin(a + i * 0.55) * (HAND_R + 1.3), 1.9, 1.9, 0);
  if (part === 0) {
    fillSeg(sx, sy, ex, ey, ARM_W1, body);
    fillSeg(ex, ey, hx, hy, ARM_W2, body);
  }
  fillEll(hx, hy, HAND_R, HAND_R, 0, sk.hand);
  if (showFingers) for (let i = -1; i <= 1; i++) fillEll(hx + Math.cos(a + i * 0.55) * (HAND_R + 1.3), hy + Math.sin(a + i * 0.55) * (HAND_R + 1.3), 1.9, 1.9, 0, sk.hand);
  if (!halo && fine && grip >= 0.55) {
    // Curled fingers: two short creases across the fist.
    ctx.beginPath();
    for (let i = -1; i <= 1; i += 2) {
      const px = hx + Math.cos(a) * 1.2 - Math.sin(a) * i * 1.7;
      const py = hy + Math.sin(a) * 1.2 + Math.cos(a) * i * 1.7;
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * 2.6, py + Math.sin(a) * 2.6);
    }
    stroke(sk.furDark, 1);
  }
}

// ---------------------------------------------------------------------------------------------

function paintHead(rig: Rig, p: Pose): void {
  ctx.save();
  ctx.translate(rig.headX, rig.headY);
  ctx.rotate(rig.headRot);
  const turn = clamp(p.turn, -1, 1);
  const perk = clamp(p.earPerk, -1, 1);
  const fx = 2 + 5 * turn;
  const mzx = fx + 5.6;
  const mzy = 5.2;
  // Far ear (behind the head).
  const fex = 8.4 - 2.4 * turn;
  const fey = -7.5 - 2 * perk;
  outlineEll(fex, fey, EAR_R * 0.92, EAR_R * 0.92, 0);
  fillEll(fex, fey, EAR_R * 0.92, EAR_R * 0.92, 0, sk.furDark);
  if (!halo) fillEll(fex + 0.3, fey, EAR_R * 0.5, EAR_R * 0.5, 0, sk.earInner);
  // Head silhouette: skull and muzzle merge into one outline.
  outlineEll(0, 0, HEAD_RX, HEAD_RY, 0);
  outlineEll(mzx, mzy, 7.4, 5.5, 0);
  fillEll(0, 0, HEAD_RX, HEAD_RY, 0, sk.fur);
  if (halo) {
    ctx.restore();
    return;
  }
  fillEll(mzx, mzy, 7.4, 5.5, 0, sk.muzzle);
  // Face mask: a heart of two brow lobes over a rounded lower face.
  fillEll(fx - 3.9, -2.8, 6, 5.6, 0, sk.face);
  fillEll(fx + 3.9, -2.8, 6, 5.6, 0, sk.face);
  fillEll(fx + 1.2, 2.6, 9.6, 8.4, 0, sk.face);
  fillEll(mzx, mzy, 6.6, 4.6, 0, sk.muzzle);
  if (fine) {
    ctx.save();
    ctx.globalAlpha *= 0.25;
    fillEll(-3, -9, 7.5, 2.6, -0.25, sk.furLight);
    ctx.restore();
  }
  // Near ear on the side of the head.
  const nex = -9.6 + 2.6 * turn;
  const ney = -3.6 - 2.2 * perk;
  outlineEll(nex, ney, EAR_R, EAR_R, 0);
  fillEll(nex, ney, EAR_R, EAR_R, 0, sk.fur);
  fillEll(nex + 0.5, ney, EAR_R * 0.55, EAR_R * 0.58, 0, sk.earInner);

  paintEyes(p, turn, fx);
  paintMouth(p, mzx, mzy);
  ctx.restore();
}

function paintEyes(p: Pose, turn: number, fx: number): void {
  const open = clamp01(p.eyeOpen);
  const spacing = 7.1 - 2.4 * Math.max(0, turn);
  const ey = -1.4;
  const px = clamp(p.pupilX, -1, 1) * 1.1;
  const py = clamp(p.pupilY, -1, 1) * 0.9;
  for (let i = 0; i < 2; i++) {
    const ex = fx + 1.4 + (i === 0 ? -spacing / 2 : spacing / 2);
    const brow = clamp(p.brow, -1, 1);
    if (open > 0.2) {
      const ry = (pixel ? 3.6 : 3.2) * (0.35 + 0.65 * open);
      fillEll(ex + px, ey + py, pixel ? 2.8 : 2.5, ry, 0, sk.eye);
      if (!pixel) fillEll(ex + px + 0.8, ey + py - ry * 0.38, 0.95, 0.95, 0, sk.eyeHi);
    } else {
      const lw = Math.max(1.1, unit * 1.2);
      ctx.beginPath();
      ctx.moveTo(ex - 2.6, ey + 0.8);
      const bulge = p.smile > 0.5 ? -2.4 : 1.6;
      ctx.quadraticCurveTo(ex, ey + 0.8 + bulge, ex + 2.6, ey + 0.8);
      stroke(sk.eye, lw);
    }
    if (!pixel) {
      // Brow: raised, flat or angry (the inner end drops).
      const inner = i === 0 ? 1 : -1;
      const lift = brow > 0 ? brow : 0;
      const x0 = ex - inner * 2.8;
      const x1 = ex + inner * 2.8;
      ctx.beginPath();
      ctx.moveTo(x0, ey - 5.6 - lift * 1.6);
      ctx.lineTo(x1, ey - 5.6 - brow * 2 - lift * 0.4);
      stroke(sk.furDark, 1.5);
    }
  }
}

function paintMouth(p: Pose, mx: number, my: number): void {
  const open = clamp01(p.mouth);
  const sm = clamp(p.smile, -1, 1);
  if (!pixel) {
    // Nostrils.
    ctx.fillStyle = sk.nose;
    ctx.beginPath();
    ctx.arc(mx + 4.4, my - 2.2, 0.8, 0, TAU);
    ctx.arc(mx + 1.8, my - 2.4, 0.8, 0, TAU);
    ctx.fill();
  }
  const y = my + 2.4;
  if (open > 0.12) {
    const rx = 3.2 + 1.2 * open;
    const ry = 1 + 4.4 * open;
    ellPath(mx + 0.6, y + ry * 0.55, rx, ry, 0);
    ctx.fillStyle = sk.mouth;
    ctx.fill();
    if (p.teeth > 0.2 && !pixel) {
      // Bared teeth (screech, snarl): an upper and a lower row inside the open mouth.
      const th = Math.min(ry * 0.5, 0.9 + 1.6 * clamp01(p.teeth));
      ctx.fillStyle = TOOTH;
      ctx.fillRect(mx + 0.6 - rx * 0.82, y + 0.2, rx * 1.64, th);
      if (open > 0.5) ctx.fillRect(mx + 0.6 - rx * 0.7, y + ry * 1.1 - th * 0.6, rx * 1.4, th * 0.6);
    }
    if (open > 0.4 && !pixel) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(mx + 0.6, y + ry * 1.05, rx * 0.65, ry * 0.4, 0, 0, TAU);
      ctx.fillStyle = sk.tongue;
      ctx.fill();
      ctx.restore();
    }
    stroke(sk.outline, Math.max(0.9, unit));
  } else {
    ctx.beginPath();
    ctx.moveTo(mx - 3.4, y - sm * 0.6);
    ctx.quadraticCurveTo(mx + 0.6, y + sm * 2.8 + 0.4, mx + 4.6, y - sm * 0.6);
    stroke(sk.outline, Math.max(1.1, unit * 1.1));
    if (sm > 0.55 && fine) {
      ctx.save();
      ctx.globalAlpha *= 0.5;
      fillEll(mx - 5.2, y - 1.5, 2.3, 1.5, 0, sk.blush);
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------------------------

/** Ground shadow: a soft blob under the body, shrinking with height. */
export function drawMonkeyShadow(c: Ctx2D, rig: Rig, p: Pose): void {
  const k = clamp(p.shadow, 0, 1.5);
  if (k <= 0.01) return;
  const m = rig.m;
  const air = clamp01(-p.offY / 40);
  const cx = m[0]! * rig.bodyX + m[2]! * rig.bodyY + m[4]!;
  const spread = 14 + 13 * clamp01(Math.sin(clamp(p.lean, 0, 1.3)));
  const w = spread * k * (1 - 0.35 * air) * Math.abs(m[0]!) + 4;
  const h = 4.2 * k * (1 - 0.3 * air) + 0.8;
  drawBlobShadow(c, cx, -0.6, w, h, 0.2 * Math.min(1, k) * (1 - 0.5 * air));
}

export const LIMB_LENGTHS = { UPPER_ARM, FORE_ARM, THIGH, SHIN } as const;
