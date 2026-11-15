// The ghost module's specifics: voice and tuning, signature actions that are all drawn natively,
// reactions whose clips resolve, palettes for every skin, and the copy in both languages.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, SOUND_CUES } from '../../../../src/shared/cat';
import { CLIP_META } from '../../../../src/shared/animationCatalog';
import { PROP_KINDS, WORLD_EVENT_IDS } from '../../../../src/shared/companion';
import { resolveForCharacter } from '../../../../src/core/behavior/character';
import { GHOST_MODULE as m } from '../../../../src/shared/characters/ghost';
import { ghostEn, ghostTr } from '../../../../src/shared/i18n/characters/ghost';
import { GHOST_PALETTES } from '../../../../src/renderer/overlay/characters/ghost/palette';

describe('ghost module', () => {
  it('is a floating, flying, pass-through fantasy character with a hollow voice and 5 palettes', () => {
    expect(m.kind).toBe('fantasy');
    expect(m.locomotion).toBe('float');
    expect(m.capabilities).toMatchObject({ flies: true, passesThrough: true, climbsEdges: false });
    expect(m.sound.voice).toBe('hollow');
    expect(m.sound.cooldownMs).toBeGreaterThanOrEqual(2000);
    expect(m.skins.length).toBeGreaterThanOrEqual(4);
    for (const s of m.skins) expect(GHOST_PALETTES[s], s).toBeDefined();
    expect(m.skins[0]).toBe('pale');
  });

  it('is mischievous and playful by nature, and lively between tricks', () => {
    expect(m.personality.means.mischief).toBeGreaterThanOrEqual(0.8);
    expect(m.personality.means.playfulness).toBeGreaterThanOrEqual(0.7);
    expect(m.behavior.exploreBias).toBeGreaterThan(1);
    expect(m.behavior.playBias).toBeGreaterThan(1);
    expect(m.behavior.restBias).toBeLessThan(1);
  });

  it('loves and avoids at least six world events, all real', () => {
    const e = m.behavior.eventAffinity;
    expect(Object.keys(e).length).toBeGreaterThanOrEqual(6);
    for (const k of Object.keys(e)) expect((WORLD_EVENT_IDS as readonly string[]).includes(k)).toBe(true);
    expect(e.littleGhost).toBeGreaterThan(1);
    expect(Object.values(e).some((v) => (v) < 1)).toBe(true);
  });

  it('has 5+ signature actions in the 20 s..5 min cooldown band, each carried by a natively drawn clip', () => {
    const sigs = m.behavior.signatures;
    expect(sigs.length).toBeGreaterThanOrEqual(5);
    for (const s of sigs) {
      expect(s.cooldownMs, s.id).toBeGreaterThanOrEqual(20_000);
      expect(s.cooldownMs, s.id).toBeLessThanOrEqual(300_000);
      expect(m.clips.includes(s.clip), `${s.id} main clip ${s.clip}`).toBe(true);
      for (const c of s.leadIn ?? []) expect(m.clips.includes(c), `${s.id} lead-in ${c}`).toBe(true);
      expect(resolveForCharacter(m, s.clip)).toBe(s.clip);
    }
    const ids = sigs.map((s) => s.id);
    for (const id of ['vanishAppear', 'peekaboo', 'boo', 'hauntDrift', 'phaseThrough', 'spinFloat']) expect(ids).toContain(id);
    const tele = sigs.find((s) => s.id === 'vanishAppear')!;
    expect(tele.movement).toBe('teleport');
    expect(m.clips.includes('vanish') && m.clips.includes('appear')).toBe(true);
    // The highest-value trick is the most likely one.
    expect(tele.weight).toBe(Math.max(...sigs.map((s) => s.weight)));
    // One-shot signature clips have a catalogue length the action can wait for.
    for (const s of sigs) if (CLIP_META[s.clip].durationS !== null) expect(s.durationMs[1]).toBeGreaterThanOrEqual(CLIP_META[s.clip].durationS! * 1000 - 1);
  });

  it('answers petted, held, startled, cursorNear, laser and 8+ props with clips it can draw', () => {
    for (const k of ['petted', 'held', 'startled', 'cursorNear', 'laser'] as const) expect(m.reactions[k], k).toBeDefined();
    const props = Object.keys(m.reactions).filter((k) => (PROP_KINDS as readonly string[]).includes(k));
    expect(props.length).toBeGreaterThanOrEqual(8);
    for (const k of ['ghost', 'box', 'leaf', 'butterfly', 'yarn']) expect(props).toContain(k);
    for (const [k, r] of Object.entries(m.reactions)) {
      expect(m.clips.includes(resolveForCharacter(m, r.clip)), k).toBe(true);
      expect(m.clips.includes(r.clip), `${k} reaction clip ${r.clip} is native`).toBe(true);
      expect(r.emote, k).toBeDefined();
    }
    expect(m.reactions.laser?.clip).toBe('crouch');
  });

  it('draws every vocabulary clip natively or through an alias onto a native clip', () => {
    expect(m.clips.length).toBeGreaterThanOrEqual(20);
    for (const c of ANIM_CLIPS) expect(m.clips.includes(resolveForCharacter(m, c)), c).toBe(true);
    for (const c of ['walk', 'run'] as const) expect(m.clipAlias[c]).toBe('float');
    for (const c of ['stand', 'float', 'sleep', 'wake', 'yawn', 'jump', 'fall', 'land', 'startle', 'petted', 'held', 'hide', 'peek', 'vanish', 'appear', 'dance', 'scan', 'squish']) expect(m.clips).toContain(c);
  });

  it('uses valid cues and is voiced by whoo and chime', () => {
    const cues = new Set<string>(SOUND_CUES);
    expect(cues.has(m.sound.cues.voice) && cues.has(m.sound.cues.happy) && cues.has(m.sound.cues.startled)).toBe(true);
    expect(m.sound.cues.voice).toBe('whoo');
    expect(m.sound.cues.happy).toBe('chime');
  });

  it('has complete English and Turkish copy that mentions no hidden feature', () => {
    for (const k of Object.keys(ghostEn) as Array<keyof typeof ghostEn>) {
      expect(ghostEn[k].length, k).toBeGreaterThan(3);
      expect(ghostTr[k].length, k).toBeGreaterThan(3);
      expect(ghostTr[k], k).not.toBe(ghostEn[k]);
    }
    expect(JSON.stringify([ghostEn, ghostTr]).toLowerCase()).not.toMatch(/pendant|secret|desktop cat|gizecat/);
  });
});
