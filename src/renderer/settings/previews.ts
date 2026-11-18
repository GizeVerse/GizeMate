// Live character previews for the settings window. One shared animation loop drives every preview
// canvas with the character's real renderer (createCharacterRenderer): it runs at a low frame rate,
// only while a preview is on screen and the window is visible, and not at all when motion is reduced
// (the previews then show one still pose). Surfaces and the clock are injected, so the logic runs
// without a DOM in tests. Nothing here touches the network, the DOM tree or user data.
import type { AnimClip } from '../../shared/cat';
import { characterOrDefault, getCharacter, type CharacterId } from '../../shared/characters/registry';
import type { AnimInput } from '../overlay/cat/animator';
import type { Ctx2D } from '../overlay/cat/draw';
import { OUTLINE_W } from '../overlay/cat/rig';
import type { CharacterRenderer, GeometryCollector } from '../overlay/character/types';
import { createCharacterRenderer } from '../overlay/characters/registry';

/** Frames per second of the live previews (a calm idle loop does not need more). */
export const PREVIEW_FPS = 12;
/** Longest step fed to a renderer after a stall (a hidden window, a long frame). */
const MAX_STEP_MS = 100;
/** Share of the surface the character may fill. */
const FILL = 0.82;
/** Simulated time and steps used to settle the pose of a still preview. */
const STILL_START_MS = 1400;

/** The part of a canvas a preview needs. */
export interface PreviewSurface {
  readonly width: number;
  readonly height: number;
  getContext(kind: '2d'): Ctx2D | null;
}

export interface PreviewEnv {
  raf(cb: (timestamp: number) => void): number;
  caf(id: number): void;
  /** True while the window is visible (not minimised or hidden). */
  documentVisible(): boolean;
  /** The operating system's or the companion's reduced-motion choice. */
  reducedMotion(): boolean;
}

export type RendererFactory = (id: CharacterId, random: () => number) => CharacterRenderer;

export interface PreviewSlot {
  setCharacter(id: CharacterId): void;
  setSkin(skin: string): void;
  /** A slot draws and animates only while visible (its page is shown). */
  setVisible(visible: boolean): void;
  dispose(): void;
}

interface Step {
  readonly clip: AnimClip;
  readonly ms: number;
  readonly speed: number;
}

/** The idle show every preview plays: stand, sit, walk in place, stand; clips a character lacks become stand. */
const SHOW: readonly Step[] = [
  { clip: 'stand', ms: 3200, speed: 0 },
  { clip: 'sit', ms: 3000, speed: 0 },
  { clip: 'walk', ms: 2600, speed: 0.7 },
  { clip: 'stand', ms: 1500, speed: 0 },
];
const SHOW_MS = SHOW.reduce((n, s) => n + s.ms, 0);

/** The clip of the idle show at time `t` (ms), its start time and walking speed. Pure. */
export function showStep(t: number, drawn: readonly AnimClip[]): { clip: AnimClip; startedAt: number; speed: number } {
  const cycleStart = Math.floor(Math.max(0, t) / SHOW_MS) * SHOW_MS;
  let at = cycleStart;
  for (const step of SHOW) {
    if (t < at + step.ms || step === SHOW[SHOW.length - 1]) {
      const supported = step.clip === 'stand' || drawn.includes(step.clip);
      return supported ? { clip: step.clip, startedAt: at, speed: step.speed } : { clip: 'stand', startedAt: cycleStart, speed: 0 };
    }
    at += step.ms;
  }
  return { clip: 'stand', startedAt: cycleStart, speed: 0 };
}

