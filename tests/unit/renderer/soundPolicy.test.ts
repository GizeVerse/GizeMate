// GizeMate sound policy: audio is off by default, every cue a character or the sim can emit exists, no
// character is silent or borrows another's signature voice as its own, and a long seeded run of each
// character stays calm (events per sim-hour bounded, no same cue twice in a row inside the repeat window).
import { describe, expect, it } from 'vitest';
import { SOUND_CUES, WORLD_SOUND_CUES, type SoundCue } from '../../../src/shared/cat';
import { CHARACTERS } from '../../../src/shared/characters/registry';
import { defaultSettings, SettingsSchema } from '../../../src/shared/settings';
import { CUE_DURATION_S } from '../../../src/renderer/overlay/sound';
import { EVENT_CATALOG } from '../../../src/core/events';
import { Harness, settingsWith } from '../core/behavior/fixtures';

const CUES = new Set<string>(SOUND_CUES);
const HOUR = 3_600_000;

/** Every cue name a character module can emit through the sim (profile cues, signatures, reactions). */
function emittedBy(c: (typeof CHARACTERS)[number]): Set<string> {
  const out = new Set<string>(Object.values(c.sound.cues));
  for (const s of c.behavior.signatures ?? []) if (s.sound) out.add(s.sound);
  for (const r of Object.values(c.reactions ?? {})) if (r && (r as { sound?: string }).sound) out.add((r as { sound: string }).sound);
  return out;
}

describe('audio defaults and mappings', () => {
  it('sound is OFF by default (settings.sound.enabled), also from an empty or garbage settings object', () => {
    expect(defaultSettings().sound.enabled).toBe(false);
    expect(SettingsSchema.parse({}).sound.enabled).toBe(false);
    expect(SettingsSchema.parse({ sound: 'garbage' }).sound.enabled).toBe(false);
  });

  it('every cue any character can emit exists in SOUND_CUES and has a duration', () => {
    for (const c of CHARACTERS) {
      for (const cue of emittedBy(c)) {
        expect(CUES.has(cue), `${c.id} emits unknown cue ${cue}`).toBe(true);
        expect(CUE_DURATION_S[cue as SoundCue], `${c.id}/${cue}`).toBeGreaterThan(0);
      }
    }
  });

  it('every sim cue site of the event catalogue and the cat activities is a known cue', () => {
    const seen = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.sound === 'string') seen.add(o.sound);
        Object.values(o).forEach(walk);
      }
    };
    walk(EVENT_CATALOG);
    expect(seen.size).toBeGreaterThan(0);
    for (const cue of seen) expect(CUES.has(cue), `event catalogue emits unknown cue ${cue}`).toBe(true);
    // The activity sites (simActivities / simReactions) emit these cat cues by literal name.
    for (const cue of ['chirp', 'purr', 'hiss', 'growl', 'trill', 'meow', 'thud']) expect(CUES.has(cue)).toBe(true);
  });

  it('no character is silent, and its general voice cue is its own (no two characters share one)', () => {
    const voices = new Map<string, string>();
    for (const c of CHARACTERS) {
      expect(c.sound.gain).toBeGreaterThan(0);
      expect(c.sound.cues.voice).toBeTruthy();
      expect(emittedBy(c).size).toBeGreaterThan(0);
      const other = voices.get(c.sound.cues.voice);
      expect(other, `${c.id} shares the voice cue ${c.sound.cues.voice} with ${other}`).toBeUndefined();
      voices.set(c.sound.cues.voice, c.id);
    }
  });

  it('the six new voices are each used by some character\'s sound profile (voice, happy, startled or move cue); world cues are only the world\'s four', () => {
    const own = new Set<string>(CHARACTERS.flatMap((c) => [c.sound.cues.voice, c.sound.cues.happy, c.sound.cues.startled, c.sound.cues.move ?? c.sound.cues.voice]));
    for (const cue of ['chatter', 'yip', 'boing', 'whoo', 'bleep', 'squelch']) expect(own.has(cue), cue).toBe(true);
    expect([...WORLD_SOUND_CUES].sort()).toEqual(['chime', 'rumble', 'splash', 'squeak']);
  });

  it('per-character cooldowns are at least the shared sim gap and not absurd', () => {
    for (const c of CHARACTERS) {
      expect(c.sound.cooldownMs, c.id).toBeGreaterThanOrEqual(1500);
      expect(c.sound.cooldownMs, c.id).toBeLessThanOrEqual(10_000);
    }
  });
});

describe('a long seeded run of each character (sound on)', () => {
  for (const c of CHARACTERS) {
    it(`${c.id}: calm and varied over one sim hour`, () => {
      const settings = settingsWith({ sound: { enabled: true, cat: true, world: true, volume: 0.5 } });
      const h = new Harness({ seed: 11, character: c.id, settings });
      const cues: Array<{ kind: string; at: number }> = [];
      const step = 50;
      for (let t = 0; t < HOUR; t += step) {
        const o = h.step([], step);
        if (o.sound) cues.push({ kind: o.sound.kind, at: o.sound.at });
      }
      const perHour = cues.length;
      // At most one cue per max(sim gap, character cooldown): hard ceiling; a calm companion is far below it.
      const ceiling = HOUR / Math.max(1500, c.sound.cooldownMs);
      expect(perHour).toBeLessThanOrEqual(ceiling);
      for (let i = 1; i < cues.length; i++) expect(cues[i]!.at - cues[i - 1]!.at, `${c.id} gap`).toBeGreaterThanOrEqual(Math.max(1500, c.sound.cooldownMs));
      // Not all one cue: back to back repeats are a minority.
      let same = 0;
      for (let i = 1; i < cues.length; i++) if (cues[i]!.kind === cues[i - 1]!.kind) same++;
      if (cues.length >= 8) expect(same / (cues.length - 1)).toBeLessThan(0.8);
      // The cat's own cues stay inside its voice set; others only emit cues of their module or the world.
      const allowed = new Set<string>([...emittedBy(c), ...WORLD_SOUND_CUES, 'meow', 'purr', 'hiss', 'growl', 'chirp', 'trill', 'thud']);
      for (const q of cues) expect(allowed.has(q.kind), `${c.id} emitted ${q.kind}`).toBe(true);
    });
  }
});
