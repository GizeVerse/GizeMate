// Alien palettes, one per skin id of the module (first = default). Flat fills; the outline is a dark
// shade of the body hue so the figure separates from light and dark desktops alike, and the
// antenna glow colour is bright and saturated.
export interface AlienPalette {
  body: string;
  /** Slightly lighter patch (belly, forehead shine). */
  light: string;
  /** Slightly darker (inner limb, mouth line). */
  shade: string;
  outline: string;
  eye: string;
  glint: string;
  glow: string;
  glowDim: string;
  mouth: string;
}

export const PALETTES: Readonly<Record<string, AlienPalette>> = {
  green: { body: '#97c9a1', light: '#c4e6c9', shade: '#6ea67c', outline: '#1d3b30', eye: '#0a0f12', glint: '#ffffff', glow: '#c6ff4d', glowDim: '#6f8f3c', mouth: '#24402f' },
  blue: { body: '#8fbce3', light: '#c2dcf3', shade: '#6a97c4', outline: '#1b3350', eye: '#0a0e14', glint: '#ffffff', glow: '#5fe6ff', glowDim: '#3f8aa0', mouth: '#1f3550' },
  violet: { body: '#b9a2e6', light: '#dccff5', shade: '#9179c6', outline: '#37265f', eye: '#0c0a14', glint: '#ffffff', glow: '#ff8fe8', glowDim: '#9c5a92', mouth: '#3a2a63' },
  silver: { body: '#cbd5de', light: '#eef2f6', shade: '#a0adb9', outline: '#2b3643', eye: '#0a0d12', glint: '#ffffff', glow: '#ffd84a', glowDim: '#9a8433', mouth: '#2f3a48' },
};

export const DEFAULT_PALETTE: AlienPalette = PALETTES.green!;

export function getPalette(skin: string): AlienPalette {
  return Object.prototype.hasOwnProperty.call(PALETTES, skin) ? (PALETTES[skin] as AlienPalette) : DEFAULT_PALETTE;
}
