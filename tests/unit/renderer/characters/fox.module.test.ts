// The fox module specifics (the generic module contract is tests/unit/shared/characters.test.ts):
// identity, clip coverage, signature actions with authored clips, reactions and the copy.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, type AnimClip } from '../../../../src/shared/cat';
import { PROP_KINDS, WORLD_EVENT_IDS } from '../../../../src/shared/companion';
import { resolveForCharacter } from '../../../../src/core/behavior/character';
import { FOX_MODULE } from '../../../../src/shared/characters/fox';
import { getCharacter } from '../../../../src/shared/characters/registry';
import { resolveFoxClip } from '../../../../src/renderer/overlay/characters/fox/animator';
import { foxEn, foxTr } from '../../../../src/shared/i18n/characters/fox';

const clips: ReadonlySet<AnimClip> = new Set(FOX_MODULE.clips);

describe('the fox module', () => {
  it('is the registered fox: a walking, climbing animal with its own four palettes', () => {
    expect(getCharacter('fox')).toBe(FOX_MODULE);
    expect(FOX_MODULE.kind).toBe('animal');
    expect(FOX_MODULE.locomotion).toBe('walk');
    expect(FOX_MODULE.capabilities.climbsEdges).toBe(true);
    expect(FOX_MODULE.capabilities.flies).toBe(false);
    expect(FOX_MODULE.skins.length).toBeGreaterThanOrEqual(4);
    expect(FOX_MODULE.skins[0]).toBe('red');
  });

  it('draws the whole vocabulary: native clips plus aliases that point at native clips', () => {
    for (const c of ['stand', 'sit', 'loaf', 'sleep', 'wake', 'yawn', 'stretch', 'walk', 'run', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'peek', 'climb', 'stalk', 'pounce', 'slink', 'scan', 'groom', 'rollOver', 'swat', 'tailChase', 'confused', 'dance'] as const) {
      expect(clips.has(c), `native ${c}`).toBe(true);
    }
    for (const [from, to] of Object.entries(FOX_MODULE.clipAlias)) expect(clips.has(to), `${from} -> ${String(to)}`).toBe(true);
    for (const c of ANIM_CLIPS) {
      expect(clips.has(resolveForCharacter(FOX_MODULE, c)), c).toBe(true);
      // The renderer resolves the same way the sim does.
      expect(resolveFoxClip(c), c).toBe(resolveForCharacter(FOX_MODULE, c));
    }
  });

  it('has at least five signature actions, each with an authored (native) clip and lead-in, cooldowns of 20 s to 5 min', () => {
    const sigs = FOX_MODULE.behavior.signatures;
    expect(sigs.length).toBeGreaterThanOrEqual(5);
    for (const s of sigs) {
      expect(clips.has(s.clip), `${s.id} clip ${s.clip}`).toBe(true);
      for (const c of s.leadIn ?? []) expect(clips.has(c), `${s.id} leadIn ${c}`).toBe(true);
      expect(s.cooldownMs, s.id).toBeGreaterThanOrEqual(20_000);
      expect(s.cooldownMs, s.id).toBeLessThanOrEqual(300_000);
      expect(s.movement, s.id).not.toBe('teleport');
    }
    const ids = sigs.map((s) => s.id);
    for (const id of ['mousePounce', 'playBow', 'peekOut', 'slowStare', 'spinTrick', 'headTilt']) expect(ids).toContain(id);
    // Signatures stay flavour: the combined weight is modest next to the shared idle variations.
    expect(sigs.reduce((a, s) => a + s.weight, 0)).toBeLessThan(12);
  });

  it('reacts to petting, being held, a startle, the cursor, the laser and at least eight prop kinds, every clip native', () => {
    const r = FOX_MODULE.reactions;
    for (const k of ['petted', 'held', 'startled', 'cursorNear', 'laser'] as const) expect(r[k], k).toBeDefined();
    const props = Object.keys(r).filter((k) => (PROP_KINDS as readonly string[]).includes(k));
    expect(props.length).toBeGreaterThanOrEqual(8);
    for (const k of ['box', 'butterfly', 'ghost', 'leaf', 'yarn', 'mouse']) expect(props, k).toContain(k);
    for (const [k, spec] of Object.entries(r)) {
      expect(clips.has(spec.clip), `${k} -> ${spec.clip}`).toBe(true);
      expect(resolveForCharacter(FOX_MODULE, spec.clip), k).toBe(spec.clip);
    }
    // In character: boxes are investigated (peek), the ghost is met with suspicion, yarn is batted.
    expect(r.box?.clip).toBe('peek');
    expect(r.yarn?.clip).toBe('swat');
    expect(r.ghost?.mood).toBe('confused');
    expect(r.mouse?.clip).toBe('pounce');
  });

  it('has opinions about the world: at least six events, loving mice and butterflies, avoiding storms and water', () => {
    const a = FOX_MODULE.behavior.eventAffinity;
    expect(Object.keys(a).length).toBeGreaterThanOrEqual(6);
    for (const id of Object.keys(a)) expect((WORLD_EVENT_IDS as readonly string[]).includes(id), id).toBe(true);
    expect(a.mouseEncounter ?? 1).toBeGreaterThan(1.5);
    expect(a.butterflyEncounter ?? 1).toBeGreaterThan(1.5);
    expect(a.thunderstorm ?? 1).toBeLessThan(1);
    expect(a.miniTsunami ?? 1).toBeLessThan(1);
    expect(a.littleGhost ?? 1).toBeLessThan(1);
  });

  it('is independent, curious and shy, but lively: it explores more and rests less than the cat', () => {
    const m = FOX_MODULE.personality.means;
    expect(m.independence).toBeGreaterThan(0.75);
    expect(m.curiosity).toBeGreaterThan(0.7);
    expect(m.sociability).toBeLessThan(0.5);
    const b = FOX_MODULE.behavior;
    expect(b.exploreBias).toBeGreaterThan(1);
    expect(b.restBias).toBeLessThan(1);
    expect(b.shyness).toBeGreaterThan(1);
    expect(b.speedScale).toBeGreaterThan(1);
  });

  it('has its own voice (a yip, never a meow) with a cooldown of at least two seconds', () => {
    expect(FOX_MODULE.sound.cues.voice).toBe('yip');
    expect(FOX_MODULE.sound.cooldownMs).toBeGreaterThanOrEqual(2000);
    expect(FOX_MODULE.sound.voice).not.toBe('hollow');
  });

  it('has copy in both languages for every key, free of the product past and of any hidden feature', () => {
    for (const k of Object.keys(foxEn) as Array<keyof typeof foxEn>) {
      expect(foxEn[k].length, k).toBeGreaterThan(2);
      expect(foxTr[k].length, k).toBeGreaterThan(2);
      expect(foxTr[k], k).not.toBe(foxEn[k]);
      expect(`${foxEn[k]} ${foxTr[k]}`.toLowerCase(), k).not.toMatch(/desktop cat|gizecat|pendant|secret/);
    }
    expect(Object.keys(foxEn).sort()).toEqual(['description', 'interactions', 'name', 'personality', 'tagline']);
    expect(Object.keys(foxTr).sort()).toEqual(Object.keys(foxEn).sort());
  });
});
