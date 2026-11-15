// Turkish catalogue: mirrors en.ts exactly (a missing or extra key is a compile error).
import type { en } from './en';
import { alienTr } from './characters/alien';
import { catTr } from './characters/cat';
import { foxTr } from './characters/fox';
import { ghostTr } from './characters/ghost';
import { monkeyTr } from './characters/monkey';
import { rabbitTr } from './characters/rabbit';
import { slimeTr } from './characters/slime';
import { systemTr } from './system';

type Mirror<T> = { [K in keyof T]: T[K] extends string ? string : Mirror<T[K]> };

export const tr: Mirror<typeof en> = {
  ...systemTr,
  product: {
    name: 'GizeMate',
  },
  character: {
    cat: catTr,
    monkey: monkeyTr,
    fox: foxTr,
    rabbit: rabbitTr,
    ghost: ghostTr,
    slime: slimeTr,
    alien: alienTr,
  },
};
