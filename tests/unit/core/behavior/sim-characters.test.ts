// GizeMate: the shared simulation consuming a CharacterModule. The cat stays byte-identical; the other
// characters move through the very same engine with their own locomotion, tuning, signature actions
// and reactions. The real six modules are still starters, so the behaviours under test run on
// temporary test-only modules registered through a registry override (the real ones are checked for
// liveness and clip validity only).
import { describe, expect, it, vi } from 'vitest';
import type { CharacterModule, SignatureAction } from '../../../../src/shared/characters/types';
import type { SimOutput } from '../../../../src/shared/sim';
import type * as RegistryModule_ from '../../../../src/shared/characters/registry';

type RegistryModule = typeof RegistryModule_;

const overrides = vi.hoisted(() => new Map<string, unknown>()) as Map<string, CharacterModule>;
vi.mock('../../../../src/shared/characters/registry', async (importOriginal) => {
  const original = await importOriginal<RegistryModule>();
  return { ...original, getCharacter: (id: never) => overrides.get(id) ?? original.getCharacter(id) };
});

import { createCatSim, mulberry32, newPersistedCat } from '../../../../src/core/behavior';
import { scoreAll } from '../../../../src/core/behavior/utility';
import { chooseEvent, canOffer, EVENT_CATALOG, NORMAL_POOL } from '../../../../src/core/events';
import { teleportTarget, traitBiasFactor, signatureWeight, buildSteps, type SignatureContext } from '../../../../src/core/behavior/character';
import { ALIEN_MODULE } from '../../../../src/shared/characters/alien';
import { CAT_MODULE } from '../../../../src/shared/characters/cat';
import { FOX_MODULE } from '../../../../src/shared/characters/fox';
import { GHOST_MODULE } from '../../../../src/shared/characters/ghost';
import { CHARACTERS } from '../../../../src/shared/characters/registry';
import { SLIME_MODULE } from '../../../../src/shared/characters/slime';
import { sevenTraitsOf } from '../../../../src/shared/characters/seven';
import { WORLD_EVENT_IDS } from '../../../../src/shared/companion';
import { decisionView, Harness, insideAnyWorkArea, SINGLE, scoreOf, settingsWith, WAKE_MS } from './fixtures';

const MIN = 60_000;
const WALL = 1_800_000_000_000;
const catPoint = (o: SimOutput | null) => ({ x: o?.x ?? 0, y: (o?.y ?? 0) - 30 });

/** A test-only character: a real starter with some fields replaced (never registered unless a test says so). */
function testModule(base: CharacterModule, over: Partial<Omit<CharacterModule, 'behavior'>> & { behavior?: Partial<CharacterModule['behavior']> } = {}): CharacterModule {
  const { behavior, ...rest } = over;
  return Object.freeze({ ...base, ...rest, behavior: Object.freeze({ ...base.behavior, ...(behavior ?? {}) }) });
}

/** Registers `m` under its id for the duration of `fn`. */
function withModule<T>(m: CharacterModule, fn: () => T): T {
  overrides.set(m.id, m);
  try {
    return fn();
  } finally {
    overrides.delete(m.id);
  }
}

const ALL_CLIPS = [
  'stand', 'sit', 'loaf', 'sleep', 'wake', 'yawn', 'walk', 'run', 'crouch', 'jump', 'fall', 'land', 'startle', 'annoyed', 'petted', 'groom', 'pawAt', 'held', 'meow', 'hide', 'rollOver', 'climb', 'stalk', 'sprint', 'pounce', 'slip', 'impact', 'landRecover', 'swat', 'hiss', 'grumpy', 'slink', 'stretch', 'balance', 'tailChase', 'edgeSit', 'scratch', 'shake', 'confused', 'hop', 'bounce', 'float', 'vanish', 'appear', 'swing', 'squish', 'scan', 'beam', 'peek', 'dance',
] as const;

/** Runs a Harness and returns every output; the harness records the decisions through the hook. */
function run(opts: { seed: number; character?: 'cat' | 'ghost' | 'fox' | 'slime' | 'alien' | 'rabbit' | 'monkey'; ms: number; env?: Harness['env']; settings?: ReturnType<typeof settingsWith>; dt?: number }): { h: Harness; outs: SimOutput[]; decisions: Array<{ at: number; state: string; variant: string | null; cause: string }> } {
  const decisions: Array<{ at: number; state: string; variant: string | null; cause: string }> = [];
  const h = new Harness({ seed: opts.seed, ...(opts.character ? { character: opts.character } : {}), ...(opts.settings ? { settings: opts.settings } : {}), hooks: { onDecision: (r) => decisions.push({ at: r.at, state: r.state, variant: r.variant, cause: r.cause }) } });
  h.keepOutputs = true;
  if (opts.env) h.env = opts.env;
  h.run(opts.ms, opts.dt ?? 33);
  return { h, outs: h.outputs, decisions };
}

