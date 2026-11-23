// The character module contract (GizeMate): every module in the registry satisfies the same rules,
// whatever its author put in it, so the shared engine, the renderers and the settings UI can rely on
// them. Also the derived seven-trait view and the clip resolution the sim applies per character.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, SOUND_CUES, SKINS, type AnimClip } from '../../../src/shared/cat';
import { CLIP_META } from '../../../src/shared/animationCatalog';
import { defaultStats } from '../../../src/core/behavior/personality';
import { MEMORY_KINDS } from '../../../src/core/behavior/memory';
import { newPersistedCat, TRAIT_MAX, TRAIT_MIN } from '../../../src/core/behavior/personality';
import { mulberry32 } from '../../../src/core/behavior/random';
import { resolveForCharacter, locomotionClip, isNeutral } from '../../../src/core/behavior/character';
import { MOODS, PROP_KINDS, WORLD_EVENT_IDS } from '../../../src/shared/companion';
import { PersistedCatSchema } from '../../../src/shared/catState';
import { CHARACTERS, CHARACTER_IDS, characterOrDefault, getCharacter, isCharacterId } from '../../../src/shared/characters/registry';
import { drawSevenTraits, sevenTraitsOf, storedFromSeven } from '../../../src/shared/characters/seven';
import type { CharacterModule, SevenTraits } from '../../../src/shared/characters/types';

const SEVEN_KEYS: Array<keyof SevenTraits> = ['curiosity', 'energy', 'playfulness', 'sociability', 'mischief', 'affection', 'independence'];
/** Clips every renderer must draw or alias (CONTRACT.md "Clips"). */
const UNIVERSAL: AnimClip[] = ['stand', 'sit', 'loaf', 'sleep', 'wake', 'yawn', 'walk', 'run', 'crouch', 'jump', 'fall', 'land', 'startle', 'held', 'petted', 'groom', 'annoyed', 'confused', 'shake', 'scratch', 'hide'];
const CLIP_SET: ReadonlySet<string> = new Set(ANIM_CLIPS);
const CUE_SET: ReadonlySet<string> = new Set(SOUND_CUES);

describe('the registry', () => {
  it('lists the seven characters in order, each module under its own id, the cat first', () => {
    expect(CHARACTERS.map((c) => c.id)).toEqual([...CHARACTER_IDS]);
    expect(CHARACTERS[0]?.id).toBe('cat');
    for (const id of CHARACTER_IDS) expect(getCharacter(id).id).toBe(id);
  });

  it('turns anything unknown into the cat', () => {
    expect(characterOrDefault('dragon')).toBe('cat');
    expect(characterOrDefault(undefined)).toBe('cat');
    expect(characterOrDefault(42)).toBe('cat');
    expect(isCharacterId('fox')).toBe(true);
    expect(isCharacterId('Fox')).toBe(false);
  });

  it('the cat is all-neutral and keeps the shipped skins', () => {
    const cat = getCharacter('cat');
    expect(isNeutral(cat)).toBe(true);
    expect([...cat.skins]).toEqual([...SKINS]);
    expect(cat.behavior.signatures).toHaveLength(0);
    expect(cat.locomotion).toBe('walk');
    expect(cat.body.gaitScale).toBe(1);
  });
});

