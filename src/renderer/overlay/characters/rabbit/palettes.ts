// Rabbit palettes: one object per skin id of the module (first = default). Flat fills, a dark outline
// that separates the body from light and dark desktops, soft pink inner ears and nose.

export interface RabbitPalette {
  fur: string;
  /** Far-side limbs and the haunch swirl. */
  shade: string;
  /** Muzzle, belly, tail. */
  belly: string;
  earInner: string;
  nose: string;
  outline: string;
  eye: string;
  blush: string;
  tail: string;
  /** Patch colour (spotted coat), absent for solid coats. */
  spot?: string;
}

const WHITE: RabbitPalette = {
  fur: '#f6f1ea',
  shade: '#dcd2c8',
  belly: '#fffaf3',
  earInner: '#f4b6c2',
  nose: '#ee8fa3',
  outline: '#4d3f4c',
  eye: '#2a2230',
  blush: '#f6a9b6',
  tail: '#ffffff',
};

const BROWN: RabbitPalette = {
  fur: '#b0794f',
  shade: '#8d5c38',
  belly: '#ecd3b2',
  earInner: '#ebaaa3',
  nose: '#c9706a',
  outline: '#47291a',
  eye: '#24181a',
  blush: '#e48f84',
  tail: '#f6e6cf',
};

const GRAY: RabbitPalette = {
  fur: '#a1aab5',
  shade: '#818b99',
  belly: '#e3e7ec',
  earInner: '#e9b9c4',
  nose: '#d98c9b',
  outline: '#30384a',
  eye: '#1f2430',
  blush: '#e8a1ac',
  tail: '#f4f6f9',
};

const SPOTTED: RabbitPalette = {
  fur: '#f7f2ea',
  shade: '#ddd3c8',
  belly: '#fffaf3',
  earInner: '#f2b2bd',
  nose: '#e58597',
  outline: '#4a3a3a',
  eye: '#241c22',
  blush: '#f4a4b0',
  tail: '#ffffff',
  spot: '#7b5a44',
};

const PALETTES: Readonly<Record<string, RabbitPalette>> = { white: WHITE, brown: BROWN, gray: GRAY, spotted: SPOTTED };

/** The palette of a skin id; anything unknown is the default (white). */
export function getPalette(skin: string): RabbitPalette {
  return PALETTES[skin] ?? WHITE;
}

export const PALETTE_IDS: readonly string[] = Object.keys(PALETTES);