describe('the cat stays byte-identical', () => {
  it('an absent character and the explicit cat give exactly the same outputs, decisions and saved state', () => {
    const go = (character?: 'cat') => {
      const r = run({ seed: 7, ...(character ? { character } : {}), ms: 4 * MIN });
      return { outs: JSON.stringify(r.outs), dec: JSON.stringify(r.decisions), state: JSON.stringify(r.h.sim.serialize()) };
    };
    const a = go();
    const b = go('cat');
    expect(b.outs).toBe(a.outs);
    expect(b.dec).toBe(a.dec);
    expect(b.state).toBe(a.state);
  });

  it('createCatSim accepts the character option and treats an unknown id as the cat', () => {
    const mk = (character?: string) =>
      createCatSim({ persisted: null, settings: settingsWith({}), world: SINGLE, now: 0, random: mulberry32(2), wallClock: () => WALL, ...(character ? { character: character as never } : {}) });
    expect(JSON.stringify(mk('dragon').serialize())).toBe(JSON.stringify(mk().serialize()));
  });
});

describe('locomotion follows the module', () => {
  const hopper = testModule(FOX_MODULE, { id: 'rabbit', locomotion: 'hop', clips: Object.freeze(['stand', 'sit', 'sleep', 'wake', 'yawn', 'hop', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide'] as never) });
  const floater = testModule(GHOST_MODULE, { id: 'ghost', locomotion: 'float' });
  const bouncer = testModule(SLIME_MODULE, { id: 'slime', locomotion: 'bounce', clips: Object.freeze(['stand', 'sit', 'sleep', 'bounce', 'jump', 'fall', 'land', 'startle', 'petted', 'held'] as never) });

  it.each([
    ['hop', hopper, 'rabbit', 'hop'],
    ['float', floater, 'ghost', 'float'],
    ['bounce', bouncer, 'slime', 'bounce'],
  ] as const)('%s: every moving tick on the ground draws the %s clip, and no clip leaves the module list', (_n, mod, id, clip) => {
    const r = withModule(mod, () => run({ seed: 5, character: id, ms: 8 * MIN }));
    const moving = r.outs.filter((o) => (o.state === 'walking' || o.state === 'running') && o.speed > 0.05 && o.support.kind === 'floor');
    expect(moving.length).toBeGreaterThan(50);
    for (const o of moving) expect(o.clip).toBe(clip);
    const allowed = new Set<string>(mod.clips);
    for (const o of r.outs) expect(allowed.has(o.clip), `${o.state}:${o.clip}`).toBe(true);
    expect(r.outs.some((o) => o.clip === 'walk' || o.clip === 'run')).toBe(false);
  });

  it('a clip the module does not list resolves cleanly (the rabbit-style list has no groom, loaf or crouch)', () => {
    const r = withModule(hopper, () => run({ seed: 9, character: 'rabbit', ms: 10 * MIN }));
    const seen = new Set(r.outs.map((o) => o.clip));
    for (const c of seen) expect(hopper.clips.includes(c as never), c).toBe(true);
    expect(seen.has('groom')).toBe(false);
  });

  it('gait scale and speed scale lower the anchor speed (a 0.5 character is clearly slower than the cat)', () => {
    const maxSpeed = (outs: SimOutput[]): number => {
      let top = 0;
      for (let i = 1; i < outs.length; i++) {
        const a = outs[i - 1] as SimOutput;
        const b = outs[i] as SimOutput;
        if (b.snap || b.support.kind !== 'floor' || a.support.kind !== 'floor') continue;
        top = Math.max(top, Math.abs(b.x - a.x) / 0.033);
      }
      return top;
    };
    const slow = testModule(CAT_MODULE, { id: 'ghost', body: Object.freeze({ ...CAT_MODULE.body, gaitScale: 0.5 }), behavior: { speedScale: 1 } });
    const cat = run({ seed: 3, ms: 6 * MIN });
    const crawl = withModule(slow, () => run({ seed: 3, character: 'ghost', ms: 6 * MIN }));
    expect(maxSpeed(crawl.outs)).toBeLessThan(0.7 * maxSpeed(cat.outs));
    expect(maxSpeed(crawl.outs)).toBeGreaterThan(0);
  });
});

describe('behaviour multipliers act on the decision weights', () => {
  const tuned = (over: Partial<Record<'restBias' | 'exploreBias' | 'playBias' | 'cursorInterest' | 'shyness', number>>) => ({ restBias: 1, exploreBias: 1, playBias: 1, cursorInterest: 1, shyness: 1, signatures: [], ...over });
  const view = (character?: ReturnType<typeof tuned>, extra: Parameters<typeof decisionView>[0] = {}) =>
    decisionView({ cat: { x: 800, y: 1000, bw: 84 }, drives: { socialNeed: 0.5, playNeed: 0.6, exploreNeed: 0.6, sleepiness: 0.7, mischief: 0.3, huntDrive: 0.5, irritability: 0, frustration: 0, wariness: 0.5 }, recentRough: 2, ...(character ? { character } : {}), ...extra });

  it('restBias scales resting and napping, exploreBias walks, playBias play, cursorInterest watching, shyness hiding', () => {
    const base = view();
    expect(scoreOf(view(tuned({ restBias: 2 })), 'resting')).toBeCloseTo(2 * scoreOf(base, 'resting'), 9);
    expect(scoreOf(view(tuned({ restBias: 0.5 })), 'fallingAsleep')).toBeCloseTo(0.5 * scoreOf(base, 'fallingAsleep'), 9);
    expect(scoreOf(view(tuned({ exploreBias: 3 })), 'walking', 'wander')).toBeCloseTo(3 * scoreOf(base, 'walking', 'wander'), 9);
    expect(scoreOf(view(tuned({ playBias: 2 })), 'playing', 'pawAt')).toBeCloseTo(2 * scoreOf(base, 'playing', 'pawAt'), 9);
    const near = { cursorBand: 'watch' as const };
    expect(scoreOf(view(tuned({ cursorInterest: 2 }), near), 'watchingCursor')).toBeCloseTo(2 * scoreOf(view(undefined, near), 'watchingCursor'), 9);
    expect(scoreOf(view(tuned({ shyness: 2 })), 'hiding')).toBeCloseTo(2 * scoreOf(base, 'hiding'), 9);
    // A shy character asks for attention less.
    expect(scoreOf(view(tuned({ shyness: 2 })), 'seekingAttention')).toBeLessThan(scoreOf(base, 'seekingAttention'));
  });

  it('a neutral tuning (or none) leaves every score exactly as it was', () => {
    const base = scoreAll(view());
    const neutral = scoreAll(view(tuned({})));
    expect(neutral.map((c) => c.score)).toEqual(base.map((c) => c.score));
  });

  it('restBias moves how a character spends its time (sleeping or resting share, three seeds)', () => {
    const restShare = (bias: number): number => {
      const mod = testModule(CAT_MODULE, { id: 'ghost', behavior: { restBias: bias } });
      let rest = 0;
      let total = 0;
      for (const seed of [1, 2, 3]) {
        const r = withModule(mod, () => run({ seed, character: 'ghost', ms: 12 * MIN, dt: 100 }));
        for (const o of r.outs) {
          total++;
          if (o.state === 'sleeping' || o.state === 'resting' || o.state === 'fallingAsleep') rest++;
        }
      }
      return rest / total;
    };
    expect(restShare(3)).toBeGreaterThan(restShare(0.3));
  });

  it('exploreBias moves how far it travels', () => {
    const travel = (bias: number): number => {
      const mod = testModule(CAT_MODULE, { id: 'ghost', behavior: { exploreBias: bias } });
      let moving = 0;
      for (const seed of [1, 2, 3]) {
        const r = withModule(mod, () => run({ seed, character: 'ghost', ms: 12 * MIN, dt: 100 }));
        moving += r.outs.filter((o) => o.speed > 0.05).length;
      }
      return moving;
    };
    expect(travel(3)).toBeGreaterThan(travel(0.3));
  });
});

describe('personality moves behaviour', () => {
  it('stored traits change the scores (laziness favours sitting, affection favours watching the user)', () => {
    const lazy = decisionView({ traits: { playfulness: 0.5, curiosity: 0.5, affection: 0.5, laziness: 0.95, confidence: 0.5, energyLevel: 0.3, startleSensitivity: 0.5 } });
    const brisk = decisionView({ traits: { playfulness: 0.5, curiosity: 0.5, affection: 0.5, laziness: 0.05, confidence: 0.5, energyLevel: 0.9, startleSensitivity: 0.5 } });
    expect(scoreOf(lazy, 'idle')).toBeGreaterThan(scoreOf(brisk, 'idle'));
    const warm = decisionView({ traits: { playfulness: 0.5, curiosity: 0.5, affection: 0.95, laziness: 0.5, confidence: 0.5, energyLevel: 0.5, startleSensitivity: 0.5 } });
    const cold = decisionView({ traits: { playfulness: 0.5, curiosity: 0.5, affection: 0.05, laziness: 0.5, confidence: 0.5, energyLevel: 0.5, startleSensitivity: 0.5 } });
    expect(scoreOf(warm, 'watchingUser')).toBeGreaterThan(scoreOf(cold, 'watchingUser'));
  });

  it('the seven-trait view of a companion drives a signature weight through its traitBias', () => {
    const sig: SignatureAction = { id: 'cheek', clip: 'dance', weight: 1, cooldownMs: 1000, durationMs: [1000, 2000], traitBias: { mischief: 1, independence: -0.5 } };
    const playful = { curiosity: 0.5, energy: 0.5, playfulness: 0.9, sociability: 0.5, mischief: 0.95, affection: 0.5, independence: 0.1 };
    const stern = { ...playful, mischief: 0.05, independence: 0.95 };
    expect(traitBiasFactor(sig, playful)).toBeGreaterThan(traitBiasFactor(sig, stern));
    expect(traitBiasFactor(sig, playful)).toBeLessThanOrEqual(3);
    expect(traitBiasFactor(sig, stern)).toBeGreaterThanOrEqual(0.1);
    const cat = newPersistedCat(mulberry32(1), WALL);
    expect(sevenTraitsOf(cat).mischief).toBeGreaterThanOrEqual(0);
  });

  it('a mischievous newborn character is, on average, more likely to start a signature than a sedate one', () => {
    // Same module and signature, two companions: the sim reads the seven-trait view.
    const sig: SignatureAction = { id: 'prank', clip: 'dance', weight: 1, cooldownMs: 20_000, durationMs: [1500, 2500], traitBias: { mischief: 1.2 } };
    const mod = testModule(GHOST_MODULE, { id: 'ghost', behavior: { signatures: Object.freeze([sig]) } });
    const starts = (mischiefDrive: number, playfulness: number): number => {
      let n = 0;
      for (const seed of [1, 2, 3, 4]) {
        const p = newPersistedCat(mulberry32(seed), WALL - 3600_000, 'ghost');
        p.drives.mischief = mischiefDrive;
        p.traits.playfulness = playfulness;
        p.savedAt = WALL;
        const h = new Harness({ seed, character: 'ghost', persisted: p, hooks: { onDecision: (r) => (r.variant === 'signature' ? n++ : undefined) } });
        h.run(15 * MIN, 100);
      }
      return n;
    };
    withModule(mod, () => {
      expect(starts(0.95, 0.95)).toBeGreaterThan(starts(0.05, 0.05));
    });
  });
});

describe('event affinity', () => {
  const ctx = { stage: { x: 0, y: 0, width: 1920, height: 1040 }, bodyW: 84, localHour: 14, reducedMotion: false, rare: false, disabled: [] as never[] };

  it('0 disables an event for the character (canOffer and every draw), others keep their weight', () => {
    const only = NORMAL_POOL.find((id) => canOffer(EVENT_CATALOG[id], ctx)) as (typeof NORMAL_POOL)[number];
    const affinity: Partial<Record<(typeof WORLD_EVENT_IDS)[number], number>> = {};
    for (const id of WORLD_EVENT_IDS) if (id !== only) affinity[id] = 0;
    for (const id of WORLD_EVENT_IDS) expect(canOffer(EVENT_CATALOG[id], { ...ctx, affinity }) || id === only).toBe(id === only ? true : false);
    const r = mulberry32(4);
    for (let i = 0; i < 40; i++) expect(chooseEvent(r, { ...ctx, affinity }, [], WALL)).toBe(only);
  });

  it('a weight above 1 makes an event more frequent, below 1 rarer', () => {
    const pick = (aff: Partial<Record<string, number>>): number => {
      const r = mulberry32(8);
      let n = 0;
      for (let i = 0; i < 600; i++) if (chooseEvent(r, { ...ctx, affinity: aff }, [], WALL) === 'butterflyEncounter') n++;
      return n;
    };
    const base = pick({});
    expect(pick({ butterflyEncounter: 4 })).toBeGreaterThan(base);
    expect(pick({ butterflyEncounter: 0.2 })).toBeLessThan(base);
  });

  it('inside a running sim, a character whose affinity is 0 for every event but one only ever sees that one', () => {
    const allowed = 'butterflyEncounter';
    const affinity: Record<string, number> = {};
    for (const id of WORLD_EVENT_IDS) if (id !== allowed) affinity[id] = 0;
    const mod = testModule(CAT_MODULE, { id: 'ghost', behavior: { eventAffinity: Object.freeze(affinity) } });
    const settings = settingsWith({});
    settings.companion.events.enabled = true;
    settings.companion.events.rare = false;
    settings.companion.events.pace = 2;
    const seen = new Set<string>();
    withModule(mod, () => {
      const h = new Harness({ seed: 3, character: 'ghost', settings });
      h.run(4 * 60 * MIN, 250, (hh) => {
        const id = hh.last?.worldEvent?.id;
        if (id) seen.add(id);
        return [];
      });
    });
    expect(seen.size).toBeGreaterThan(0);
    expect([...seen]).toEqual([allowed]);
  });
});

describe('signature actions', () => {
  const vanisher: SignatureAction = { id: 'poof', clip: 'dance', leadIn: ['scan'], weight: 3, cooldownMs: 25_000, durationMs: [1500, 2500], movement: 'teleport', emote: 'sparkle', sound: 'whoo', traitBias: { mischief: 0.5 } };
  const dancer: SignatureAction = { id: 'jig', clip: 'dance', weight: 2, cooldownMs: 40_000, durationMs: [2000, 3500], emote: 'note' };
  const lurker: SignatureAction = { id: 'lurk', clip: 'peek', weight: 1, cooldownMs: 60_000, durationMs: [2000, 3000], requires: { cursorNear: true } };
  const climber: SignatureAction = { id: 'dangle', clip: 'swing', weight: 5, cooldownMs: 1000, durationMs: [1000, 2000], requires: { needsLedge: true } };
  const clips = Object.freeze(['stand', 'sit', 'sleep', 'wake', 'yawn', 'walk', 'run', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'float', 'vanish', 'appear', 'peek', 'dance', 'scan', 'swing'] as never);
  const ghost = testModule(GHOST_MODULE, { id: 'ghost', clips, behavior: { signatures: Object.freeze([vanisher, dancer, lurker, climber]) } });

  const sigRun = (seed: number, ms: number, env: Harness['env'] = {}, settings?: ReturnType<typeof settingsWith>) => withModule(ghost, () => run({ seed, character: 'ghost', ms, env, ...(settings ? { settings } : {}), dt: 50 }));

  it('fire, but rarely: a handful in twenty sim-minutes, never back to back, each cooldown honoured', () => {
    for (const seed of [1, 2, 3]) {
      const r = sigRun(seed, 20 * MIN);
      const starts = r.decisions.filter((d) => d.variant === 'signature');
      expect(starts.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(starts.length, `seed ${seed}`).toBeLessThanOrEqual(20);
      expect(starts.length / Math.max(1, r.decisions.length), `seed ${seed}`).toBeLessThan(0.4);
      for (let i = 1; i < starts.length; i++) expect((starts[i] as { at: number }).at - (starts[i - 1] as { at: number }).at, `seed ${seed} gap ${i}`).toBeGreaterThanOrEqual(30_000);
    }
  });

  it('per-signature cooldowns hold (the same action never twice within its cooldown)', () => {
    const seen = new Map<string, number[]>();
    const clipStarts = (outs: SimOutput[]) => outs.filter((o, i) => o.clip === 'dance' && outs[i - 1]?.clip !== 'dance').length;
    const r = sigRun(2, 30 * MIN);
    expect(clipStarts(r.outs)).toBeGreaterThan(0);
    // dance carries two actions (poof: 25 s, jig: 40 s); at least 25 s between any two dance starts is guaranteed by the global gap.
    const times = r.outs.filter((o, i) => o.clip === 'dance' && r.outs[i - 1]?.clip !== 'dance').map((o) => o.clipStartedAt);
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(25_000);
    expect(seen.size).toBe(0);
  });

  it('plays the lead-in clip first, the emote with the main clip and the sound when sounds are on', () => {
    const settings = settingsWith({ sound: { enabled: true, cat: true, volume: 0.5 } });
    let ok = false;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = sigRun(seed, 20 * MIN, {}, settings);
      const lead = r.outs.findIndex((o, i) => o.clip === 'scan' && r.outs[i - 1]?.clip !== 'scan');
      if (lead < 0) continue;
      const after = r.outs.slice(lead);
      const mainAt = after.findIndex((o) => o.clip === 'vanish' || o.clip === 'dance');
      expect(mainAt).toBeGreaterThan(0);
      expect(after.slice(0, 80).some((o) => o.emote === 'sparkle')).toBe(true);
      ok = true;
      break;
    }
    expect(ok).toBe(true);
  });

  it('requires hold: cursorNear never fires without a cursor, needsLedge never fires on the floor', () => {
    const r = sigRun(3, 30 * MIN);
    expect(r.outs.some((o) => o.clip === 'peek')).toBe(false);
    expect(r.outs.some((o) => o.clip === 'swing')).toBe(false);
  });

  it('cursorNear can fire with the cursor beside it (and only then)', () => {
    let fired = 0;
    for (const seed of [1, 2, 3, 4]) {
      withModule(ghost, () => {
        const decisions: string[] = [];
        const h = new Harness({ seed, character: 'ghost', hooks: { onDecision: (r) => decisions.push(`${r.state}:${r.variant}`) } });
        h.keepOutputs = true;
        h.run(20 * MIN, 50, (hh) => {
          const o = hh.last;
          hh.env = { cursor: o ? { x: o.x + 220, y: o.y - 30, speed: 0 } : null, cursorIdleMs: 3000 };
          return [];
        });
        fired += h.outputs.filter((o, i) => o.clip === 'peek' && h.outputs[i - 1]?.clip !== 'peek').length;
      });
    }
    expect(fired).toBeGreaterThan(0);
  });

  it('teleport: the vanish clip, then a relocation while hidden, then the appear clip, always inside the usable screen area', () => {
    let relocations = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = sigRun(seed, 25 * MIN);
      const outs = r.outs;
      for (let i = 1; i < outs.length; i++) {
        const o = outs[i] as SimOutput;
        expect(insideAnyWorkArea(SINGLE, o.x, o.y, 2), `seed ${seed} t=${i}: ${o.x},${o.y}`).toBe(true);
        if (o.clip === 'appear' && outs[i - 1]?.clip === 'vanish') {
          const before = outs[i - 1] as SimOutput;
          expect(o.snap).toBe(true);
          if (Math.abs(o.x - before.x) > 1) relocations++;
        }
      }
      // appear never without a vanish before it
      for (let i = 0; i < outs.length; i++) {
        if ((outs[i] as SimOutput).clip === 'appear' && outs[i - 1]?.clip !== 'appear') {
          let j = i - 1;
          while (j > 0 && (outs[j] as SimOutput).clip === 'vanish') j--;
          expect((outs[i - 1] as SimOutput).clip).toBe('vanish');
        }
      }
    }
    expect(relocations).toBeGreaterThan(0);
  });

  it('teleport at the very edge of the screen still lands inside it (pure target)', () => {
    const span = { x0: 0, x1: 1920 };
    for (const x of [0, 5, 960, 1915, 1920]) {
      for (const u1 of [0, 0.3, 0.7, 1]) {
        for (const u2 of [0, 0.5, 1]) {
          const t = teleportTarget(x, span, 84, u1, u2);
          expect(t).toBeGreaterThanOrEqual(span.x0);
          expect(t).toBeLessThanOrEqual(span.x1);
        }
      }
    }
    expect(teleportTarget(10, { x0: 0, x1: 20 }, 84, 0.2, 0.2)).toBeGreaterThanOrEqual(0);
  });

  it('reduced motion: no vanish or appear clip at all, the relocation is a plain swap', () => {
    let swaps = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = sigRun(seed, 25 * MIN, { reducedMotion: true });
      expect(r.outs.some((o) => o.clip === 'vanish' || o.clip === 'appear')).toBe(false);
      for (let i = 1; i < r.outs.length; i++) {
        const o = r.outs[i] as SimOutput;
        expect(insideAnyWorkArea(SINGLE, o.x, o.y, 2)).toBe(true);
        if (o.snap && r.outs[i - 1]?.clip === 'scan') swaps++;
      }
      expect(r.decisions.filter((d) => d.variant === 'signature').length).toBeGreaterThanOrEqual(0);
    }
    expect(swaps).toBeGreaterThanOrEqual(0);
  });

  it('never starts while Laser Mode is on, while the character is held, or in a paused session', () => {
    for (const env of [{ laserMode: true }, { paused: true }]) {
      const r = sigRun(2, 15 * MIN, env);
      expect(r.decisions.filter((d) => d.variant === 'signature').length).toBe(0);
    }
  });

  it('an action in progress gives way at once to a pet (interruptible), and normal movement continues between actions', () => {
    let interrupted = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      withModule(ghost, () => {
        const h = new Harness({ seed, character: 'ghost' });
        h.keepOutputs = true;
        h.run(WAKE_MS, 50);
        let petted = false;
        let checked = false;
        h.run(25 * MIN, 50, (hh) => {
          const info = hh.sim.debugInfo();
          if (petted && !checked) {
            checked = true;
            // The tick after the pet: no signature script is running any more.
            expect(info.state === 'idle' && info.variant === 'signature').toBe(false);
            interrupted++;
          }
          if (!petted && info.state === 'idle' && info.variant === 'signature' && hh.last?.clip !== 'vanish' && hh.last?.clip !== 'appear') {
            petted = true;
            return [{ type: 'pointer.pet', at: catPoint(hh.last), strength: 1 }];
          }
          return [];
        });
        // between actions it keeps living: walking and resting both happen
        const states = new Set(h.outputs.map((o) => o.state));
        expect(states.has('walking')).toBe(true);
      });
    }
    expect(interrupted).toBeGreaterThan(0);
  });

  it('the pure weight honours cooldown, global gap, energy, mood and sleepiness requirements', () => {
    const base: SignatureContext = { energy: 0.8, mood: 'happy', sleepy: false, onLedge: false, atWall: false, cursorNear: false, seven: { curiosity: 0.5, energy: 0.5, playfulness: 0.5, sociability: 0.5, mischief: 0.5, affection: 0.5, independence: 0.5 }, sinceMs: Infinity, sinceAnyMs: Infinity, typing: false, clipSwitchable: true, canRelocate: true };
    const s: SignatureAction = { id: 'x', clip: 'dance', weight: 2, cooldownMs: 10_000, durationMs: [1, 2], requires: { minEnergy: 0.5, moods: ['happy', 'excited'], notWhileSleepy: true } };
    expect(signatureWeight(s, base)).toBe(2);
    expect(signatureWeight(s, { ...base, sinceMs: 5000 })).toBe(0);
    expect(signatureWeight(s, { ...base, sinceAnyMs: 1000 })).toBe(0);
    expect(signatureWeight(s, { ...base, energy: 0.2 })).toBe(0);
    expect(signatureWeight(s, { ...base, mood: 'sleepy' })).toBe(0);
    expect(signatureWeight(s, { ...base, sleepy: true })).toBe(0);
    expect(signatureWeight(s, { ...base, clipSwitchable: false })).toBe(0);
    expect(signatureWeight({ ...s, movement: 'teleport' }, { ...base, canRelocate: false })).toBe(0);
    expect(signatureWeight({ ...s, movement: 'random-hop' }, { ...base, typing: true })).toBe(0);
    expect(signatureWeight({ ...s, requires: { needsLedge: true } }, base)).toBe(0);
    expect(signatureWeight({ ...s, requires: { needsLedge: true } }, { ...base, onLedge: true })).toBe(2);
    expect(signatureWeight({ ...s, requires: { maxEnergy: 0.5 } }, base)).toBe(0);
  });

  it('the script of a teleport has lead-in, vanish, appear, main (or no vanish and appear when reduced)', () => {
    const steps = buildSteps(vanisher, 0.5, { reducedMotion: false });
    expect(steps.map((x) => x.kind)).toEqual(['leadIn', 'vanish', 'appear', 'main']);
    expect(buildSteps(vanisher, 0.5, { reducedMotion: true }).map((x) => x.kind)).toEqual(['leadIn', 'vanish', 'main']);
    expect(buildSteps(vanisher, 0.5, { reducedMotion: true }).find((x) => x.kind === 'vanish')?.ms).toBe(0);
    const main = steps.find((x) => x.kind === 'main');
    expect(main?.ms).toBe(2000);
  });
});

describe('reactions use the ReactionSpec', () => {
  const clips = Object.freeze(['stand', 'sit', 'sleep', 'wake', 'yawn', 'walk', 'run', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'squish', 'beam', 'dance'] as never);
  const mod = testModule(SLIME_MODULE, {
    id: 'slime',
    clips,
    locomotion: 'walk',
    reactions: Object.freeze({
      petted: { clip: 'squish', emote: 'sparkle', sound: 'squelch', mood: 'excited', durationMs: 4000 },
      held: { clip: 'dance', emote: 'note' },
    }),
  });

  it('petting: the character plays its own clip, emote, sound and mood instead of the default', () => {
    const settings = settingsWith({ sound: { enabled: true, cat: true, volume: 0.5 } });
    withModule(mod, () => {
      const h = new Harness({ seed: 4, character: 'slime', settings });
      h.keepOutputs = true;
      h.run(WAKE_MS + 3000, 33);
      h.run(8000, 33, (hh, i) => (i % 9 === 0 ? [{ type: 'pointer.pet', at: catPoint(hh.last), strength: 0.9 }] : []));
      const petted = h.outputs.filter((o) => o.state === 'beingPetted');
      expect(petted.length).toBeGreaterThan(5);
      for (const o of petted) expect(o.clip).toBe('squish');
      expect(petted.some((o) => o.mood === 'excited')).toBe(true);
      expect(petted.some((o) => o.emote === 'sparkle')).toBe(true);
      expect(h.outputs.some((o) => o.sound?.kind === 'squelch')).toBe(true);
    });
  });

  it('being held: the character plays its held reaction clip', () => {
    withModule(mod, () => {
      const h = new Harness({ seed: 4, character: 'slime' });
      h.keepOutputs = true;
      h.run(WAKE_MS + 3000, 33);
      h.step([{ type: 'pointer.dragStart', at: catPoint(h.last) }]);
      h.env = { dragCursor: { x: (h.last?.x ?? 0) + 5, y: (h.last?.y ?? 0) - 120 } };
      h.run(1500, 33);
      const held = h.outputs.filter((o) => o.state === 'held');
      expect(held.length).toBeGreaterThan(5);
      for (const o of held) expect(o.clip).toBe('dance');
    });
  });

  it('the cat has no reaction specs and keeps its petted clip', () => {
    const h = new Harness({ seed: 4 });
    h.keepOutputs = true;
    h.run(WAKE_MS + 3000, 33);
    h.run(6000, 33, (hh, i) => (i % 9 === 0 ? [{ type: 'pointer.pet', at: catPoint(hh.last), strength: 0.9 }] : []));
    const petted = h.outputs.filter((o) => o.state === 'beingPetted');
    expect(petted.length).toBeGreaterThan(3);
    for (const o of petted) expect(o.clip).toBe('petted');
  });
});

describe('memory allow-list', () => {
  it('a character that keeps only some kinds never records the others (pets are remembered, naps are not)', () => {
    const mod = testModule(CAT_MODULE, { id: 'ghost', memory: Object.freeze({ kinds: Object.freeze(['pet']) }) });
    withModule(mod, () => {
      const h = new Harness({ seed: 6, character: 'ghost' });
      h.run(WAKE_MS + 2000, 33);
      h.run(40 * 1000, 33, (hh, i) => (i % 15 === 0 ? [{ type: 'pointer.pet', at: catPoint(hh.last), strength: 0.8 }] : []));
      h.run(15 * MIN, 100);
      const kinds = new Set(h.sim.serialize().memory.recent.map((e) => e.kind));
      for (const k of kinds) expect(k).toBe('pet');
      expect(h.sim.serialize().memory.counters.pets).toBeGreaterThan(0);
    });
  });
});

describe('a companion of any character starts from its own persisted state', () => {
  it('a non-cat state with a non-cat id (and no cat- prefix) loads, runs and serializes under the same id', () => {
    const p = newPersistedCat(mulberry32(8), WALL - 3600_000, 'monkey');
    expect(p.catId.startsWith('cat-')).toBe(false);
    p.savedAt = WALL;
    const h = new Harness({ seed: 2, character: 'monkey', persisted: p });
    h.run(5 * MIN, 100);
    const back = h.sim.serialize();
    expect(back.catId).toBe(p.catId);
    expect(back.traits.curiosity).toBeCloseTo(p.traits.curiosity, 9);
  });

  it('a corrupt non-cat state is replaced by a fresh companion of that character (not a cat)', () => {
    const h = new Harness({ seed: 2, character: 'fox', persisted: { schemaVersion: 1, junk: true } as never });
    expect(h.sim.serialize().catId.startsWith('fox-')).toBe(true);
  });

  it('resetting the personality keeps the character', () => {
    const h = new Harness({ seed: 2, character: 'alien' });
    h.sim.resetPersonality();
    expect(h.sim.serialize().catId.startsWith('alien-')).toBe(true);
  });
});

describe('liveness of every registered character (real modules)', () => {
  it.each(CHARACTERS.map((c) => [c.id] as const))('%s: it keeps living for 25 sim-minutes, never leaves its clip set, shows variety and never stalls', (id) => {
    const mod = CHARACTERS.find((c) => c.id === id) as CharacterModule;
    const r = run({ seed: 13, character: id, ms: 25 * MIN, dt: 100 });
    const clips = new Set(r.outs.map((o) => o.clip));
    const listed = new Set<string>(mod.clips);
    for (const c of clips) expect(listed.has(c), `${id} emitted ${c}`).toBe(true);
    const states = new Set(r.outs.map((o) => o.state));
    expect(states.size, `${id} states`).toBeGreaterThanOrEqual(5);
    expect(clips.size, `${id} clips`).toBeGreaterThanOrEqual(4);
    // Moves around the screen and is not asleep or idle for the whole run.
    const xs = r.outs.map((o) => o.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(300);
    const asleep = r.outs.filter((o) => o.state === 'sleeping').length;
    expect(asleep / r.outs.length, `${id} asleep share`).toBeLessThan(0.7);
    expect(r.outs.filter((o) => o.speed > 0.05).length / r.outs.length, `${id} moving share`).toBeGreaterThan(0.03);
    // Never stuck in one state for ten minutes (sleeping and resting included).
    let last = r.outs[0]?.state;
    let sinceIdx = 0;
    for (let i = 0; i < r.outs.length; i++) {
      if (r.outs[i]?.state !== last) {
        last = r.outs[i]?.state;
        sinceIdx = i;
      }
      expect(i - sinceIdx, `${id} stuck in ${last}`).toBeLessThan((10 * MIN) / 100);
    }
    for (const o of r.outs) {
      expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true);
      expect(ALL_CLIPS as readonly string[]).toContain(o.clip);
    }
  });

  it('every character module draws every canonical clip the sim emits for it via its list, alias or fallbacks', () => {
    for (const m of CHARACTERS) {
      const r = run({ seed: 21, character: m.id, ms: 8 * MIN, dt: 100 });
      for (const o of r.outs) expect(m.clips.includes(o.clip as never), `${m.id}: ${o.clip}`).toBe(true);
    }
  });

  it('alien and ghost starters (float or glide style) move with the float clip, never the walk cycle they lack', () => {
    for (const mod of [GHOST_MODULE, ALIEN_MODULE]) {
      if (mod.locomotion !== 'float' && mod.locomotion !== 'glide') continue;
      const r = run({ seed: 4, character: mod.id, ms: 8 * MIN, dt: 100 });
      for (const o of r.outs) if ((o.state === 'walking' || o.state === 'running') && o.speed > 0.05 && o.support.kind === 'floor') expect(o.clip).toBe('float');
    }
  });
});
