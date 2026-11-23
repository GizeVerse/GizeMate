// Fox palettes. First = default (matches FOX_MODULE.skins). Every outline separates the body from light
// and dark desktops; the dark coats add a light rim (halo) outside the outline.
import type { PendantPalette } from '../../character/kit';

export interface FoxSkin {
  id: string;
  coat: string;
  /** Far legs, far ear base: a slightly darker coat. */
  shade: string;
  outline: string;
  /** Chest, cheeks, muzzle, belly. */
  light: string;
  /** Ear backs. */
  earDark: string;
  earInner: string;
  /** Leg socks and paws. */
  sock: string;
  nose: string;
  eye: string;
  tailTip: string;
  /** The darker saddle shading on the back and the tail (subtle). */
  saddle: string;
  mouth: string;
  tongue: string;
  /** Opaque light rim outside the outline (dark coats on dark wallpapers). */
  halo: string | null;
  pendant: PendantPalette | undefined;
}

const red: FoxSkin = {
  id: 'red',
  coat: '#e0702c',
  shade: '#bd5a22',
  outline: '#4a2411',
  light: '#fff4e6',
  earDark: '#3a2118',
  earInner: '#f6d5b4',
  sock: '#3b241a',
  nose: '#241a18',
  eye: '#1d1411',
  tailTip: '#fffaf0',
  saddle: '#c75f22',
  mouth: '#6b2b2b',
  tongue: '#ef7f8e',
  halo: null,
  pendant: undefined,
};

const arctic: FoxSkin = {
  id: 'arctic',
  coat: '#e3eaf0',
  shade: '#c5d0da',
  outline: '#4d5d6e',
  light: '#ffffff',
  earDark: '#8999aa',
  earInner: '#f6d9dc',
  sock: '#8fa0b2',
  nose: '#262b33',
  eye: '#1b1f27',
  tailTip: '#ffffff',
  saddle: '#d3dde6',
  mouth: '#6d3a44',
  tongue: '#ee8a98',
  halo: null,
  pendant: undefined,
};

const silver: FoxSkin = {
  id: 'silver',
  coat: '#6d7684',
  shade: '#575f6c',
  outline: '#262b35',
  light: '#e9edf2',
  earDark: '#2a2e36',
  earInner: '#b3bac5',
  sock: '#23262d',
  nose: '#15171b',
  eye: '#15171b',
  tailTip: '#f4f6f9',
  saddle: '#5b6370',
  mouth: '#5d3037',
  tongue: '#e57c8c',
  halo: '#e8edf5',
  pendant: undefined,
};

const dusk: FoxSkin = {
  id: 'dusk',
  coat: '#a77bc4',
  shade: '#8a62aa',
  outline: '#352352',
  light: '#fdeaf3',
  earDark: '#42295e',
  earInner: '#f6c9df',
  sock: '#2f1f48',
  nose: '#231634',
  eye: '#1c1228',
  tailTip: '#ffdcae',
  saddle: '#9467b5',
  mouth: '#63284f',
  tongue: '#f08aa6',
  halo: '#f0e6fa',
  pendant: undefined,
};

const SKINS: Readonly<Record<string, FoxSkin>> = { red, arctic, silver, dusk };

/** The palette for an id; anything unknown is the default (the first palette). */
export function getFoxSkin(id: string): FoxSkin {
  return SKINS[id] ?? red;
}

export const FOX_SKIN_IDS: readonly string[] = ['red', 'arctic', 'silver', 'dusk'];
