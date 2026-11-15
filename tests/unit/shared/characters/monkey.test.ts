// Monkey module specifics: lively tuning, authored signatures drawn natively, reactions that resolve.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS } from '../../../../src/shared/cat';
import { resolveForCharacter } from '../../../../src/core/behavior/character';
import { PROP_KINDS, WORLD_EVENT_IDS } from '../../../../src/shared/companion';
import { MONKEY_MODULE as M } from '../../../../src/shared/characters/monkey';
import { monkeyEn, monkeyTr } from '../../../../src/shared/i18n/characters/monkey';

describe('monkey module', () => {
  it('draws every clip: natively or through an alias onto a native clip', () => {
    for (const c of ANIM_CLIPS) expect(M.clips.includes(resolveForCharacter(M, c)), c).toBe(true);
    for (const c of ['stand', 'sit', 'loaf', 'sleep', 'wake', 'yawn', 'walk', 'run', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'peek', 'climb', 'swing', 'scratch', 'dance', 'groom', 'pawAt', 'scan', 'stretch', 'meow'] as const) expect(M.clips, c).toContain(c);
  });

  it('has 5+ signatures within the cooldown band, each drawn natively and sensible', () => {
    expect(M.behavior.signatures.length).toBeGreaterThanOrEqual(5);
    for (const s of M.behavior.signatures) {
      expect(M.clips, s.id).toContain(s.clip);
      for (const l of s.leadIn ?? []) expect(M.clips, `${s.id} leadIn`).toContain(l);
      expect(s.cooldownMs, s.id).toBeGreaterThanOrEqual(20_000);
      expect(s.cooldownMs, s.id).toBeLessThanOrEqual(300_000);
    }
    const ids = M.behavior.signatures.map((s) => s.id);
    for (const id of ['ledgeSwing', 'backflip', 'sillyDance', 'headScratch', 'peekaboo', 'cursorMimic']) expect(ids).toContain(id);
    expect(M.behavior.signatures.find((s) => s.id === 'ledgeSwing')?.requires?.needsLedge).toBe(true);
    expect(M.behavior.signatures.find((s) => s.id === 'cursorMimic')?.requires?.cursorNear).toBe(true);
  });

  it('reactions resolve to native clips and cover the required stimuli', () => {
    for (const k of ['petted', 'held', 'startled', 'cursorNear', 'laser'] as const) expect(M.reactions[k], k).toBeDefined();
    const props = PROP_KINDS.filter((p) => M.reactions[p] !== undefined);
    expect(props.length).toBeGreaterThanOrEqual(8);
    for (const p of ['yarn', 'box', 'butterfly', 'leaf'] as const) expect(M.reactions[p], p).toBeDefined();
    for (const r of Object.values(M.reactions)) expect(M.clips.includes(resolveForCharacter(M, r.clip))).toBe(true);
  });

  it('is lively, curious and cursor-loving, with at least six event affinities', () => {
    expect(M.behavior.restBias).toBeLessThan(1);
    expect(M.behavior.exploreBias).toBeGreaterThan(1);
    expect(M.behavior.cursorInterest).toBeGreaterThan(1);
    expect(M.capabilities.climbsEdges).toBe(true);
    expect(M.locomotion).toBe('walk');
    expect(Object.keys(M.behavior.eventAffinity).length).toBeGreaterThanOrEqual(6);
    for (const id of Object.keys(M.behavior.eventAffinity)) expect(WORLD_EVENT_IDS as readonly string[]).toContain(id);
    expect(M.skins.length).toBeGreaterThanOrEqual(4);
    expect(M.sound.cooldownMs).toBeGreaterThanOrEqual(2000);
  });

  it('has matching English and Turkish copy keys, all non-empty', () => {
    expect(Object.keys(monkeyTr).sort()).toEqual(Object.keys(monkeyEn).sort());
    for (const v of [...Object.values(monkeyEn), ...Object.values(monkeyTr)]) expect(v.length).toBeGreaterThan(3);
  });
});
