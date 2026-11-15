// Alien: STARTER renderer. Until the character agent authors the real one, this draws the cat's renderer so the
// app keeps working with the id selected. Replace the body of createAlienRenderer; keep the export name and signature.
import { createCatRenderer } from '../../character/catRenderer';
import type { CharacterRenderer } from '../../character/types';

export function createAlienRenderer(random: () => number): CharacterRenderer {
  return createCatRenderer(random);
}
