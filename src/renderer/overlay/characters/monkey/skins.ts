// Monkey palettes. Every colour is a flat fill; the outline separates the body from any desktop and
// the dark coat gets a thin light halo behind its outline so it survives a dark wallpaper too.
export interface MonkeySkin {
  readonly id: string;
  readonly fur: string;
  readonly furDark: string;
  /** Subtle highlight shape colour (drawn at low alpha). */
  readonly furLight: string;
  /** Lighter belly / chest patch. */
  readonly belly: string;
  /** Face mask. */
  readonly face: string;
  /** Muzzle (a little deeper than the mask). */
  readonly muzzle: string;
  readonly earInner: string;
  /** Hands and feet. */
  readonly hand: string;
  readonly outline: string;
  readonly eye: string;
  readonly eyeHi: string;
  readonly mouth: string;
  readonly tongue: string;
  readonly nose: string;
  readonly blush: string;
  /** Tail tip colour, or null for a plain tail. */
  readonly tailTip: string | null;
  /** Light halo behind the outline (dark coats), or null. */
  readonly halo: string | null;
}

const BASE = {
  eye: '#1d1318',
  eyeHi: '#ffffff',
  mouth: '#5a2a2c',
  tongue: '#e8808a',
  nose: '#4b3128',
} as const;

const BROWN: MonkeySkin = {
  ...BASE,
  id: 'brown',
  fur: '#8b5a3c',
  furDark: '#6a4129',
  furLight: '#b88458',
  belly: '#dcb78c',
  face: '#f0cfa6',
  muzzle: '#e3b98e',
  earInner: '#e8a58c',
  hand: '#e0b58a',
  outline: '#3a2216',
  blush: '#f09a8a',
  tailTip: '#6a4129',
  halo: null,
};

const GOLDEN: MonkeySkin = {
  ...BASE,
  id: 'golden',
  fur: '#dba23f',
  furDark: '#b97a28',
  furLight: '#f4cc6e',
  belly: '#f8e0a0',
  face: '#fbe6bb',
  muzzle: '#f0cf9b',
  earInner: '#eea48a',
  hand: '#efc88d',
  outline: '#5a3912',
  blush: '#f3957f',
  tailTip: '#b97a28',
  halo: null,
};

const GRAY: MonkeySkin = {
  ...BASE,
  id: 'gray',
  fur: '#8a909c',
  furDark: '#686e7b',
  furLight: '#b3b8c3',
  belly: '#d9dce3',
  face: '#eadfd6',
  muzzle: '#dccdc2',
  earInner: '#e4a6a4',
  hand: '#d8c6b8',
  outline: '#2c3039',
  blush: '#eb9aa0',
  tailTip: '#4f5560',
  halo: null,
};

const CREAM: MonkeySkin = {
  ...BASE,
  id: 'cream',
  fur: '#e6d0a2',
  furDark: '#c7ad7e',
  furLight: '#fff1cf',
  belly: '#fff6de',
  face: '#fde8d2',
  muzzle: '#f3d3b4',
  earInner: '#f0a99a',
  hand: '#f0d0ae',
  outline: '#654c31',
  blush: '#f29a8c',
  tailTip: '#c7ad7e',
  halo: null,
};

const BLACK: MonkeySkin = {
  ...BASE,
  id: 'black',
  fur: '#403b47',
  furDark: '#2c2832',
  furLight: '#6a6475',
  belly: '#5b5564',
  face: '#a58f87',
  muzzle: '#8f7a74',
  earInner: '#a9787c',
  hand: '#8d7a76',
  outline: '#0d0b11',
  blush: '#c07b7c',
  tailTip: '#2c2832',
  halo: 'rgba(196,206,236,0.55)',
};

const DEFS: Readonly<Record<string, MonkeySkin>> = { brown: BROWN, golden: GOLDEN, gray: GRAY, cream: CREAM, black: BLACK };

export function getMonkeySkin(id: string): MonkeySkin {
  return DEFS[id] ?? BROWN;
}

export const MONKEY_SKIN_IDS: readonly string[] = Object.keys(DEFS);
