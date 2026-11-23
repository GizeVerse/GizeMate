// Rabbit module specifics: the authored behaviour is complete and every clip it asks for is one the
// renderer really draws.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, type AnimClip } from '../../../../src/shared/cat';
import { PROP_KINDS, WORLD_EVENT_IDS } from '../../../../src/shared/companion';
import { resolveForCharacter, locomotionClip } from '../../../../src/core/behavior/character';
import { RABBIT_MODULE as M } from '../../../../src/shared/characters/rabbit';
import { NATIVE_CLIPS } from '../../../../src/renderer/overlay/characters/rabbit/clips';
import { rabbitEn, rabbitTr } from '../../../../src/shared/i18n/characters/rabbit';

const NATIVE: ReadonlySet<AnimClip> = new Set(M.clips);

describe('rabbit module', () => {
  it('is an animal that hops, does not climb and squashes', () => {
    expect(M.kind).toBe('animal');
    expect(M.locomotion).toBe('hop');
    expect(M.capabilities.climbsEdges).toBe(false);
    expect(locomotionClip(M, 'walk')).toBe('hop');
    expect(locomotionClip(M, 'run')).toBe('hop');
  });

  it('lists exactly the clips the renderer draws natively', () => {
    expect([...M.clips].sort()).toEqual([...NATIVE_CLIPS].sort());
    for (const c of ['stand', 'sit', 'loaf', 'sleep', 'wake', 'yawn', 'hop', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'peek', 'scan', 'groom', 'scratch', 'bounce', 'dance', 'pounce', 'swat', 'hiss', 'grumpy', 'balance', 'edgeSit', 'tailChase', 'rollOver', 'impact', 'slip', 'meow', 'vanish', 'appear'] as const) {
      expect(NATIVE.has(c), c).toBe(true);
    }
  });

  it('resolves every clip of the vocabulary to a native one', () => {
    for (const c of ANIM_CLIPS) expect(NATIVE.has(resolveForCharacter(M, c)), c).toBe(true);
  });

  it('has at least four palettes, the first being the default', () => {
    expect(M.skins.length).toBeGreaterThanOrEqual(4);
    expect(M.skins[0]).toBe('white');
  });

  it('has lively but not frantic tuning and a timid streak', () => {
    const b = M.behavior;
    expect(b.speedScale).toBeGreaterThan(1);
    expect(b.playBias).toBeGreaterThan(1);
    expect(b.shyness).toBeGreaterThan(1.2);
    expect(b.jumpiness).toBeGreaterThan(1);
    expect(M.personality.means.energy).toBeGreaterThan(0.6);
    expect(M.personality.means.affection).toBeGreaterThan(0.6);
  });

  it('has opinions about at least six world events, loving some and avoiding others', () => {
    const entries = Object.entries(M.behavior.eventAffinity);
    expect(entries.length).toBeGreaterThanOrEqual(6);
    for (const [id] of entries) expect((WORLD_EVENT_IDS as readonly string[]).includes(id)).toBe(true);
    expect(entries.some(([, w]) => w > 1.2)).toBe(true);
    expect(entries.some(([, w]) => w < 0.8)).toBe(true);
    expect(M.behavior.eventAffinity.butterflyEncounter).toBeGreaterThan(M.behavior.eventAffinity.littleGhost ?? 1);
  });

  it('has five or more signatures, each drawn natively, with sane cooldowns and durations', () => {
    const sigs = M.behavior.signatures;
    expect(sigs.length).toBeGreaterThanOrEqual(5);
    const ids = sigs.map((s) => s.id);
    for (const want of ['binky', 'periscope', 'earWash', 'footThump', 'nibble', 'zoomies', 'burrow']) expect(ids).toContain(want);
    for (const s of sigs) {
      expect(NATIVE.has(s.clip), `${s.id} clip ${s.clip}`).toBe(true);
      for (const l of s.leadIn ?? []) expect(NATIVE.has(l), `${s.id} leadIn ${l}`).toBe(true);
      expect(s.cooldownMs, s.id).toBeGreaterThanOrEqual(20_000);
      expect(s.cooldownMs, s.id).toBeLessThanOrEqual(300_000);
      expect(s.durationMs[1], s.id).toBeLessThanOrEqual(12_000);
    }
    // The shared clips of the signatures are distinct enough to be told apart.
    expect(new Set(sigs.map((s) => s.clip)).size).toBeGreaterThanOrEqual(5);
  });

  it('has a reaction for petted, held, startled, cursorNear, laser and at least eight prop kinds, each resolving to a native clip', () => {
    for (const k of ['petted', 'held', 'startled', 'cursorNear', 'laser'] as const) expect(M.reactions[k], k).toBeDefined();
    const props = Object.keys(M.reactions).filter((k) => (PROP_KINDS as readonly string[]).includes(k));
    expect(props.length).toBeGreaterThanOrEqual(8);
    for (const k of ['butterfly', 'leaf', 'box', 'yarn', 'ghost']) expect(props).toContain(k);
    for (const [k, r] of Object.entries(M.reactions)) {
      expect(NATIVE.has(resolveForCharacter(M, r.clip)), `${k} -> ${r.clip}`).toBe(true);
      expect(r.clip, k).toBeDefined();
    }
    // Distinct characters of reaction: bolting from the ghost, chasing the butterfly, nibbling the leaf, hiding in the box.
    expect(M.reactions.ghost?.clip).toBe('startle');
    expect(M.reactions.leaf?.clip).toBe('pawAt');
    expect(M.reactions.box?.clip).toBe('hide');
  });

  it('has a gentle voice with a cooldown of at least two seconds', () => {
    expect(M.sound.cooldownMs).toBeGreaterThanOrEqual(2000);
    expect(M.sound.cues.startled).toBe('thud');
  });

  it('has copy in both languages that does not mention the old names', () => {
    for (const copy of [rabbitEn, rabbitTr]) {
      for (const v of Object.values(copy)) {
        expect(v.length).toBeGreaterThan(3);
        expect(v.toLowerCase()).not.toMatch(/desktop cat|gizecat|gizemate|heart|kalp/);
      }
    }
    expect(rabbitEn.name).toBe('Rabbit');
    expect(rabbitTr.name).toBe('Tavşan');
    expect(Object.keys(rabbitTr).sort()).toEqual(Object.keys(rabbitEn).sort());
  });
});
