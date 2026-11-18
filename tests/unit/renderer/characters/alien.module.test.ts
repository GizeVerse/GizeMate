// Module specifics of the alien: the exact clip list, aliases, signatures, reactions, palettes and voice.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, type AnimClip } from '../../../../src/shared/cat';
import { MOODS, PROP_KINDS, WORLD_EVENT_IDS } from '../../../../src/shared/companion';
import { resolveForCharacter, locomotionClip } from '../../../../src/core/behavior/character';
import { PALETTES } from '../../../../src/renderer/overlay/characters/alien/palettes';
import { ALIEN_MODULE } from '../../../../src/shared/characters/alien';
import { alienEn, alienTr } from '../../../../src/shared/i18n/characters/alien';

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const SIGNATURE_CLIPS = ['scan', 'beam', 'groom', 'rollOver', 'dance', 'confused', 'yawn'] as const;

describe('alien module', () => {
  it('is a gliding, flying fantasy character', () => {
    expect(ALIEN_MODULE.kind).toBe('fantasy');
    expect(ALIEN_MODULE.locomotion).toBe('glide');
    expect(ALIEN_MODULE.capabilities.flies).toBe(true);
    expect(locomotionClip(ALIEN_MODULE, 'walk')).toBe('float');
    expect(ALIEN_MODULE.personality.means.curiosity).toBeGreaterThan(0.85);
  });

  it('draws the essential clips natively and covers the whole vocabulary through aliases', () => {
    for (const c of ['stand', 'sit', 'loaf', 'sleep', 'wake', 'yawn', 'float', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'peek', 'scan', 'beam', 'vanish', 'appear', 'dance', 'squish'] as AnimClip[]) {
      expect(ALIEN_MODULE.clips, c).toContain(c);
    }
    for (const c of ANIM_CLIPS) {
      const r = resolveForCharacter(ALIEN_MODULE, c);
      expect(ALIEN_MODULE.clips, `${c} -> ${r}`).toContain(r);
      // No alias hides a clip the module draws natively, and nothing falls to the bare stand by accident.
      if (!ALIEN_MODULE.clips.includes(c)) expect(ALIEN_MODULE.clipAlias[c], `${c} has an explicit alias`).toBeDefined();
    }
  });

  it('has five or more signature actions, each carried by a natively drawn clip, with sane timing', () => {
    const sigs = ALIEN_MODULE.behavior.signatures;
    expect(sigs.length).toBeGreaterThanOrEqual(5);
    for (const s of sigs) {
      expect(ALIEN_MODULE.clips, s.id).toContain(s.clip);
      for (const l of s.leadIn ?? []) expect(ALIEN_MODULE.clips).toContain(l);
      expect(s.cooldownMs, s.id).toBeGreaterThanOrEqual(20_000);
      expect(s.cooldownMs, s.id).toBeLessThanOrEqual(5 * 60_000);
      expect(s.weight).toBeLessThanOrEqual(2);
    }
    for (const c of SIGNATURE_CLIPS) expect(sigs.some((s) => s.clip === c), c).toBe(true);
    expect(sigs.some((s) => s.movement === 'teleport')).toBe(true);
    expect(sigs.some((s) => s.movement === 'toward-cursor')).toBe(true);
  });

  it('reacts to the laser, the cursor, petting, holding, a startle and at least eight props, with resolvable clips', () => {
    const r = ALIEN_MODULE.reactions;
    for (const k of ['laser', 'cursorNear', 'petted', 'held', 'startled'] as const) {
      expect(r[k], k).toBeDefined();
    }
    const props = PROP_KINDS.filter((k) => r[k] !== undefined);
    expect(props.length).toBeGreaterThanOrEqual(8);
    for (const k of ['box', 'ghost', 'butterfly', 'leaf'] as const) expect(r[k], k).toBeDefined();
    for (const [k, spec] of Object.entries(r)) {
      expect(ALIEN_MODULE.clips, k).toContain(resolveForCharacter(ALIEN_MODULE, spec.clip));
      expect(spec.clip, k).toSatisfy((c: AnimClip) => ALIEN_MODULE.clips.includes(c));
      if (spec.mood) expect(MOODS).toContain(spec.mood);
    }
    // The laser is the strongest reaction: the longest one and an excited mood.
    const longest = Math.max(...Object.values(r).map((s) => s.durationMs ?? 0));
    expect(r.laser?.durationMs).toBe(longest);
    expect(r.laser?.mood).toBe('excited');
  });

  it('loves technology and the sky, shrugs at storms and water', () => {
    const a = ALIEN_MODULE.behavior.eventAffinity;
    expect(Object.keys(a).length).toBeGreaterThanOrEqual(6);
    for (const id of Object.keys(a)) expect(WORLD_EVENT_IDS as readonly string[]).toContain(id);
    expect(a.tinyUfo).toBeGreaterThan(2);
    expect(a.fallingStar).toBeGreaterThan(1.5);
    expect(a.miniTsunami).toBeLessThan(1);
    expect(a.thunderstorm).toBeLessThan(1);
  });

  it('is curious and lively: explores and follows the cursor more than average, rests less', () => {
    const b = ALIEN_MODULE.behavior;
    expect(b.exploreBias).toBeGreaterThan(1);
    expect(b.cursorInterest).toBeGreaterThan(1);
    expect(b.restBias).toBeLessThan(1);
    expect(b.speedScale).toBeGreaterThanOrEqual(1);
  });

  it('has a synthetic, high voice that never repeats faster than two seconds', () => {
    const s = ALIEN_MODULE.sound;
    expect(s.voice).toBe('synthetic');
    expect(s.pitch).toBeGreaterThan(1.1);
    expect(s.cooldownMs).toBeGreaterThanOrEqual(2000);
  });

  it('offers four readable palettes: dark outline on light desktops, light body and glow on dark ones', () => {
    expect(ALIEN_MODULE.skins.length).toBeGreaterThanOrEqual(4);
    for (const id of ALIEN_MODULE.skins) {
      const p = PALETTES[id];
      expect(p, id).toBeDefined();
      expect(contrast(p!.outline, '#eef1f6'), `${id} outline on light`).toBeGreaterThan(7);
      expect(contrast(p!.body, '#1b2230'), `${id} body on dark`).toBeGreaterThan(5);
      expect(contrast(p!.glow, '#1b2230'), `${id} glow on dark`).toBeGreaterThan(7);
      expect(contrast(p!.outline, p!.body), `${id} outline against body`).toBeGreaterThan(5);
      expect(contrast(p!.eye, p!.body), `${id} eye against body`).toBeGreaterThan(7);
    }
    expect(new Set(ALIEN_MODULE.skins.map((s) => PALETTES[s]!.body)).size).toBe(ALIEN_MODULE.skins.length);
  });

  it('has English and Turkish copy for every key, without the old product names', () => {
    expect(Object.keys(alienTr).sort()).toEqual(Object.keys(alienEn).sort());
    for (const v of [...Object.values(alienEn), ...Object.values(alienTr)]) {
      expect(v.length).toBeGreaterThan(2);
      expect(v).not.toMatch(/desktop cat|gizecat|gizemate/i);
    }
  });
});