/** A small deterministic generator, so a preview's idle variation is the same every time. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

class Slot implements PreviewSlot {
  visible = false;
  disposed = false;
  private renderer: CharacterRenderer | null = null;
  private failed = false;
  private clock = 0;
  private extent: Extent | null = null;
  private readonly input: AnimInput;

  constructor(
    private readonly loop: PreviewLoop,
    readonly surface: PreviewSurface,
    private id: CharacterId,
    private skin: string,
  ) {
    this.input = {
      clip: 'stand',
      clipStartedAt: 0,
      sleeping: false,
      speed: 0,
      vy: 0,
      lookX: 0,
      lookY: 0,
      hasLook: false,
      arousal: 0.25,
      contentment: 0.75,
      animSpeed: 1,
      reducedMotion: false,
    };
  }

  setCharacter(id: CharacterId): void {
    const next = characterOrDefault(id);
    if (next === this.id) return;
    this.id = next;
    this.renderer = null;
    this.extent = null;
    this.failed = false;
    this.clock = 0;
    this.loop.redraw(this);
  }

  setSkin(skin: string): void {
    if (skin === this.skin) return;
    this.skin = skin;
    this.loop.redraw(this);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible || this.disposed) return;
    this.visible = visible;
    this.loop.update(this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.visible = false;
    this.renderer = null;
    this.loop.remove(this);
  }

  /** Advances the pose by `dtMs` and paints it. Never throws: a renderer that fails stops drawing. */
  frame(dtMs: number, still: boolean): void {
    if (this.failed || this.disposed) return;
    const ctx = this.surface.getContext('2d');
    if (!ctx) return;
    try {
      const r = (this.renderer ??= this.loop.factory(this.id, seeded(0x9e3779b9 ^ this.id.length * 7919)));
      this.input.reducedMotion = still;
      const drawn = getCharacter(this.id).clips;
      if (still) {
        const s = showStep(0, drawn);
        this.input.clip = s.clip;
        this.input.clipStartedAt = -STILL_START_MS;
        this.input.speed = 0;
        for (let i = 0; i < 12; i++) r.advance(this.input, STILL_START_MS - 12 * 16 + i * 16, 16, 0, 0);
        this.clock = 0;
      } else {
        this.clock += dtMs;
        const s = showStep(this.clock, drawn);
        this.input.clip = s.clip;
        this.input.clipStartedAt = s.startedAt;
        this.input.speed = s.speed;
        r.advance(this.input, this.clock, dtMs, 0, 0);
      }
      this.paint(ctx, r);
    } catch {
      this.failed = true;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.surface.width, this.surface.height);
    }
  }

  private paint(ctx: Ctx2D, r: CharacterRenderer): void {
    const W = this.surface.width;
    const H = this.surface.height;
    if (this.extent === null) this.extent = measureExtent(r);
    const e = this.extent;
    const bw = Math.max(1, e.maxX - e.minX);
    const bh = Math.max(1, e.maxY - e.minY);
    const k = Math.max(0.2, Math.min((W * FILL) / bw, (H * FILL) / bh, 8));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(k, 0, 0, k, W / 2 - ((e.minX + e.maxX) / 2) * k, H / 2 - ((e.minY + e.maxY) / 2) * k);
    r.draw(ctx, { outline: OUTLINE_W, shadow: true, pixelsPerUnit: k, skin: this.skin });
  }
}

/** The drawn extent of the renderer's current pose (local units); a sane box when it reports nothing. */
function measureExtent(r: CharacterRenderer): Extent {
  const e: Extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const take = (x: number, y: number, rx: number, ry: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(rx) || !Number.isFinite(ry)) return;
    e.minX = Math.min(e.minX, x - rx);
    e.maxX = Math.max(e.maxX, x + rx);
    e.minY = Math.min(e.minY, y - ry);
    e.maxY = Math.max(e.maxY, y + ry);
  };
  const g: GeometryCollector = {
    add: (x, y, radius) => take(x, y, radius, radius),
    addGround: (cx, half, rh) => take(cx, 0, half, rh),
  };
  r.measure(g);
  if (!(e.maxX > e.minX) || !(e.maxY > e.minY)) return { minX: -30, minY: -40, maxX: 30, maxY: 4 };
  // A pose can lean further than the first one: leave a little room.
  const padX = (e.maxX - e.minX) * 0.06;
  const padY = (e.maxY - e.minY) * 0.06;
  return { minX: e.minX - padX, minY: e.minY - padY, maxX: e.maxX + padX, maxY: e.maxY + padY };
}

