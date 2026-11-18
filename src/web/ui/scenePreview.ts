// A live preview of one character on a small canvas, drawn by its REAL renderer through CatScene (the same
// path the overlay and the in-app cat use: createCharacterRenderer(id, random) behind the scene). It is
// driven by the shared loop (previewLoop.ts), never by a loop of its own, so dispose() only has to drop
// references. No DOM access beyond the canvas it is given; no timers.
import type { AnimClip, CatRenderState } from '../../shared/cat';
import { getCharacter, type CharacterId } from '../../shared/characters/registry';
import { CatScene } from '../../renderer/overlay/scene';
import type { PreviewItem } from './previewLoop';

/** The preview's drawing area in CSS px (the canvas is scaled by the device pixel ratio, at most 2). */
export const PREVIEW_W = 132;
export const PREVIEW_H = 108;
/** What an idle companion does in a preview, one step at a time. */
const CYCLE: readonly AnimClip[] = ['stand', 'sit', 'stand', 'groom', 'sit', 'yawn'];
const STEP_MS = 4000;
const T0 = 1000;

/** Whether the canvas is laid out and shown (a hidden tab or a detached page has no client rects). Lenient where the DOM cannot say. */
export function canvasShown(canvas: HTMLCanvasElement): boolean {
  if (canvas.isConnected === false) return false;
  if (typeof canvas.getClientRects !== 'function') return true;
  return canvas.getClientRects().length > 0;
}

export interface ScenePreview extends PreviewItem {
  setSkin(skin: string): void;
  dispose(): void;
}

export function createScenePreview(canvas: HTMLCanvasElement, id: CharacterId, skin: string, random: () => number = Math.random): ScenePreview {
  const dpr = Math.max(1, Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
  canvas.width = Math.round(PREVIEW_W * dpr);
  canvas.height = Math.round(PREVIEW_H * dpr);
  const ctx = canvas.getContext('2d');
  const body = getCharacter(id).body;
  const scale = Math.max(0.3, Math.min((PREVIEW_W * 0.78) / body.widthDip, (PREVIEW_H * 0.78) / body.heightDip));
  // Built lazily (the first still or frame), so a preview that is never shown never builds a renderer.
  let scene: CatScene | null = null;
  /** A renderer threw: this preview draws nothing more (never takes the page down). */
  let failed = false;
  let currentSkin = skin;
  let seq = 0;
  let lastStep = -1;
  let stepStart = 0;
  let snapNext = true;

  const stateFor = (clip: AnimClip, t: number, started: number): CatRenderState => ({
    seq: (seq += 1),
    t: T0 + t,
    x: PREVIEW_W / 2,
    y: PREVIEW_H * 0.88,
    snap: false,
    scale,
    facing: 1,
    state: 'idle',
    clip,
    clipStartedAt: T0 + started,
    speed: 0,
    vy: 0,
    look: null,
    arousal: 0.2,
    contentment: 0.6,
    emote: null,
    emoteStartedAt: 0,
    opacity: 1,
    visible: true,
    skin: currentSkin,
    style: 'smooth',
    shadow: true,
    animSpeed: 1,
    character: id,
  });

  const paint = (clip: AnimClip, t: number, started: number, dt: number): void => {
    if (!ctx || failed) return;
    if (!scene) {
      scene = new CatScene(random);
      snapNext = true;
    }
    const s = stateFor(clip, t, started);
    scene.update({ x: s.x, y: s.y, state: s, simTime: T0 + t, dtMs: dt, snapped: snapNext });
    snapNext = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    scene.draw(ctx, dpr, null);
  };

  const stillFrame = (): void => {
    // A calm standing pose after a short settle, for reduced motion and the first paint.
    if (!ctx || failed) return;
    try {
      scene = new CatScene(random);
      snapNext = true;
      paint('stand', 0, 0, 0);
      paint('stand', 500, 0, 500);
      paint('stand', 1000, 0, 500);
    } catch {
      failed = true;
    }
    // The animated run starts from a fresh scene (built by its first frame): its clock never runs backwards from the settle above.
    scene = null;
    snapNext = true;
    lastStep = -1;
  };

  return {
    frame(timeMs, dtMs) {
      if (failed) return;
      const step = Math.floor(timeMs / STEP_MS);
      if (step !== lastStep) {
        lastStep = step;
        stepStart = timeMs;
      }
      try {
        paint(CYCLE[step % CYCLE.length] ?? 'stand', timeMs, stepStart, dtMs);
      } catch {
        failed = true;
      }
    },
    still: stillFrame,
    visible: () => canvasShown(canvas),
    setSkin(next) {
      if (next === currentSkin) return;
      currentSkin = next;
      stillFrame();
    },
    dispose() {
      scene = null;
    },
  };
}
