// Preview page for scripts/preview-characters.cjs: character-generic contact sheets. Every cell is
// rendered through the real CatScene (which builds the character's renderer through the registry,
// createCharacterRenderer(id, seeded random)), simulated at 60 Hz like the overlay, then outlined with the
// scene's bounds (cyan) and hit rects (magenta, with their index).
import { ANIM_CLIPS, ONE_SHOT_CLIPS, type AnimClip, type BehaviorState, type CatRenderState, type RenderStyle } from '../../src/shared/cat';
import { CHARACTER_IDS, getCharacter, type CharacterId } from '../../src/shared/characters/registry';
import { gaitHz, loopPeriodS, clipDurationS } from '../../src/renderer/overlay/cat/clips';
import { seededRandom } from '../../src/renderer/overlay/cat/math';
import { createCharacterRenderer, hasOwnRenderer } from '../../src/renderer/overlay/characters/registry';
import { CatScene, type Layer, type LayerProvider } from '../../src/renderer/overlay/scene';

const LIGHT = '#eef1f5';
const DARK = '#1d2230';
type Bg = 'light' | 'dark';
const T0 = 1000;
const DT = 1000 / 60;

/** One leg of a simulated run. Speeds are body lengths per second (the render state's `speed`). */
interface Seg {
  clip: AnimClip;
  ms: number;
  speed?: number;
  /** Horizontal travel in body lengths per second (along the facing). */
  vx?: number;
  /** Vertical travel in DIP/s at scale 1 (negative = up). */
  vyDip?: number;
  /** Render-state vertical velocity (DIP/s at scale 1; positive = down). */
  vy?: number;
  state?: BehaviorState;
}

interface Spec {
  id: CharacterId;
  skin: string;
  style: RenderStyle;
  scale: number;
  facing: 1 | -1;
  accessory?: 'heartPendant';
  segs: Seg[];
  /** Capture moment, ms after the first leg started. */
  at: number;
  /** 'start': the first leg starts on the ground line (jumps); 'capture': the capture frame sits on it. */
  yRef?: 'start' | 'capture';
}

interface Cell {
  label: string;
  bg: Bg;
  spec: Spec;
  /** Scrolling ground ticks (motion strips). */
  ticks?: boolean;
}

interface Row {
  header?: string;
  cells: Cell[];
}

interface SheetDef {
  title: string;
  cols: number;
  cellW: number;
  cellH: number;
  /** Ground line as a fraction of the cell height. */
  ground: number;
  rows: Row[];
}

const layerCanvas = new OffscreenCanvas(256, 256);
const layerCtx = layerCanvas.getContext('2d');
const layers: LayerProvider = (w, h) => {
  if (!layerCtx) return null;
  if (layerCanvas.width < w || layerCanvas.height < h) {
    layerCanvas.width = Math.max(layerCanvas.width, w);
    layerCanvas.height = Math.max(layerCanvas.height, h);
  }
  const l: Layer = { canvas: layerCanvas, ctx: layerCtx };
  return l;
};

/** Plays the spec at 60 Hz up to its capture frame. Returns the scene and the horizontal distance travelled. */
function simulate(spec: Spec, cx: number, gy: number): { scene: CatScene; worldX: number } {
  const scene = new CatScene(seededRandom(7));
  const body = getCharacter(spec.id).body.widthDip;
  const starts: number[] = [];
  let acc = 0;
  for (const s of spec.segs) {
    starts.push(acc);
    acc += s.ms;
  }
  const segAt = (t: number): number => {
    let i = 0;
    while (i < spec.segs.length - 1 && t >= starts[i + 1]!) i++;
    return i;
  };
  const times: number[] = [];
  for (let t = 0; t < spec.at - 1e-6; t += DT) times.push(t);
  times.push(spec.at);
  // Path first (the anchor of tick i relative to the capture frame), then the run.
  const xs: number[] = [0];
  const ys: number[] = [0];
  for (let i = 1; i < times.length; i++) {
    const seg = spec.segs[segAt(times[i - 1]!)]!;
    const dt = (times[i]! - times[i - 1]!) / 1000;
    xs.push(xs[i - 1]! + (seg.vx ?? 0) * body * spec.scale * spec.facing * dt);
    ys.push(ys[i - 1]! + (seg.vyDip ?? 0) * spec.scale * dt);
  }
  const xEnd = xs[xs.length - 1]!;
  const yRef = spec.yRef === 'capture' ? ys[ys.length - 1]! : 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    const k = segAt(t);
    const seg = spec.segs[k]!;
    const x = cx + xs[i]! - xEnd;
    const y = gy + ys[i]! - yRef;
    const st: CatRenderState = {
      seq: i,
      t: T0 + t,
      x,
      y,
      snap: i === 0,
      scale: spec.scale,
      facing: spec.facing,
      state: seg.state ?? (seg.clip === 'sleep' ? 'sleeping' : 'idle'),
      clip: seg.clip,
      clipStartedAt: T0 + starts[k]!,
      speed: seg.speed ?? 0,
      vy: (seg.vy ?? 0) * spec.scale,
      look: null,
      arousal: 0.2,
      contentment: 0.6,
      emote: null,
      emoteStartedAt: 0,
      opacity: 1,
      visible: true,
      skin: spec.skin,
      style: spec.style,
      shadow: true,
      animSpeed: 1,
      character: spec.id,
      ...(spec.accessory ? { accessory: spec.accessory } : {}),
    };
    scene.update({ x, y, state: st, simTime: T0 + t, dtMs: i === 0 ? 0 : t - times[i - 1]!, snapped: i === 0 });
  }
  return { scene, worldX: xEnd };
}

