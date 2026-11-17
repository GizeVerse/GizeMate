// A recording fake of the Web Audio slice sound.ts uses: running a cue recipe on it yields a canonical
// description of the node graph (types, params, scheduling, wiring) and a fingerprint of it. Shared by the
// offline audio review (page side) and tests/unit/renderer/soundAnalysis.test.ts (node side), so a recipe
// change shows up as a fingerprint change against the committed analysis baseline.
'use strict';

const r6 = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);

function createRecorder() {
  const nodes = [];
  const mkParam = (owner, name, init) => {
    const rec = { v: init, ev: [] };
    owner.params[name] = rec;
    return {
      owner: owner.id,
      name,
      get value() {
        return rec.v;
      },
      set value(x) {
        rec.v = x;
      },
      setValueAtTime: (v, t) => rec.ev.push(['s', r6(v), r6(t)]),
      linearRampToValueAtTime: (v, t) => rec.ev.push(['l', r6(v), r6(t)]),
      exponentialRampToValueAtTime: (v, t) => rec.ev.push(['e', r6(v), r6(t)]),
    };
  };
  const mk = (kind, params) => {
    const node = { id: nodes.length, kind, type: '', params: {}, outs: [], start: null, stop: null };
    nodes.push(node);
    const api = {
      node,
      get type() {
        return node.type;
      },
      set type(v) {
        node.type = v;
      },
      buffer: null,
      loop: false,
      connect: (d) => node.outs.push(d && d.node ? d.node.id : d && d.owner !== undefined ? `${d.owner}.${d.name}` : '?'),
      disconnect: () => undefined,
      start: (t = 0) => {
        node.start = r6(t);
      },
      stop: (t = 0) => {
        node.stop = r6(t);
      },
    };
    for (const [name, init] of Object.entries(params)) api[name] = mkParam(node, name, init);
    return api;
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    state: 'running',
    destination: mk('dest', {}),
    createOscillator: () => mk('osc', { frequency: 440 }),
    createGain: () => mk('gain', { gain: 1 }),
    createBiquadFilter: () => mk('biquad', { frequency: 350, Q: 1 }),
    createBuffer: (c, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => mk('noise', {}),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { ctx, nodes };
}

/** Canonical string of the recorded graph. */
function describeGraph(nodes) {
  return JSON.stringify(
    nodes.map((n) => [n.id, n.kind, n.type, n.start, n.stop, n.outs, Object.entries(n.params).map(([k, p]) => [k, r6(p.v), p.ev])]),
  );
}

module.exports = { createRecorder, describeGraph };
