// English catalogue: the source of truth for the key set. The i18n agent grows it to cover every
// user-facing string; character copy lives in ./characters/<id>.ts and is merged here.
import { alienEn } from './characters/alien';
import { catEn } from './characters/cat';
import { foxEn } from './characters/fox';
import { ghostEn } from './characters/ghost';
import { monkeyEn } from './characters/monkey';
import { rabbitEn } from './characters/rabbit';
import { slimeEn } from './characters/slime';

export const en = {
  product: {
    /** The temporary product name (the single display-name source is src/shared/brand.ts; this key mirrors it for UI copy). */
    name: 'GizeMate',
  },
  character: {
    cat: catEn,
    monkey: monkeyEn,
    fox: foxEn,
    rabbit: rabbitEn,
    ghost: ghostEn,
    slime: slimeEn,
    alien: alienEn,
  },
};