function drawOverlays(ctx: CanvasRenderingContext2D, scene: CatScene, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  const b = scene.bounds;
  ctx.strokeStyle = '#00b4d8';
  ctx.strokeRect(b.x, b.y, b.width, b.height);
  ctx.font = 'bold 12px Segoe UI, sans-serif';
  for (let i = 0; i < scene.hitCount; i++) {
    const r = scene.hitRects[i]!;
    ctx.strokeStyle = '#e0189a';
    ctx.strokeRect(r.x, r.y, r.width, r.height);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeText(String(i), r.x + 2, r.y + 12);
    ctx.lineWidth = 1;
    ctx.fillStyle = '#c0007a';
    ctx.fillText(String(i), r.x + 2, r.y + 12);
  }
}

const GAP = 4;
const MARGIN = 12;
const TITLE_H = 34;
const HEADER_H = 22;
const ROW_GAP = 8;

function sheetSize(s: SheetDef): { w: number; h: number } {
  const w = MARGIN * 2 + s.cols * s.cellW + (s.cols - 1) * GAP;
  let h = MARGIN * 2 + TITLE_H;
  for (const r of s.rows) h += (r.header ? HEADER_H : 0) + s.cellH + ROW_GAP;
  return { w, h };
}

function renderSheet(s: SheetDef, dpr: number): string {
  const { w, h } = sheetSize(s);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#222';
  ctx.font = 'bold 15px Segoe UI, sans-serif';
  ctx.fillText(s.title, MARGIN, MARGIN + 18);
  ctx.font = '12px Segoe UI, sans-serif';
  ctx.fillStyle = '#00829e';
  ctx.fillText('cyan = scene bounds', MARGIN, MARGIN + 32);
  ctx.fillStyle = '#c0007a';
  ctx.fillText('magenta = hit rects (index = compacted slot)', MARGIN + 140, MARGIN + 32);
  let y = MARGIN + TITLE_H;
  for (const row of s.rows) {
    if (row.header) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#222';
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      ctx.fillText(row.header, MARGIN, y + 15);
      y += HEADER_H;
    }
    row.cells.forEach((c, i) => {
      const cx = MARGIN + i * (s.cellW + GAP);
      const dark = c.bg === 'dark';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = dark ? DARK : LIGHT;
      ctx.fillRect(cx, y, s.cellW, s.cellH);
      ctx.strokeStyle = 'rgba(128,128,128,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 0.5, y + 0.5, s.cellW - 1, s.cellH - 1);
      const gy = y + s.cellH * s.ground;
      const ax = cx + s.cellW / 2;
      ctx.strokeStyle = 'rgba(128,128,128,0.4)';
      ctx.beginPath();
      ctx.moveTo(cx + 4, gy + 0.5);
      ctx.lineTo(cx + s.cellW - 4, gy + 0.5);
      ctx.stroke();
      const { scene, worldX } = simulate(c.spec, ax, gy);
      if (c.ticks) {
        ctx.strokeStyle = 'rgba(128,128,128,0.7)';
        ctx.beginPath();
        const step = 24;
        const first = Math.ceil((worldX - s.cellW / 2) / step) * step;
        for (let wx = first; wx <= worldX + s.cellW / 2; wx += step) {
          const sx = ax + (wx - worldX);
          if (sx > cx + 4 && sx < cx + s.cellW - 4) {
            ctx.moveTo(sx + 0.5, gy + 1);
            ctx.lineTo(sx + 0.5, gy + 6);
          }
        }
        ctx.stroke();
      }
      scene.draw(ctx, dpr, layers);
      drawOverlays(ctx, scene, dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = '12px Segoe UI, sans-serif';
      ctx.fillStyle = dark ? '#d5dcec' : '#3a4152';
      ctx.fillText(c.label, cx + 5, y + 14);
    });
    y += s.cellH + ROW_GAP;
  }
  return canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Sheet builders

const SPEED: Partial<Record<AnimClip, number>> = { walk: 0.7, run: 2.6, climb: 0.5, hop: 0.7, float: 0.3, bounce: 0.5, stalk: 0.29, slink: 1, sprint: 4.3 };
const VY: Partial<Record<AnimClip, number>> = { jump: -400, pounce: -400, fall: 450 };

/** A single clip held for the whole run (the clip starts at 0, the capture is `tSec` into it). */
function one(id: CharacterId, clip: AnimClip, tSec: number, o: Partial<Spec> = {}): Spec {
  return {
    id,
    skin: getCharacter(id).skins[0] ?? 'default',
    style: 'smooth',
    scale: 1,
    facing: 1,
    segs: [{ clip, ms: 1e9, ...(SPEED[clip] !== undefined ? { speed: SPEED[clip] } : {}), ...(VY[clip] !== undefined ? { vy: VY[clip] } : {}) }],
    at: Math.round(tSec * 1000),
    ...o,
  };
}

function phasesOf(clip: AnimClip): number[] {
  const dur = clipDurationS(clip);
  if (dur !== null) return [0.04, dur * 0.5, dur + 0.1];
  if (clip === 'jump' || clip === 'fall' || clip === 'pounce') return [0.1, 0.25, 0.4];
  if (clip === 'crouch') return [0.1, 0.5, 1.0];
  const hz = gaitHz(clip, SPEED[clip] ?? 0);
  const period = hz > 0 ? 1 / hz : (loopPeriodS(clip) ?? 2.4);
  return [1, 1 + period / 3, 1 + (2 * period) / 3];
}

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

function clipsSheets(id: CharacterId): Record<string, SheetDef> {
  const m = getCharacter(id);
  const out: Record<string, SheetDef> = {};
  const PER = 10;
  const pages = Math.ceil(ANIM_CLIPS.length / PER);
  for (let p = 0; p < pages; p++) {
    const rows: Row[] = [];
    for (const clip of ANIM_CLIPS.slice(p * PER, (p + 1) * PER)) {
      const native = (m.clips as readonly AnimClip[]).includes(clip);
      const alias = m.clipAlias[clip];
      const kind = ONE_SHOT_CLIPS.has(clip) ? 'one-shot: start / middle / end' : 'loop: three phases';
      const note = native ? 'native' : alias ? `alias -> ${alias}` : 'fallback';
      const cells: Cell[] = [];
      for (const bg of ['light', 'dark'] as Bg[]) {
        for (const facing of [1, -1] as const) {
          for (const t of phasesOf(clip)) {
            cells.push({ label: `${t.toFixed(2)}s ${facing === 1 ? 'R' : 'L'}`, bg, spec: one(id, clip, t, { facing, scale: 0.9 }) });
          }
        }
      }
      rows.push({ header: `${clip}   [${kind}; ${note}]`, cells });
    }
    out[`clips-${p + 1}`] = {
      title: `${id}: clips page ${p + 1}/${pages} (cells: light R, light L, dark R, dark L; R/L = facing)`,
      cols: 12,
      cellW: 135,
      cellH: 140,
      ground: 0.8,
      rows,
    };
  }
  return out;
}

function skinsSheets(id: CharacterId): Record<string, SheetDef> {
  const m = getCharacter(id);
  const out: Record<string, SheetDef> = {};
  const PER = 8;
  for (const style of ['smooth', 'pixel'] as RenderStyle[]) {
    const pages = Math.max(1, Math.ceil(m.skins.length / PER));
    for (let p = 0; p < pages; p++) {
      const rows: Row[] = m.skins.slice(p * PER, (p + 1) * PER).map((skin) => {
        const cells: Cell[] = [];
        for (const bg of ['light', 'dark'] as Bg[]) {
          for (const clip of ['stand', 'sit', 'walk', 'sleep'] as AnimClip[]) {
            cells.push({ label: `${skin} ${clip}`, bg, spec: one(id, clip, clip === 'walk' ? 1.1 : 1.4, { skin, style, scale: 1 }) });
          }
        }
        return { header: skin, cells };
      });
      out[`skins-${style}-${p + 1}`] = { title: `${id}: skins, ${style} style, page ${p + 1}/${pages} (light: stand sit walk sleep, then dark)`, cols: 8, cellW: 165, cellH: 150, ground: 0.82, rows };
    }
  }
  return out;
}

function pixelSheet(id: CharacterId): Record<string, SheetDef> {
  const rows: Row[] = [0.5, 1, 2].map((scale) => {
    const cells: Cell[] = [];
    for (const bg of ['light', 'dark'] as Bg[]) {
      for (const clip of ['stand', 'sit', 'walk', 'sleep'] as AnimClip[]) {
        cells.push({ label: `x${scale} ${clip}`, bg, spec: one(id, clip, clip === 'walk' ? 1.1 : 1.4, { style: 'pixel', scale }) });
      }
    }
    return { header: `pixel style, scale ${scale}`, cells };
  });
  return { pixel: { title: `${id}: pixel style at scales 0.5 / 1 / 2 (light: stand sit walk sleep, then dark)`, cols: 8, cellW: 230, cellH: 210, ground: 0.85, rows } };
}

function motionSheets(id: CharacterId, stride: number): Record<string, SheetDef> {
  const N = 12;
  const loco: [AnimClip, Seg][] = [
    ['walk', { clip: 'walk', ms: 1e9, speed: 0.7, vx: 0.7 }],
    ['run', { clip: 'run', ms: 1e9, speed: 2.6, vx: 2.6 }],
    ['hop', { clip: 'hop', ms: 1e9, speed: 0.7, vx: 0.7 }],
    ['float', { clip: 'float', ms: 1e9, speed: 0.3, vx: 0.3 }],
    ['bounce', { clip: 'bounce', ms: 1e9, speed: 0.5, vx: 0.5 }],
    ['climb', { clip: 'climb', ms: 1e9, speed: 0.5, vyDip: -30 }],
    ['swing', { clip: 'swing', ms: 1e9, speed: 0.4, vx: 0.4 }],
  ];
  const span = stride * DT * (N - 1);
  const locoRows: Row[] = loco.map(([clip, seg]) => {
    const cells: Cell[] = [];
    for (let k = 0; k < N; k++) {
      const at = 800 + k * stride * DT;
      cells.push({
        label: `${(at / 1000).toFixed(2)}s`,
        bg: 'light',
        ticks: true,
        spec: { ...one(id, clip, 0), segs: [seg], at, scale: 0.9, yRef: 'start' },
      });
    }
    return { header: `${clip}: ${N} frames, one every ${stride} ticks of the 60 Hz sim (${(stride * DT).toFixed(1)} ms; span ${(span / 1000).toFixed(2)} s), from 0.80 s into the clip; speed ${seg.speed} body lengths/s`, cells };
  });
  const trans = (name: string, segs: Seg[], total: number): Row => {
    const cells: Cell[] = [];
    for (let k = 0; k < N; k++) {
      const at = (total * k) / (N - 1);
      let acc = 0;
      let clip = segs[0]!.clip;
      for (const s of segs) {
        if (at >= acc) clip = s.clip;
        acc += s.ms;
      }
      cells.push({ label: `${(at / 1000).toFixed(2)}s ${clip}`, bg: 'light', ticks: true, spec: { ...one(id, segs[0]!.clip, 0), segs, at, scale: 0.9, yRef: 'start' } });
    }
    return { header: `${name}: ${N} frames evenly over ${(total / 1000).toFixed(2)} s`, cells };
  };
  const ARC = 330;
  const transRows: Row[] = [
    trans('stand -> walk -> stand', [{ clip: 'stand', ms: 400 }, { clip: 'walk', ms: 700, speed: 0.7, vx: 0.7 }, { clip: 'stand', ms: 500 }], 1600),
    trans('sit -> sleep -> wake', [{ clip: 'sit', ms: 500 }, { clip: 'sleep', ms: 900 }, { clip: 'wake', ms: 1600 }], 3000),
    trans(
      'jump -> fall -> land',
      [
        { clip: 'stand', ms: 150 },
        { clip: 'jump', ms: 350, vy: -420, vyDip: -ARC },
        { clip: 'fall', ms: 350, vy: 420, vyDip: ARC },
        { clip: 'land', ms: 300 },
      ],
      1150,
    ),
    trans('vanish -> appear', [{ clip: 'stand', ms: 400 }, { clip: 'vanish', ms: 900 }, { clip: 'appear', ms: 900 }], 2200),
  ];
  const w = 138;
  return {
    'motion-locomotion': { title: `${id}: locomotion strips (light, smooth, scale 0.9; ticks on the ground scroll with the travel)`, cols: N, cellW: w, cellH: 150, ground: 0.8, rows: locoRows },
    'motion-transitions': { title: `${id}: transitions (light, smooth, scale 0.9)`, cols: N, cellW: w, cellH: 235, ground: 0.86, rows: transRows },
  };
}

const POSES: [AnimClip, number][] = [
  ['stand', 1.2],
  ['sit', 1.2],
  ['sleep', 2],
  ['startle', 0.3],
  ['petted', 1],
  ['held', 1],
];

function zoomCell(id: CharacterId, clip: AnimClip, t: number, bg: Bg): Cell {
  return { label: `${clip} ${t.toFixed(2)}s x3`, bg, spec: one(id, clip, t, { scale: 3 }) };
}

function posesSheet(id: CharacterId): Record<string, SheetDef> {
  const cells: Cell[] = [];
  for (const [clip, t] of POSES) for (const bg of ['light', 'dark'] as Bg[]) cells.push(zoomCell(id, clip, t, bg));
  return { poses: { title: `${id}: poses at 3x zoom (stand, sit, sleep, startle, petted, held; each light then dark)`, cols: 4, cellW: 360, cellH: 330, ground: 0.86, rows: chunk(cells, 4).map((c) => ({ cells: c })) } };
}

function focusSheets(id: CharacterId): Record<string, SheetDef> {
  const m = getCharacter(id);
  const done = new Set<AnimClip>(POSES.map((p) => p[0]));
  const clips = (m.clips as readonly AnimClip[]).filter((c) => !done.has(c));
  const out: Record<string, SheetDef> = {};
  const cells = clips.map((clip) => zoomCell(id, clip, phasesOf(clip)[1]!, 'light'));
  const pages = chunk(cells, 12);
  pages.forEach((p, i) => {
    out[`focus-${i + 1}`] = { title: `${id}: module clips at 3x zoom, page ${i + 1}/${pages.length} (middle phase)`, cols: 4, cellW: 360, cellH: 330, ground: 0.86, rows: chunk(p, 4).map((c) => ({ cells: c })) };
  });
  return out;
}

function accessorySheet(id: CharacterId): Record<string, SheetDef> {
  const cells: Cell[] = [];
  for (const bg of ['light', 'dark'] as Bg[]) {
    for (const clip of ['stand', 'sit', 'sleep', 'walk'] as AnimClip[]) {
      cells.push({ label: `heartPendant ${clip}`, bg, spec: one(id, clip, clip === 'walk' ? 1.1 : 1.4, { scale: 2, accessory: 'heartPendant' }) });
    }
  }
  return { accessory: { title: `${id}: accessory heartPendant (stand, sit, sleep, walk; light then dark; scale 2)`, cols: 8, cellW: 230, cellH: 220, ground: 0.85, rows: [{ cells }] } };
}

const KINDS = ['clips', 'skins', 'pixel', 'motion', 'poses', 'focus', 'accessory'] as const;

const built = new Map<string, SheetDef>();

window.__cp = {
  ids: () => [...CHARACTER_IDS],
  kinds: () => [...KINDS],
  info: (id) => {
    const cid = id as CharacterId;
    const r = createCharacterRenderer(cid, seededRandom(1));
    return { id, own: hasOwnRenderer(cid), renderer: r.constructor.name, rendererId: r.id, skins: [...getCharacter(cid).skins], clips: [...getCharacter(cid).clips] };
  },
  build: (id, kinds, stride) => {
    built.clear();
    const cid = id as CharacterId;
    const all: Record<string, SheetDef> = {};
    for (const k of kinds) {
      if (k === 'clips') Object.assign(all, clipsSheets(cid));
      if (k === 'skins') Object.assign(all, skinsSheets(cid));
      if (k === 'pixel') Object.assign(all, pixelSheet(cid));
      if (k === 'motion') Object.assign(all, motionSheets(cid, stride));
      if (k === 'poses') Object.assign(all, posesSheet(cid));
      if (k === 'focus') Object.assign(all, focusSheets(cid));
      if (k === 'accessory') Object.assign(all, accessorySheet(cid));
    }
    for (const [n, s] of Object.entries(all)) built.set(n, s);
    return [...built.keys()];
  },
  render: (name, dpr) => {
    const s = built.get(name);
    if (!s) throw new Error(`unknown sheet ${name}`);
    return renderSheet(s, dpr);
  },
};

declare global {
  interface Window {
    __cp: {
      ids(): string[];
      kinds(): string[];
      info(id: string): { id: string; own: boolean; renderer: string; rendererId: string; skins: string[]; clips: string[] };
      build(id: string, kinds: string[], stride: number): string[];
      render(name: string, dpr: number): string;
    };
  }
}