/**
 * The shared loop. It animates while at least one slot is visible, the window is visible and motion is
 * not reduced; otherwise it holds no frame request at all.
 */
export class PreviewLoop {
  private readonly slots = new Set<Slot>();
  private handle: number | null = null;
  private last = Number.NaN;
  readonly factory: RendererFactory;

  constructor(
    private readonly env: PreviewEnv,
    factory: RendererFactory = createCharacterRenderer,
    private readonly fps: number = PREVIEW_FPS,
  ) {
    this.factory = factory;
  }

  /** Adds a preview on `surface`. It stays idle until setVisible(true). */
  create(surface: PreviewSurface, id: CharacterId, skin: string): PreviewSlot {
    const slot = new Slot(this, surface, characterOrDefault(id), skin);
    this.slots.add(slot);
    return slot;
  }

  /** True while previews hold still (reduced motion). */
  get reduced(): boolean {
    return this.env.reducedMotion();
  }

  get running(): boolean {
    return this.handle !== null;
  }

  get slotCount(): number {
    return this.slots.size;
  }

  /** Re-evaluates the run state after the window's visibility or the reduced-motion choice changed. */
  refresh(): void {
    for (const s of this.slots) if (s.visible) this.redraw(s);
    this.sync();
  }

  /** Stops the loop and drops every slot (the pages are being rebuilt or the window closes). */
  dispose(): void {
    this.stop();
    for (const s of [...this.slots]) s.dispose();
    this.slots.clear();
  }

  // ---- used by slots ----------------------------------------------------------------------------

  update(slot: Slot): void {
    if (slot.visible) this.redraw(slot);
    this.sync();
  }

  redraw(slot: Slot): void {
    // A still frame while the loop does not animate; the running loop repaints on its next tick.
    if (slot.visible && !this.animating()) slot.frame(0, true);
  }

  remove(slot: Slot): void {
    this.slots.delete(slot);
    this.sync();
  }

  // ---- internals --------------------------------------------------------------------------------

  private animating(): boolean {
    return !this.env.reducedMotion() && this.env.documentVisible();
  }

  private anyVisible(): boolean {
    for (const s of this.slots) if (s.visible) return true;
    return false;
  }

  private sync(): void {
    if (this.animating() && this.anyVisible()) this.start();
    else this.stop();
  }

  private start(): void {
    if (this.handle !== null) return;
    this.last = Number.NaN;
    this.handle = this.env.raf((t) => this.tick(t));
  }

  private stop(): void {
    if (this.handle === null) return;
    this.env.caf(this.handle);
    this.handle = null;
  }

  private tick(timestamp: number): void {
    this.handle = null;
    if (!this.animating() || !this.anyVisible()) return;
    const interval = 1000 / this.fps;
    if (Number.isNaN(this.last)) this.last = timestamp - interval;
    const elapsed = timestamp - this.last;
    if (elapsed >= interval - 2) {
      const dt = Math.min(MAX_STEP_MS, Math.max(1, elapsed));
      this.last = timestamp;
      for (const s of this.slots) if (s.visible) s.frame(dt, false);
    }
    this.handle = this.env.raf((t) => this.tick(t));
  }
}

/** The browser environment (the only DOM access of this module). */
export function browserPreviewEnv(): PreviewEnv {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  return {
    raf: (cb) => window.requestAnimationFrame(cb),
    caf: (id) => window.cancelAnimationFrame(id),
    documentVisible: () => document.visibilityState !== 'hidden',
    reducedMotion: () => query?.matches === true,
  };
}
