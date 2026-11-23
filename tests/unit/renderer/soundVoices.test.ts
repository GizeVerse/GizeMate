/* eslint-disable @typescript-eslint/no-explicit-any -- the recording fake builds loosely typed Web Audio nodes */
// GizeMate: character voices in the procedural sound layer. The graph is recorded by a fake
// AudioContext (MOCKED: nothing is heard; audio quality is UNVERIFIED by ear).
import { describe, expect, it } from 'vitest';
import { SOUND_CUES, type CatSoundCue, type SoundCue } from '../../../src/shared/cat';
import { CHARACTERS, getCharacter } from '../../../src/shared/characters/registry';
import type { CharacterId } from '../../../src/shared/characters/types';
import { createSoundPlayer, CUE_DURATION_S, MIN_GAP_MS, type AudioBufferLike, type AudioContextLike } from '../../../src/renderer/overlay/sound';

type Ev = [string, number, number];
interface RNode {
  id: number;
  kind: string;
  type: string;
  params: Record<string, { value: number; events: Ev[] }>;
  outs: Array<number | string>;
  startAt?: number;
  stopAt?: number;
}

/** A recording AudioContext: every node, param event and connection, in creation order. */
class Rec implements AudioContextLike {
  currentTime = 5;
  readonly sampleRate = 8000;
  state = 'running';
  readonly nodes: RNode[] = [];
  readonly destination = this.make('destination', []);
  private make(kind: string, params: string[]): any {
    const node: RNode = { id: this.nodes.length, kind, type: '', params: {}, outs: [] };
    this.nodes.push(node);
    const api: any = {
      node,
      get type() {
        return node.type;
      },
      set type(v: string) {
        node.type = v;
      },
      buffer: null,
      loop: false,
      connect: (d: any) => {
        node.outs.push(d?.node ? d.node.id : d?.owner !== undefined ? `${d.owner}.${d.name}` : '?');
      },
      disconnect: () => undefined,
      start: (t = 0) => {
        node.startAt = t;
      },
      stop: (t = 0) => {
        node.stopAt = t;
      },
    };
    for (const name of params) {
      const rec = { value: 0, events: [] as Ev[] };
      node.params[name] = rec;
      api[name] = {
        owner: node.id,
        name,
        get value() {
          return rec.value;
        },
        set value(v: number) {
          rec.value = v;
          rec.events.push(['val', v, 0]);
        },
        setValueAtTime: (v: number, t: number) => rec.events.push(['set', v, t]),
        linearRampToValueAtTime: (v: number, t: number) => rec.events.push(['lin', v, t]),
        exponentialRampToValueAtTime: (v: number, t: number) => rec.events.push(['exp', v, t]),
      };
    }
    return api;
  }
  createOscillator() {
    return this.make('osc', ['frequency']);
  }
  createBufferSource() {
    return this.make('buf', []);
  }
  createGain() {
    return this.make('gain', ['gain']);
  }
  createBiquadFilter() {
    return this.make('filter', ['frequency', 'Q']);
  }
  createBuffer(_c: number, length: number): AudioBufferLike {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  sources(): RNode[] {
    return this.nodes.filter((n) => n.kind === 'osc' || n.kind === 'buf');
  }
  /** The gain wired to the destination (the output stage). */
  out(): RNode {
    return this.nodes.find((n) => n.kind === 'gain' && n.outs.includes(0))!;
  }
  oscs(): RNode[] {
    return this.nodes.filter((n) => n.kind === 'osc');
  }
}

function rig(audio: () => AudioContextLike = () => new Rec()) {
  let now = 1000;
  const made: AudioContextLike[] = [];
  const player = createSoundPlayer({
    now: () => now,
    audio: () => {
      const a = audio();
      made.push(a);
      return a;
    },
    setTimer: () => 1,
    clearTimer: () => undefined,
  });
  return { player, made, advance: (ms: number) => void (now += ms), rec: () => made.at(-1) as Rec };
}

const cue = (kind: SoundCue, at: number, volume = 1): CatSoundCue => ({ kind, at, volume });
const PLAY_AT = 100_000;

function render(kind: SoundCue, character?: CharacterId): Rec {
  const r = rig();
  r.player.play(cue(kind, PLAY_AT), PLAY_AT, character);
  return r.rec();
}

/** FNV-1a over the whole recorded graph (node order, types, params, events, connections, start/stop). */
function fingerprint(a: Rec): string {
  const s = JSON.stringify(a.nodes);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Fingerprints of the cat's recipes as they were BEFORE the voice work (captured from the original sound.ts).
const CAT_GOLDEN: Record<string, string> = {
  meow: '2f4324fe',
  chirp: 'dc5d2cd3',
  trill: '458f4a3f',
  purr: '376042b8',
  hiss: '7db3dda6',
  growl: '5c841425',
  thud: '6dbd0e78',
  squeak: 'a4a131cb',
  rumble: '09396dec',
  chime: 'd3275f49',
  splash: 'e7d45981',
};

describe('the cat voice is unchanged', () => {
  it('matches the golden fingerprints of the original recipes (absent character and "cat" alike)', () => {
    const got: Record<string, string> = {};
    for (const kind of ['meow', 'chirp', 'trill', 'purr', 'hiss', 'growl', 'thud', 'squeak', 'rumble', 'chime', 'splash'] as const) {
      const a = fingerprint(render(kind));
      expect(fingerprint(render(kind, 'cat')), kind).toBe(a);
      got[kind] = a;
    }
    if (process.env.DUMP_GOLDEN) console.log('GOLDEN', JSON.stringify(got));
    expect(got).toEqual(CAT_GOLDEN);
  });
});

const OTHERS = CHARACTERS.map((c) => c.id).filter((id) => id !== 'cat');
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const NEW_CUES = ['chatter', 'yip', 'boing', 'whoo', 'bleep', 'squelch'] as const;

describe('every cue under every character voice', () => {
  it('schedules sources that start at once and stop by the end of the cue', () => {
    for (const id of OTHERS) {
      for (const kind of SOUND_CUES) {
        const a = render(kind, id);
        expect(a.sources().length, `${id}/${kind}`).toBeGreaterThan(0);
        for (const s of a.sources()) {
          expect(s.startAt, `${id}/${kind}`).toBeGreaterThanOrEqual(a.currentTime);
          expect(s.stopAt!, `${id}/${kind}`).toBeGreaterThan(s.startAt!);
          expect(s.stopAt!, `${id}/${kind}`).toBeLessThanOrEqual(a.currentTime + 0.01 + CUE_DURATION_S[kind] + 1e-9);
        }
        expect(a.nodes.some((n) => n.kind === 'gain' && n.outs.includes(0)), `${id}/${kind} reaches the speakers`).toBe(true);
      }
    }
  });

  it('the six new voice cues have six distinct recipes and a gentle envelope (peak <= 0.6)', () => {
    const fingerprints = new Set<string>();
    for (const kind of NEW_CUES) {
      const a = render(kind);
      expect(a.sources().length, kind).toBeGreaterThanOrEqual(1);
      fingerprints.add(fingerprint(a));
      // The cue envelope is the gain wired to the output gain; every value it takes stays <= 0.6.
      const out = a.out();
      const env = a.nodes.filter((n) => n.kind === 'gain' && n.outs.includes(out.id));
      expect(env.length, kind).toBeGreaterThanOrEqual(1);
      for (const e of env) for (const [, v] of e.params.gain!.events) expect(v, kind).toBeLessThanOrEqual(0.6);
    }
    expect(fingerprints.size).toBe(6);
  });
});

describe('voice shaping', () => {
  it('scales the pitched frequencies by the character pitch', () => {
    for (const id of OTHERS) {
      const pitch = clamp(getCharacter(id).sound.pitch, 0.5, 2);
      const a = render('chirp', id);
      const ev = a.oscs()[0]!.params.frequency!.events;
      expect(ev.find((e) => e[0] === 'set')![1], id).toBeCloseTo(1100 * pitch, 6);
      expect(ev.at(-1)![1], id).toBeCloseTo(2500 * pitch, 6);
    }
  });

  it('the highest-pitched character plays proportionally higher than the lowest', () => {
    const byPitch = OTHERS.map((id) => ({ id, pitch: getCharacter(id).sound.pitch })).sort((x, y) => x.pitch - y.pitch);
    const lo = byPitch[0]!;
    const hi = byPitch.at(-1)!;
    expect(hi.pitch).toBeGreaterThan(lo.pitch);
    const f = (id: CharacterId): number => render('yip', id).oscs()[0]!.params.frequency!.events[0]![1];
    expect(f(hi.id) / f(lo.id)).toBeCloseTo(hi.pitch / lo.pitch, 6);
  });

  it('scales the output loudness by the character gain and the volume, under the master cap', () => {
    const catOut = ((): number => {
      const r = rig();
      r.player.play(cue('chirp', PLAY_AT, 1), PLAY_AT);
      return r.rec().out().params.gain!.value;
    })();
    expect(catOut).toBeCloseTo(0.35, 9);
    for (const id of OTHERS) {
      const g = clamp(getCharacter(id).sound.gain, 0.2, 1);
      for (const vol of [0.3, 1]) {
        const r = rig();
        r.player.play(cue('chirp', PLAY_AT, vol), PLAY_AT, id);
        const v = r.rec().out().params.gain!.value;
        expect(v, `${id}@${vol}`).toBeCloseTo(vol * 0.35 * g, 9);
        expect(v).toBeLessThanOrEqual(catOut + 1e-12);
      }
    }
  });

  it('gives each timbre its own filter stage', () => {
    const stage = (id: CharacterId): string => {
      const a = render('chirp', id);
      return JSON.stringify(a.nodes.filter((n) => n.kind === 'filter').map((n) => n.type).sort());
    };
    const byVoice = new Map<string, string>();
    for (const id of OTHERS) byVoice.set(getCharacter(id).sound.voice, stage(id));
    // Different voices differ in structure or waveform mix; compare whole graphs minus pitch.
    const shape = (id: CharacterId): string => {
      const a = render('chirp', id);
      return JSON.stringify([stage(id), a.oscs().map((n) => n.type).sort(), a.nodes.length]);
    };
    const shapes = new Map<string, string>();
    for (const id of OTHERS) shapes.set(getCharacter(id).sound.voice, shape(id));
    expect(new Set(shapes.values()).size).toBeGreaterThanOrEqual(Math.min(shapes.size, 4));
  });

  it('synthetic: pitch moves in steps and square blends with triangle; hollow: a detuned second copy', () => {
    const synthId = OTHERS.find((id) => getCharacter(id).sound.voice === 'synthetic');
    const hollowId = OTHERS.find((id) => getCharacter(id).sound.voice === 'hollow');
    expect(synthId, 'a synthetic character exists').toBeDefined();
    expect(hollowId, 'a hollow character exists').toBeDefined();
    const a = render('chirp', synthId);
    const types = new Set(a.oscs().map((n) => n.type));
    expect(types.has('square') && types.has('triangle')).toBe(true);
    expect(a.oscs()[0]!.params.frequency!.events.filter((e) => e[0] === 'set').length).toBeGreaterThan(4);
    const h = render('whoo', hollowId);
    const firsts = h.oscs().map((n) => n.params.frequency!.events[0]![1]);
    const base = 360 * clamp(getCharacter(hollowId!).sound.pitch, 0.5, 2);
    expect(firsts.some((f) => Math.abs(f - base) < 1e-6)).toBe(true);
    expect(firsts.some((f) => Math.abs(f / base - 1.007) < 1e-6)).toBe(true);
  });

  it('squelchy: a resonant band-pass that sweeps', () => {
    const id = OTHERS.find((c) => getCharacter(c).sound.voice === 'squelchy');
    expect(id, 'a squelchy character exists').toBeDefined();
    const a = render('squelch', id);
    const bps = a.nodes.filter((n) => n.kind === 'filter' && n.type === 'bandpass');
    expect(bps.length).toBeGreaterThanOrEqual(2);
    expect(bps.some((n) => n.params.Q!.events.some((e) => e[1] >= 4) && n.params.frequency!.events.length >= 3)).toBe(true);
  });
});

describe('character cooldown', () => {
  const cd = (id: CharacterId): number => clamp(getCharacter(id).sound.cooldownMs, 0, 60_000);

  it('drops a second cue of the same character inside its cooldown and allows it after', () => {
    for (const id of OTHERS) {
      const r = rig();
      r.player.play(cue('chirp', 10_000), 10_000, id);
      const a = r.rec();
      const n = a.sources().length;
      const wait = Math.max(cd(id), MIN_GAP_MS);
      r.advance(wait - 50);
      r.player.play(cue('chirp', 10_000 + wait - 50), 10_000 + wait - 50, id);
      expect(a.sources().length, `${id} inside the cooldown`).toBe(n);
      // The dropped cue is consumed (never replayed late); the next one comes a full gap later.
      r.advance(MIN_GAP_MS + 100);
      r.player.play(cue('chirp', 10_000 + wait + MIN_GAP_MS + 50), 10_000 + wait + MIN_GAP_MS + 50, id);
      expect(a.sources().length, `${id} after the cooldown`).toBeGreaterThan(n);
    }
  });

  it('is kept per character: another character is not held by the first one', () => {
    const r = rig();
    r.player.play(cue('chirp', 10_000), 10_000, 'monkey');
    const a = r.rec();
    const n = a.sources().length;
    r.advance(MIN_GAP_MS + 10);
    r.player.play(cue('chirp', 10_000 + MIN_GAP_MS + 10), 10_000 + MIN_GAP_MS + 10, 'fox');
    const afterFox = a.sources().length;
    expect(afterFox, 'the fox has not spoken yet').toBeGreaterThan(n);
    r.advance(MIN_GAP_MS + 10);
    const t = 10_000 + 2 * (MIN_GAP_MS + 10);
    r.player.play(cue('chirp', t), t, 'monkey');
    // The monkey spoke 2*(gap+10) ms ago: allowed exactly when that reaches its own cooldown.
    expect(a.sources().length > afterFox).toBe(2 * (MIN_GAP_MS + 10) >= cd('monkey'));
  });

  it('never applies to the cat (its own per-cue limits stay)', () => {
    const r = rig();
    r.player.play(cue('chirp', 10_000), 10_000);
    const a = r.rec();
    const n = a.sources().length;
    r.advance(MIN_GAP_MS + 10);
    r.player.play(cue('chirp', 10_000 + MIN_GAP_MS + 10), 10_000 + MIN_GAP_MS + 10, 'cat');
    expect(a.sources().length).toBeGreaterThan(n);
  });
});

describe('safety', () => {
  it('stays silent and never throws without an AudioContext, for any character', () => {
    for (const id of [undefined, ...CHARACTERS.map((c) => c.id)]) {
      const player = createSoundPlayer({ now: () => 0 });
      expect(() => player.play(cue('whoo', 1000), 1000, id)).not.toThrow();
      player.dispose();
    }
  });

  it('an unknown character plays as the cat (identical graph); a failing graph is absorbed', () => {
    expect(fingerprint(render('meow', 'dragon' as unknown as CharacterId))).toBe(fingerprint(render('meow')));
    const broken = rig(() => {
      const f = new Rec();
      f.createBiquadFilter = () => {
        throw new Error('graph');
      };
      return f;
    });
    expect(() => broken.player.play(cue('whoo', 1000), 1000, 'ghost')).not.toThrow();
  });
});
