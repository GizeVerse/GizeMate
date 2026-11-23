// The slime module: identity, clips, signature actions, reactions, palettes and copy.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS } from '../../../../src/shared/cat';
import { resolveForCharacter, locomotionClip } from '../../../../src/core/behavior/character';
import { PROP_KINDS, WORLD_EVENT_IDS } from '../../../../src/shared/companion';
import { SLIME_MODULE } from '../../../../src/shared/characters/slime';
import { getCharacter } from '../../../../src/shared/characters/registry';
import { slimeEn, slimeTr } from '../../../../src/shared/i18n/characters/slime';
import { getSlimePalette } from '../../../../src/renderer/overlay/characters/slime/skins';
import { resolveSlimeClip } from '../../../../src/renderer/overlay/characters/slime';

const m = SLIME_MODULE;

describe('slime module', () => {
  it('is registered, bounces and squashes, and is lively', () => {
    expect(getCharacter('slime')).toBe(m);
    expect(m.kind).toBe('fantasy');
    expect(m.locomotion).toBe('bounce');
    expect(m.capabilities.squashes).toBe(true);
    expect(m.capabilities.flies).toBe(false);
    expect(locomotionClip(m, 'walk')).toBe('bounce');
    expect(locomotionClip(m, 'run')).toBe('bounce');
    expect(m.behavior.playBias).toBeGreaterThan(1);
    expect(m.behavior.jumpiness).toBeGreaterThan(1);
    expect(m.behavior.restBias).toBeLessThanOrEqual(1);
    expect(m.personality.means.playfulness).toBeGreaterThan(0.8);
  });

  it('draws the idle, locomotion, physics and performance clips natively and the rest as aliases of them', () => {
    for (const c of ['stand', 'sit', 'loaf', 'sleep', 'wake', 'yawn', 'bounce', 'hop', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'peek', 'squish', 'stretch', 'dance', 'scan', 'shake', 'beam', 'vanish', 'appear'] as const) {
      expect(m.clips, c).toContain(c);
    }
    for (const c of ANIM_CLIPS) {
      const r = resolveForCharacter(m, c);
      expect(m.clips).toContain(r);
      expect(resolveSlimeClip(c)).toBe(r);
    }
    // groom and scratch are native now (a pseudopod wipe and rub; product requirement: they were the shake clip).
    for (const c of ['walk', 'run', 'swing', 'float'] as const) expect(m.clipAlias[c], c).toBeDefined();
    for (const c of ['groom', 'scratch', 'pawAt', 'swat', 'meow', 'hiss', 'impact', 'rollOver', 'tailChase'] as const) expect(m.clips, c).toContain(c);
  });

  it('has at least four palettes, each defined by the renderer, readable (distinct outline) and unique', () => {
    expect(m.skins.length).toBeGreaterThanOrEqual(4);
    const bodies = new Set<string>();
    for (const s of m.skins) {
      const p = getSlimePalette(s);
      expect(p).not.toBe(getSlimePalette('missing-skin') === p && s !== m.skins[0] ? p : undefined);
      for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.outline).not.toBe(p.body);
      bodies.add(p.body);
    }
    expect(bodies.size).toBe(m.skins.length);
  });

  it('has five or more signature actions, each drawn natively, with sane cooldowns and an emote or sound', () => {
    const sigs = m.behavior.signatures;
    expect(sigs.length).toBeGreaterThanOrEqual(5);
    for (const s of sigs) {
      expect(m.clips, `${s.id} clip`).toContain(s.clip);
      for (const c of s.leadIn ?? []) expect(m.clips, `${s.id} leadIn`).toContain(c);
      expect(resolveForCharacter(m, s.clip)).toBe(s.clip);
      expect(s.cooldownMs, s.id).toBeGreaterThanOrEqual(20_000);
      expect(s.cooldownMs, s.id).toBeLessThanOrEqual(300_000);
      expect(s.emote !== undefined || s.sound !== undefined, s.id).toBe(true);
    }
    const ids = sigs.map((s) => s.id);
    for (const want of ['stretchToCursor', 'doubleBounce', 'meltPuddle', 'wobbleDance', 'shapeShift', 'bubbleBlow']) expect(ids).toContain(want);
    expect(sigs.find((s) => s.id === 'stretchToCursor')?.movement).toBe('toward-cursor');
    // Flavour, not a constant show: the total weight stays moderate.
    expect(sigs.reduce((a, s) => a + s.weight, 0)).toBeLessThan(12);
  });

  it('has reactions for touch, hold, startle, cursor, laser and at least eight props, all with a drawn clip', () => {
    for (const k of ['petted', 'held', 'startled', 'cursorNear', 'laser'] as const) expect(m.reactions[k], k).toBeDefined();
    const props = Object.keys(m.reactions).filter((k) => (PROP_KINDS as readonly string[]).includes(k));
    expect(props.length).toBeGreaterThanOrEqual(8);
    for (const [k, r] of Object.entries(m.reactions)) {
      expect(m.clips, k).toContain(r.clip);
      expect(resolveForCharacter(m, r.clip)).toBe(r.clip);
      expect(r.emote !== undefined || r.sound !== undefined, k).toBe(true);
    }
    expect(m.reactions.petted?.clip).toBe('petted');
    expect(m.reactions.held?.clip).toBe('held');
    expect(m.reactions.yarn?.clip).toBe('squish');
    expect(m.reactions.box?.clip).toBe('hide');
    expect(m.reactions.butterfly?.clip).toBe('bounce');
    expect(m.reactions.laser?.clip).toBe('bounce');
  });

  it('loves play events and avoids the frightening ones (six or more affinities)', () => {
    const a = m.behavior.eventAffinity;
    expect(Object.keys(a).length).toBeGreaterThanOrEqual(6);
    for (const id of Object.keys(a)) expect(WORLD_EVENT_IDS as readonly string[]).toContain(id);
    expect(a.bubbleParty).toBeGreaterThan(1);
    expect(a.butterflyEncounter).toBeGreaterThan(1);
    expect(a.toySpring).toBeGreaterThan(1);
    expect(a.thunderstorm).toBeLessThan(1);
  });

  it('has a squelchy, boing voice with a cooldown of at least two seconds', () => {
    expect(m.sound.voice).toBe('squelchy');
    expect(m.sound.cooldownMs).toBeGreaterThanOrEqual(2000);
    expect(m.sound.cues.voice).toBe('squelch');
    expect(m.sound.cues.happy).toBe('boing');
  });

  it('has English and Turkish copy for every key', () => {
    expect(Object.keys(slimeTr).sort()).toEqual(Object.keys(slimeEn).sort());
    for (const k of Object.keys(slimeEn) as Array<keyof typeof slimeEn>) {
      expect(slimeEn[k].length, k).toBeGreaterThan(3);
      expect(slimeTr[k].length, k).toBeGreaterThan(3);
    }
    expect(slimeTr.description).not.toBe(slimeEn.description);
  });
});
