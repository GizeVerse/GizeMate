// Review fixes: signature actions respect the user's opt-outs and reduced motion, play a locomotion clip
// while travelling, and stay rare (also while typing).
import { describe, expect, it, vi } from 'vitest';
import type { CharacterModule, SignatureAction } from '../../../../src/shared/characters/types';
import type { SimOutput } from '../../../../src/shared/sim';
import type * as RegistryModule_ from '../../../../src/shared/characters/registry';

const overrides = vi.hoisted(() => new Map<string, unknown>()) as Map<string, CharacterModule>;
vi.mock('../../../../src/shared/characters/registry', async (importOriginal) => {
  const original = await importOriginal<typeof RegistryModule_>();
  return { ...original, getCharacter: (id: never) => overrides.get(id) ?? original.getCharacter(id) };
});

import { signatureAllowed } from '../../../../src/core/behavior/character';
import { scoreAll } from '../../../../src/core/behavior/utility';
import { GHOST_MODULE } from '../../../../src/shared/characters/ghost';
import { Harness, decisionView, settingsWith } from './fixtures';

const MIN = 60_000;
const sigOf = (over: Partial<SignatureAction>): SignatureAction => ({ id: 's', clip: 'scan', weight: 1, cooldownMs: 1000, durationMs: [1000, 1500], ...over });

function withModule<T>(m: CharacterModule, fn: () => T): T {
  overrides.set(m.id, m);
  try {
    return fn();
  } finally {
    overrides.delete(m.id);
  }
}
const ghostWith = (signatures: SignatureAction[]): CharacterModule =>
  Object.freeze({ ...GHOST_MODULE, behavior: Object.freeze({ ...GHOST_MODULE.behavior, signatures: Object.freeze(signatures) }) });

function run(seed: number, ms: number, env: Harness['env'] = {}, settings?: ReturnType<typeof settingsWith>) {
  const decisions: Array<{ at: number; variant: string | null; state: string }> = [];
  const h = new Harness({ seed, character: 'ghost', ...(settings ? { settings } : {}), hooks: { onDecision: (r) => decisions.push({ at: r.at, variant: r.variant, state: r.state }) } });
  h.keepOutputs = true;
  h.env = env;
  h.run(ms, 50);
  return { outs: h.outputs, decisions };
}
const sigStarts = (d: Array<{ variant: string | null }>): number => d.filter((x) => x.variant === 'signature').length;

describe('signatureAllowed', () => {
  it('skips signatures whose clip, lead-in or id is a switched-off behaviour', () => {
    expect(signatureAllowed(sigOf({ clip: 'pounce' }), new Set(['pounce']), false)).toBe(false);
    expect(signatureAllowed(sigOf({ clip: 'tailChase' }), new Set(['tailChase']), false)).toBe(false);
    expect(signatureAllowed(sigOf({ clip: 'groom' }), new Set(['grooming']), false)).toBe(false);
    expect(signatureAllowed(sigOf({ clip: 'peek', leadIn: ['groom'] }), new Set(['grooming']), false)).toBe(false);
    expect(signatureAllowed(sigOf({ id: 'zoomies', clip: 'dance', movement: 'random-hop' }), new Set(['zoomies']), false)).toBe(false);
    expect(signatureAllowed(sigOf({ clip: 'pounce' }), new Set(['grooming']), false)).toBe(true);
    expect(signatureAllowed(sigOf({ clip: 'scan' }), new Set(['pounce', 'tailChase', 'grooming', 'zoomies']), false)).toBe(true);
  });
  it('under reduced motion drops travelling and large-amplitude signatures but keeps calm ones and the calm teleport swap', () => {
    const none = new Set<string>();
    expect(signatureAllowed(sigOf({ clip: 'float', movement: 'random-hop' }), none, true)).toBe(false);
    expect(signatureAllowed(sigOf({ clip: 'scan', movement: 'toward-cursor' }), none, true)).toBe(false);
    for (const clip of ['hop', 'bounce', 'dance', 'pounce', 'tailChase', 'rollOver'] as const) expect(signatureAllowed(sigOf({ clip }), none, true), clip).toBe(false);
    expect(signatureAllowed(sigOf({ clip: 'crouch', leadIn: ['hop'] }), none, true)).toBe(false);
    expect(signatureAllowed(sigOf({ clip: 'scan' }), none, true)).toBe(true);
    expect(signatureAllowed(sigOf({ clip: 'confused', movement: 'teleport' }), none, true)).toBe(true);
    expect(signatureAllowed(sigOf({ clip: 'dance' }), none, false)).toBe(true);
  });
});

