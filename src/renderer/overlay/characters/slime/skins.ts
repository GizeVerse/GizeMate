// Slime palettes: one object per skin id of SLIME_MODULE.skins (first = default). Flat fills with a
// darker core and a brighter highlight; the outline is a deep, saturated shade of the body so the
// silhouette separates from both light and dark desktops.
import { SLIME_MODULE } from '../../../../shared/characters/slime';

export interface SlimePalette {
  /** Body fill. */
  body: string;
  /** Puddle lip and drips (a touch darker than the body). */
  lip: string;
  /** Darker core inside the belly. */
  core: string;
  /** Highlight shapes. */
  light: string;
  /** Exterior outline. */
  outline: string;
  /** Eyes and mouth. */
  eye: string;
  /** Inside of an open mouth. */
  mouth: string;
  cheek: string;
  /** Bubble fill (drawn translucent) and tiny bubbles inside the body. */
  bubble: string;
}

const PALETTES: Readonly<Record<string, SlimePalette>> = {
  lime: { body: '#8ee85a', lip: '#6fd043', core: '#5ec244', light: '#e9ffd0', outline: '#1d5a1c', eye: '#14261a', mouth: '#2a3b27', cheek: '#ff9fb0', bubble: '#d6ffb8' },
  berry: { body: '#d27df0', lip: '#b95fe0', core: '#a455d2', light: '#f8dcff', outline: '#4a1a7a', eye: '#1e1030', mouth: '#33193f', cheek: '#ff8fb8', bubble: '#f3d4ff' },
  ocean: { body: '#5ec8f2', lip: '#3fadde', core: '#3b96d6', light: '#dcf6ff', outline: '#12427a', eye: '#10223a', mouth: '#1c2f4a', cheek: '#ffa7b5', bubble: '#cdeeff' },
  sunset: { body: '#ffb04f', lip: '#f58f35', core: '#f2823a', light: '#fff0c4', outline: '#8a3414', eye: '#2c1810', mouth: '#4a2217', cheek: '#ff7f8f', bubble: '#ffe3b5' },
};

const FALLBACK = PALETTES[SLIME_MODULE.skins[0]!]!;

export function getSlimePalette(skin: string): SlimePalette {
  return PALETTES[skin] ?? FALLBACK;
}
