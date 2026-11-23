// Ghost palettes (one per skin id; the first is the default). Every body is light or mid-toned and every
// outline is dark and saturated enough to separate it from a white window and from a near-black desktop.
export interface GhostPalette {
  body: string;
  outline: string;
  eye: string;
  cheek: string;
  /** Darkening tint used while asleep. */
  shade: string;
  glow: string;
  spark: string;
}

export const GHOST_PALETTES: Readonly<Record<string, GhostPalette>> = Object.freeze({
  pale: { body: '#f3f6ff', outline: '#4a5486', eye: '#1c1a2e', cheek: '#ff9db3', shade: '#7d86b8', glow: '#ffffff', spark: '#fff3b8' },
  mint: { body: '#c4f2de', outline: '#2c6a5a', eye: '#17302b', cheek: '#ff9bb0', shade: '#5f9c8a', glow: '#eafff6', spark: '#fff6c2' },
  lavender: { body: '#dccffb', outline: '#59439a', eye: '#221a3c', cheek: '#ff9fc2', shade: '#8a78c8', glow: '#f4eeff', spark: '#fff3b8' },
  midnight: { body: '#6d74cc', outline: '#1d2152', eye: '#10112a', cheek: '#ffa0c0', shade: '#2d3270', glow: '#aab2ff', spark: '#fff0a8' },
  peach: { body: '#ffdcc9', outline: '#8a4a3c', eye: '#2e1a1a', cheek: '#ff8fa6', shade: '#c98a78', glow: '#fff0e8', spark: '#fff6c2' },
});

export const getGhostPalette = (skin: string): GhostPalette => GHOST_PALETTES[skin] ?? GHOST_PALETTES.pale!;