describe('signatures in the simulation', () => {
  const calm = sigOf({ id: 'calm', clip: 'scan', weight: 6, cooldownMs: 1000, durationMs: [1500, 2000] });
  const dancer = sigOf({ id: 'jig', clip: 'dance', weight: 6, cooldownMs: 1000, durationMs: [1500, 2000] });
  const groomer = sigOf({ id: 'wash', clip: 'groom', weight: 6, cooldownMs: 1000, durationMs: [1500, 2000] });

  it('reduced motion: a large-amplitude signature never starts, a calm one does', () => {
    const bigOnly = withModule(ghostWith([dancer]), () => run(1, 15 * MIN, { reducedMotion: true }));
    expect(sigStarts(bigOnly.decisions)).toBe(0);
    expect(bigOnly.outs.some((o) => o.clip === 'dance')).toBe(false);
    const withCalm = withModule(ghostWith([dancer, calm]), () => run(1, 15 * MIN, { reducedMotion: true }));
    expect(sigStarts(withCalm.decisions)).toBeGreaterThan(0);
    expect(withCalm.outs.some((o) => o.clip === 'dance')).toBe(false);
    // control: without reduced motion the dancer does play
    const free = withModule(ghostWith([dancer]), () => run(1, 15 * MIN));
    expect(free.outs.some((o) => o.clip === 'dance')).toBe(true);
  });

  it('a switched-off behaviour (grooming) blocks the signature that is that behaviour', () => {
    const off = settingsWith({ behavior: { disabledBehaviors: ['grooming'] } as never });
    const blocked = withModule(ghostWith([groomer]), () => run(2, 15 * MIN, {}, off));
    expect(sigStarts(blocked.decisions)).toBe(0);
    const free = withModule(ghostWith([groomer]), () => run(2, 15 * MIN));
    expect(sigStarts(free.decisions)).toBeGreaterThan(0);
  });

  it('a travelling signature shows its locomotion clip while it moves, never the sitting pose', () => {
    const drift = sigOf({ id: 'drift', clip: 'float', weight: 8, cooldownMs: 1000, durationMs: [1000, 1500], movement: 'random-hop' });
    const r = withModule(ghostWith([drift]), () => run(3, 20 * MIN));
    const moving = r.outs.filter((o) => o.state === 'idle' && o.speed > 0.5 && o.support.kind === 'floor');
    expect(moving.length).toBeGreaterThan(5);
    for (const o of moving) expect(o.clip, `speed ${o.speed}`).not.toBe('sit');
  });
});

describe('signatures stay rare', () => {
  const view = (extra: Partial<Parameters<typeof decisionView>[0]>) =>
    decisionView({ character: { restBias: 1, exploreBias: 1, playBias: 1, cursorInterest: 1, shyness: 1, signatures: [{ id: 'x', weight: 1 }] }, ...extra });
  const score = (extra: Partial<Parameters<typeof decisionView>[0]>): number => scoreAll(view(extra)).find((c) => c.item.variant === 'signature')?.score ?? 0;

  it('typing, fast window switching and video each lower a signature score (never raise it)', () => {
    const base = score({});
    expect(base).toBeGreaterThan(0);
    expect(score({ typing: true, typingRaw: true })).toBeLessThan(0.5 * base);
    expect(score({ typing: false, typingRaw: true })).toBeLessThan(0.5 * base);
    expect(score({ busySwitching: true })).toBeLessThan(0.5 * base);
    expect(score({ mediaForeground: true })).toBeLessThan(base);
  });

  it('real ghost, seeded 40 simulated minutes: signatures are a small share of decisions, and typing does not raise the rate', () => {
    let calmStarts = 0;
    let typingStarts = 0;
    for (const seed of [11, 12, 13]) {
      const a = run(seed, 40 * MIN);
      const b = run(seed, 40 * MIN, { typing: true, typingIntensity: 1 });
      expect(sigStarts(a.decisions) / Math.max(1, a.decisions.length), `seed ${seed}`).toBeLessThan(0.2);
      expect(sigStarts(b.decisions) / Math.max(1, b.decisions.length), `seed ${seed} typing`).toBeLessThan(0.2);
      calmStarts += sigStarts(a.decisions);
      typingStarts += sigStarts(b.decisions);
    }
    expect(typingStarts).toBeLessThanOrEqual(calmStarts);
  });
});

describe('character voice cues are not world sounds', () => {
  const petted = (sound: { cat: boolean; world: boolean }, cue: 'chime' | 'squeak'): SimOutput[] => {
    const mod = Object.freeze({ ...GHOST_MODULE, reactions: Object.freeze({ petted: { clip: 'squish' as const, sound: cue } }) });
    const settings = settingsWith({ sound: { enabled: true, volume: 0.5, ...sound } });
    return withModule(mod, () => {
      const h = new Harness({ seed: 4, character: 'ghost', settings });
      h.keepOutputs = true;
      h.run(30_000, 33);
      h.run(8000, 33, (hh, i) => (i % 9 === 0 ? [{ type: 'pointer.pet', at: { x: hh.last?.x ?? 0, y: (hh.last?.y ?? 0) - 30 }, strength: 0.9 }] : []));
      return h.outputs;
    });
  };
  it.each(['chime', 'squeak'] as const)('%s as a reaction voice plays with cat sounds on and world sounds off', (cue) => {
    const outs = petted({ cat: true, world: false }, cue);
    expect(outs.some((o) => o.sound !== null && o.sound !== undefined)).toBe(true);
    expect(outs.some((o) => o.sound?.kind === cue)).toBe(true);
  });
  it.each(['chime', 'squeak'] as const)('%s as a reaction voice is silent with cat sounds off, even when world sounds are on', (cue) => {
    const outs = petted({ cat: false, world: true }, cue);
    expect(outs.some((o) => o.sound?.kind === cue)).toBe(false);
  });
});