describe.each(CHARACTERS.map((c) => [c.id, c] as const))('module contract: %s', (_id, m: CharacterModule) => {
  it('has a sane identity, body and i18n prefix', () => {
    expect(m.i18nPrefix).toBe(`character.${m.id}`);
    expect(['animal', 'fantasy']).toContain(m.kind);
    expect(['walk', 'hop', 'float', 'bounce', 'glide']).toContain(m.locomotion);
    expect(m.body.widthDip).toBeGreaterThan(0);
    expect(m.body.heightDip).toBeGreaterThan(0);
    expect(m.body.gaitScale).toBeGreaterThan(0);
    expect(m.body.gaitScale).toBeLessThanOrEqual(3);
    for (const [clip, v] of Object.entries(m.body.hitFrontExtentDip)) {
      expect(CLIP_SET.has(clip), clip).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('lists only valid, unique clips and valid alias targets that the module itself draws', () => {
    expect(new Set(m.clips).size).toBe(m.clips.length);
    for (const c of m.clips) expect(CLIP_SET.has(c), `clip ${c}`).toBe(true);
    for (const [from, to] of Object.entries(m.clipAlias)) {
      expect(CLIP_SET.has(from), `alias key ${from}`).toBe(true);
      expect(CLIP_SET.has(to as string), `alias target ${String(to)}`).toBe(true);
      expect(m.clips.includes(to), `alias ${from} -> ${String(to)} must be a clip the module lists`).toBe(true);
      expect(m.clips.includes(from as AnimClip), `alias ${from} is already listed natively`).toBe(false);
    }
  });

  it('draws or aliases every universal clip (resolution always ends on a listed clip)', () => {
    for (const c of UNIVERSAL) {
      const r = resolveForCharacter(m, c);
      expect(m.clips.includes(r), `${c} -> ${r}`).toBe(true);
    }
    // And every clip of the vocabulary resolves cleanly, whatever the character lists.
    for (const c of ANIM_CLIPS) expect(m.clips.includes(resolveForCharacter(m, c)), c).toBe(true);
    expect(m.clips).toContain('stand');
    expect(m.clips).toContain('sleep');
  });

  it('has at least one skin, unique and non-empty ids', () => {
    expect(m.skins.length).toBeGreaterThan(0);
    expect(new Set(m.skins).size).toBe(m.skins.length);
    for (const s of m.skins) expect(s.length).toBeGreaterThan(0);
  });

  it('has trait means in 0..1 and a bounded spread', () => {
    for (const k of SEVEN_KEYS) {
      expect(m.personality.means[k], k).toBeGreaterThanOrEqual(0);
      expect(m.personality.means[k], k).toBeLessThanOrEqual(1);
    }
    expect(m.personality.spread).toBeGreaterThanOrEqual(0);
    expect(m.personality.spread).toBeLessThanOrEqual(0.5);
  });

  it('has positive, finite behaviour multipliers and known event ids', () => {
    const b = m.behavior;
    for (const k of ['speedScale', 'restBias', 'exploreBias', 'playBias', 'cursorInterest', 'jumpiness', 'shyness'] as const) {
      expect(Number.isFinite(b[k]), k).toBe(true);
      expect(b[k], k).toBeGreaterThan(0);
      expect(b[k], k).toBeLessThanOrEqual(4);
    }
    const events: ReadonlySet<string> = new Set(WORLD_EVENT_IDS);
    for (const [id, w] of Object.entries(b.eventAffinity)) {
      expect(events.has(id), `event ${id}`).toBe(true);
      expect(Number.isFinite(w) && (w) >= 0, `affinity ${id}`).toBe(true);
    }
  });

  it('has valid signature actions: unique ids, positive weights, ordered durations, known clips', () => {
    const ids = new Set<string>();
    for (const s of m.behavior.signatures) {
      expect(s.id).toMatch(/^[a-zA-Z0-9_]{1,24}$/);
      expect(ids.has(s.id), `duplicate signature id ${s.id}`).toBe(false);
      ids.add(s.id);
      expect(s.weight, s.id).toBeGreaterThan(0);
      expect(s.cooldownMs, s.id).toBeGreaterThan(0);
      expect(s.durationMs[0], s.id).toBeGreaterThanOrEqual(0);
      expect(s.durationMs[0], s.id).toBeLessThanOrEqual(s.durationMs[1]);
      expect(CLIP_SET.has(s.clip), `${s.id} clip`).toBe(true);
      for (const c of s.leadIn ?? []) expect(CLIP_SET.has(c), `${s.id} leadIn ${c}`).toBe(true);
      if (s.emote !== undefined) expect(['heart', 'zzz', 'exclaim', 'question', 'anger', 'note', 'sparkle']).toContain(s.emote);
      if (s.sound !== undefined) expect(CUE_SET.has(s.sound), `${s.id} sound`).toBe(true);
      for (const [k, v] of Object.entries(s.traitBias ?? {})) {
        expect(SEVEN_KEYS as string[]).toContain(k);
        expect(Number.isFinite(v)).toBe(true);
      }
      for (const mood of s.requires?.moods ?? []) expect(MOODS as readonly string[]).toContain(mood);
      // A moving or relocating action has to be one the character can perform without a shared clip it lacks.
      if (s.movement === 'teleport') {
        expect(CLIP_META.vanish.durationS).not.toBeNull();
      }
    }
  });

  it('has reactions on known stimuli with valid clips', () => {
    const stimuli: ReadonlySet<string> = new Set([...PROP_KINDS, 'laser', 'petted', 'held', 'startled', 'cursorNear']);
    for (const [k, r] of Object.entries(m.reactions)) {
      expect(stimuli.has(k), `stimulus ${k}`).toBe(true);
      expect(CLIP_SET.has(r.clip), `${k} clip`).toBe(true);
      if (r.sound !== undefined) expect(CUE_SET.has(r.sound)).toBe(true);
      if (r.durationMs !== undefined) expect(r.durationMs).toBeGreaterThan(0);
      if (r.mood !== undefined) expect(MOODS as readonly string[]).toContain(r.mood);
    }
  });

  it('has a sound profile within bounds and a memory allow-list of known kinds', () => {
    expect(m.sound.pitch).toBeGreaterThanOrEqual(0.5);
    expect(m.sound.pitch).toBeLessThanOrEqual(2);
    expect(m.sound.gain).toBeGreaterThanOrEqual(0.2);
    expect(m.sound.gain).toBeLessThanOrEqual(1);
    expect(m.sound.cooldownMs).toBeGreaterThanOrEqual(0);
    for (const c of [m.sound.cues.voice, m.sound.cues.happy, m.sound.cues.startled, ...(m.sound.cues.move ? [m.sound.cues.move] : [])]) expect(CUE_SET.has(c)).toBe(true);
    if (m.memory.kinds !== 'all') for (const k of m.memory.kinds) expect((MEMORY_KINDS as readonly string[]).includes(k), `memory kind ${k}`).toBe(true);
  });

  it('is frozen data (the engine never mutates a module)', () => {
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('a newborn companion of this character is a valid persisted state with in-band traits', () => {
    const cat = newPersistedCat(mulberry32(5), 1_700_000_000_000, m.id);
    expect(PersistedCatSchema.safeParse(cat).success).toBe(true);
    expect(cat.catId.startsWith(`${m.id}-`)).toBe(true);
    for (const v of Object.values(cat.traits)) {
      expect(v).toBeGreaterThanOrEqual(TRAIT_MIN - 1e-9);
      expect(v).toBeLessThanOrEqual(TRAIT_MAX + 1e-9);
    }
  });
});

describe('the seven-trait view', () => {
  const cat = newPersistedCat(mulberry32(3), 1_700_000_000_000);

  it('is derived from the stored traits and drives, all in 0..1, without touching them', () => {
    const before = JSON.stringify(cat);
    const s = sevenTraitsOf(cat);
    expect(JSON.stringify(cat)).toBe(before);
    for (const k of SEVEN_KEYS) {
      expect(s[k], k).toBeGreaterThanOrEqual(0);
      expect(s[k], k).toBeLessThanOrEqual(1);
    }
    expect(s.curiosity).toBe(cat.traits.curiosity);
    expect(s.affection).toBe(cat.traits.affection);
    expect(s.playfulness).toBe(cat.traits.playfulness);
  });

  it('follows each stored trait in the documented direction', () => {
    const base = { traits: { ...cat.traits }, drives: { mischief: 0.3 } };
    const hi = (patch: Partial<typeof cat.traits>, drives = base.drives) => sevenTraitsOf({ traits: { ...base.traits, ...patch }, drives });
    expect(hi({ energyLevel: 0.9, laziness: 0.1 }).energy).toBeGreaterThan(hi({ energyLevel: 0.2, laziness: 0.8 }).energy);
    expect(hi({ affection: 0.9 }).sociability).toBeGreaterThan(hi({ affection: 0.1 }).sociability);
    expect(hi({ confidence: 0.9 }).independence).toBeGreaterThan(hi({ confidence: 0.1 }).independence);
    expect(hi({}, { mischief: 0.9 }).mischief).toBeGreaterThan(hi({}, { mischief: 0.1 }).mischief);
    expect(hi({ affection: 0.9 }).independence).toBeLessThan(hi({ affection: 0.1 }).independence);
  });

  it('the inverse maps a means vector back near itself and stays in range', () => {
    for (const m of CHARACTERS) {
      const back = sevenTraitsOf({ traits: { ...storedFromSeven(m.personality.means).traits, startleSensitivity: 0.5 }, drives: { mischief: storedFromSeven(m.personality.means).mischiefDrive } });
      for (const k of ['curiosity', 'energy', 'playfulness', 'affection'] as const) expect(back[k], `${m.id} ${k}`).toBeCloseTo(m.personality.means[k], 6);
      // Sociability and independence share one stored confidence: they meet in the middle.
      expect(Math.abs(back.sociability - m.personality.means.sociability) + Math.abs(back.independence - m.personality.means.independence)).toBeLessThan(0.6);
    }
  });

  it('a draw centres on the means and is deterministic for a seed', () => {
    const means = getCharacter('ghost').personality.means;
    const a = drawSevenTraits(means, 0.15, mulberry32(9));
    const b = drawSevenTraits(means, 0.15, mulberry32(9));
    expect(a).toEqual(b);
    const acc: Record<string, number> = {};
    const N = 400;
    const r = mulberry32(11);
    for (let i = 0; i < N; i++) {
      const d = drawSevenTraits(means, 0.15, r);
      for (const k of SEVEN_KEYS) acc[k] = (acc[k] ?? 0) + d[k] / N;
    }
    for (const k of SEVEN_KEYS) expect(Math.abs((acc[k] as number) - means[k])).toBeLessThan(0.05);
  });

  it('newborns of a character differ by character and keep the cat generator untouched', () => {
    const rnd = () => mulberry32(21);
    const catA = newPersistedCat(rnd(), 1_700_000_000_000);
    const catB = newPersistedCat(rnd(), 1_700_000_000_000, 'cat');
    expect(catA).toEqual(catB);
    const ghost = newPersistedCat(rnd(), 1_700_000_000_000, 'ghost');
    expect(ghost.catId.slice('ghost-'.length)).toBe(catA.catId.slice('cat-'.length));
    // Draws were consumed identically: the next draw from the shared stream matches.
    const r1 = rnd();
    newPersistedCat(r1, 1, 'cat');
    const r2 = rnd();
    newPersistedCat(r2, 1, 'monkey');
    expect(r1()).toBe(r2());
    // Ghost means are far more mischievous than the cat's.
    const avg = (id: 'ghost' | 'cat'): number => {
      let t = 0;
      for (let i = 0; i < 60; i++) t += sevenTraitsOf(newPersistedCat(mulberry32(100 + i), 1_700_000_000_000 + i, id)).mischief;
      return t / 60;
    };
    expect(avg('ghost')).toBeGreaterThan(avg('cat'));
    expect(defaultStats().bond).toBeGreaterThan(0);
  });
});

describe('clip resolution per character', () => {
  const sample: CharacterModule = Object.freeze({
    ...getCharacter('cat'),
    id: 'ghost',
    locomotion: 'float',
    clips: Object.freeze(['stand', 'sit', 'sleep', 'walk', 'float'] as AnimClip[]),
    clipAlias: Object.freeze({ run: 'float' }),
  });

  it('a listed clip is itself, an alias goes first, then the shared fallbacks, the floor is stand', () => {
    expect(resolveForCharacter(sample, 'sit')).toBe('sit');
    expect(resolveForCharacter(sample, 'run')).toBe('float');
    expect(resolveForCharacter(sample, 'stalk')).toBe('walk');
    expect(resolveForCharacter(sample, 'loaf')).toBe('sit');
    expect(resolveForCharacter(sample, 'swing')).toBe('stand');
    expect(resolveForCharacter(sample, 'nonsense' as AnimClip)).toBe('stand');
  });

  it('locomotion styles replace gait clips only', () => {
    const style = (l: CharacterModule['locomotion']) => ({ ...sample, locomotion: l }) as CharacterModule;
    for (const g of ['walk', 'run', 'stalk', 'slink', 'sprint'] as const) {
      expect(locomotionClip(style('hop'), g)).toBe('hop');
      expect(locomotionClip(style('float'), g)).toBe('float');
      expect(locomotionClip(style('glide'), g)).toBe('float');
      expect(locomotionClip(style('bounce'), g)).toBe('bounce');
      expect(locomotionClip(style('walk'), g)).toBe(g);
    }
    for (const c of ['stand', 'sit', 'loaf', 'sleep', 'jump', 'fall', 'groom'] as const) expect(locomotionClip(style('hop'), c)).toBe(c);
  });
});
