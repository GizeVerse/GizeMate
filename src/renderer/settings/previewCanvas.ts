// A preview canvas bound to the shared loop: the DOM half of previews.ts.
import type { CharacterId } from '../../shared/characters/registry';
import type { PageContext } from './context';
import { h } from './dom';
import type { PreviewSlot } from './previews';

/** Backing size of a preview canvas (CSS scales it); small on purpose. */
const WIDTH = 240;
const HEIGHT = 180;

export interface PreviewCanvas {
  readonly element: HTMLCanvasElement;
  readonly slot: PreviewSlot;
}

/** A decorative canvas (hidden from assistive technology; the card or heading carries the name). */
export function previewCanvas(ctx: Pick<PageContext, 'previews'>, id: CharacterId, skin: string, cls = 'preview-canvas', width = WIDTH, height = HEIGHT): PreviewCanvas {
  const element = h('canvas', { class: cls, width, height, 'aria-hidden': 'true' });
  return { element, slot: ctx.previews.create(element, id, skin) };
}
