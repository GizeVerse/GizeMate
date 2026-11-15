// Shared toolkit for simple procedural puppets: stable re-exports of the cat's maths, spring chain
// and matrix helpers plus the painting helpers, so a new character's renderer imports from one
// place and the cat's implementation stays where it is.
export { clamp, clamp01, damp, easeInOut, easeIn, easeOut, easeOutBack, finiteOr, lerp, noise1, pulse, seededRandom, seg, smooth, sseg, TAU, wrap01 } from '../cat/math';
export { applyMatX, applyMatY, OUTLINE_W, type Mat } from '../cat/rig';
export { TailChain, TAIL_RADIUS_BASE, TAIL_RADIUS_TIP, TAIL_SEG_LEN, TAIL_SEGMENTS } from '../cat/tail';
export { drawPendantBetween, DEFAULT_PENDANT_PALETTE, type PendantPalette } from '../cat/accessory';
export { drawBlobShadow, fillShape, FINE_DETAIL_PPU, hardenAlpha, isFineDetail, isPixelMode, limbStroke, PIXEL_MODE_PPU, strokeOutline, traceClosedSpline, unitPx } from './paint';
export type { Ctx2D } from '../cat/draw';
