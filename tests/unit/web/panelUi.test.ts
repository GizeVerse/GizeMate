// The shared parts of the web panels (src/web/ui/*) driven through a tiny fake DOM and the REAL web
// allow-list (applyWebPatch): the four-area tab bar (a native radio group: one tab stop, arrows by the browser), the Characters area (seven live
// previews drawn by the real renderers onto a recorded 2D context, one shared loop, no leaks on dispose,
// choosing a character), Customize (the active character's name and palette go to the right settings leaves;
// the secret-name note stays attached to the real name input), and the core Settings (language).
// REAL: view logic, allow-list, renderers' draw calls. MOCKED: the DOM and the canvas context. UNVERIFIED here:
// layout, touch targets and the look (needs a browser).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter, type CharacterId } from '../../../src/shared/characters/registry';
import { defaultSettings, type Settings } from '../../../src/shared/settings';
import type { WebSecretName } from '../../../src/web/secretName';
import { applyWebPatch } from '../../../src/web/settingsModel';
import { setLocale, WS } from '../../../src/web/strings';
import { createActiveCard, createCharactersView } from '../../../src/web/ui/charactersView';
import { createCustomizeView } from '../../../src/web/ui/customizeView';
import { createPreviewLoop } from '../../../src/web/ui/previewLoop';
import { createCoreSettings } from '../../../src/web/ui/settingsView';
import { createTabs } from '../../../src/web/ui/tabs';
import { FakeElement, installFakeDom, type FakeDocument } from './fakeDom';

let dom: ReturnType<typeof installFakeDom>;
let doc: FakeDocument;
beforeEach(() => {
  dom = installFakeDom();
  doc = dom.doc;
});
afterEach(() => {
  dom.restore();
  setLocale('en');
});

const el = (x: unknown): FakeElement => x as FakeElement;
const radios = (root: unknown): FakeElement[] => el(root).findAll((e) => e.tagName === 'input' && e.attrs.get('type') === 'radio');
const radio = (root: unknown, value: string): FakeElement => {
  const r = radios(root).find((e) => e.attrs.get('value') === value);
  if (!r) throw new Error(`no radio ${value}`);
  return r;
};

/** A settings store behind the real allow-list, like main.ts's applyPatch. */
function store(initial: Settings = defaultSettings()) {
  const state = { settings: initial, patches: [] as unknown[], refused: [] as string[] };
  return {
    state,
    get: () => state.settings,
    apply: (patch: Record<string, Record<string, unknown>>) => {
      state.patches.push(patch);
      const r = applyWebPatch(state.settings, patch);
      if (r.ok) state.settings = r.settings;
      else state.refused.push(r.error);
      return r;
    },
  };
}

function fakeLoop() {
  let n = 0;
  const q = new Map<number, (t: number) => void>();
  const loop = createPreviewLoop({
    raf: (cb) => {
      q.set(++n, cb);
      return n;
    },
    caf: (id) => void q.delete(id),
    hidden: () => false,
  });
  return { loop, pending: () => q.size };
}

describe('the four-area tab bar', () => {
  function build() {
    const panels = ['home', 'characters', 'customize', 'settings'].map((id) => ({ id, label: id.toUpperCase(), panel: doc.createElement('div') as unknown as HTMLElement }));
    const seen: string[] = [];
    const tabs = createTabs({ label: 'Sections', tabs: panels, onSelect: (id) => seen.push(id) });
    const inputs = el(tabs.bar).findAll((e) => e.tagName === 'input');
    return { tabs, panels, inputs, seen };
  }

  it('is one native radio group (the browser gives one tab stop and the arrow keys), with no key handler of ours', () => {
    const { tabs, panels, inputs } = build();
    expect(el(tabs.bar).attrs.get('role')).toBe('radiogroup');
    expect(el(tabs.bar).attrs.get('aria-label')).toBe('Sections');
    expect(inputs.map((i) => i.attrs.get('type'))).toEqual(['radio', 'radio', 'radio', 'radio']);
    expect(new Set(inputs.map((i) => i.attrs.get('name'))).size).toBe(1);
    expect(inputs.map((i) => i.checked)).toEqual([true, false, false, false]);
    expect(panels.map((p) => el(p.panel).hidden)).toEqual([false, true, true, true]);
    inputs.forEach((input, i) => {
      expect(input.attrs.get('aria-controls')).toBe(el(panels[i]?.panel).id);
      expect(el(panels[i]?.panel).attrs.get('role')).toBe('region');
    });
    // A key event on the bar does nothing: only the browser's radio behaviour moves the choice.
    el(tabs.bar).dispatch('keydown', { key: 'ArrowRight' });
    expect(tabs.current).toBe('home');
  });

  it('the browser moving the checked radio (arrow keys) selects the area and shows only its panel', () => {
    const { tabs, panels, inputs, seen } = build();
    // What a native arrow key does: checks the neighbour and fires change on it.
    inputs[1]?.click();
    expect(tabs.current).toBe('characters');
    expect(inputs.map((i) => i.checked)).toEqual([false, true, false, false]);
    expect(panels.map((p) => el(p.panel).hidden)).toEqual([true, false, true, true]);
    inputs[3]?.click();
    inputs[0]?.click();
    expect(seen).toEqual(['characters', 'settings', 'home']);
  });

  it('select() works from code (focusing the option), reports nothing for the current one, and relabels', () => {
    const { tabs, inputs, seen } = build();
    tabs.select('customize', true);
    expect(doc.activeElement).toBe(inputs[2]);
    expect(inputs[2]?.checked).toBe(true);
    tabs.select('customize');
    tabs.select('nonsense');
    expect(seen).toEqual(['customize']);
    tabs.setLabels({ customize: 'Özelleştir' });
    expect(el(tabs.bar).findAll((e) => e.tagName === 'label')[2]?.textContent).toBe('Özelleştir');
  });
});

describe('the Characters area', () => {
  it('shows all seven characters, each on its own canvas drawn by its real renderer', () => {
    const { loop } = fakeLoop();
    const s = store();
    const view = createCharactersView({ getSettings: s.get, choose: () => undefined, previews: loop });
    const cards = el(view.root).findAll((e) => e.attrs.get('data-character') !== undefined);
    expect(cards.map((c) => c.attrs.get('data-character'))).toEqual(CHARACTERS.map((c) => c.id));
    expect(loop.size).toBe(7);
    loop.setActive(true);
    // Each preview drew a first still frame onto its own context: real draw calls, all numbers finite.
    expect(doc.contexts.length).toBeGreaterThanOrEqual(7);
    for (const c of doc.contexts) {
      expect(c.calls.length).toBeGreaterThan(0);
      expect(c.nonFinite).toEqual([]);
      expect(c.depth()).toBe(0);
    }
    const canvases = el(view.root).findAll((e) => e.tagName === 'canvas');
    expect(canvases).toHaveLength(7);
    for (const canvas of canvases) {
      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.attrs.get('role')).toBe('img');
      expect(canvas.attrs.get('aria-label')).toMatch(/\S/);
    }
    view.dispose();
    expect(loop.size).toBe(0);
  });

  it('describes each character (description, personality, interactions) and badges its capabilities', () => {
    const { loop } = fakeLoop();
    const view = createCharactersView({ getSettings: () => defaultSettings(), choose: () => undefined, previews: loop });
    for (const mod of CHARACTERS) {
      const card = el(view.root).find((e) => e.attrs.get('data-character') === mod.id);
      const text = card?.textContent ?? '';
      expect(text, mod.id).toContain(WS.characters.kind[mod.kind]);
      expect(text, mod.id).toContain(WS.characters.locomotion[mod.locomotion]);
      if (mod.capabilities.flies) expect(text, mod.id).toContain(WS.characters.capability.flies);
      expect(text.length, mod.id).toBeGreaterThan(80);
    }
    view.dispose();
  });

  it('choosing a character sends it once; the active one is marked and cannot be chosen again as new', () => {
    const { loop } = fakeLoop();
    const s = store();
    const chosen: CharacterId[] = [];
    const view = createCharactersView({ getSettings: s.get, choose: (id) => chosen.push(id), previews: loop });
    const pick = (id: string) => el(view.root).find((e) => e.attrs.get('data-character') === id)?.find((e) => e.tagName === 'button') as FakeElement;
    expect(pick('cat').attrs.get('aria-pressed')).toBe('true');
    expect(pick('fox').attrs.get('aria-pressed')).toBe('false');
    expect(pick('fox').attrs.get('aria-label')).toBe(WS.characters.chooseLabel('Fox'));
    pick('fox').click();
    expect(chosen).toEqual(['fox']);
    // The same choice through the real allow-list: it is accepted and becomes the active character.
    const r = s.apply({ general: { activeCharacter: 'fox' } });
    expect(r.ok).toBe(true);
    view.refresh();
    expect(pick('fox').attrs.get('aria-pressed')).toBe('true');
    expect(pick('cat').attrs.get('aria-pressed')).toBe('false');
    view.dispose();
  });

  it('the active card on Home follows the active character and leaves nothing behind', () => {
    const { loop } = fakeLoop();
    const s = store();
    const card = createActiveCard({ getSettings: s.get, previews: loop });
    expect(loop.size).toBe(1);
    s.apply({ general: { activeCharacter: 'ghost' } });
    card.refresh();
    expect(loop.size).toBe(1);
    expect(card.root.textContent).toContain('Ghost');
    card.dispose();
    expect(loop.size).toBe(0);
  });

  it('no preview is scheduled under reduced motion', () => {
    const { loop, pending } = fakeLoop();
    const view = createCharactersView({ getSettings: () => defaultSettings(), choose: () => undefined, previews: loop });
    loop.setReducedMotion(true);
    loop.setActive(true);
    expect(pending()).toBe(0);
    loop.setReducedMotion(false);
    expect(pending()).toBe(1);
    view.dispose();
    expect(pending()).toBe(0);
  });
});

describe('Customize edits the ACTIVE character', () => {
  it('the cat: name goes to general.catName, the coat to appearance.skin', () => {
    const s = store();
    const view = createCustomizeView({ getSettings: s.get, apply: s.apply });
    view.nameInput.value = 'Pamuk';
    el(view.nameInput).dispatch('change');
    expect(s.get().general.catName).toBe('Pamuk');
    radio(view.root, 'tuxedo').click();
    expect(s.get().appearance.skin).toBe('tuxedo');
    expect(s.get().general.characterNames).toEqual({});
  });

  it('another character: name to general.characterNames[id], palette to appearance.characterSkins[id], from its own palettes', () => {
    const s = store();
    s.apply({ general: { activeCharacter: 'fox' } });
    const view = createCustomizeView({ getSettings: s.get, apply: s.apply });
    expect(radios(view.root).filter((r) => (getCharacter('fox').skins).includes(r.attrs.get('value') ?? '')).length).toBe(getCharacter('fox').skins.length);
    expect(view.root.textContent).toContain(WS.customize.forCharacter('Fox'));
    view.nameInput.value = 'Rusty';
    el(view.nameInput).dispatch('change');
    expect(s.get().general.characterNames['fox']).toBe('Rusty');
    expect(s.get().general.catName).not.toBe('Rusty');
    const second = getCharacter('fox').skins[1] ?? '';
    radio(view.root, second).click();
    expect(s.get().appearance.characterSkins['fox']).toBe(second);
    expect(s.get().appearance.skin).toBe(defaultSettings().appearance.skin);
    expect(view.root.textContent).toContain(WS.customize.forCharacter('Rusty'));
  });

  it('an empty name is refused, the old one is put back, and the field says so', () => {
    const s = store();
    const view = createCustomizeView({ getSettings: s.get, apply: s.apply });
    const before = s.get().general.catName;
    view.nameInput.value = '   ';
    el(view.nameInput).dispatch('change');
    expect(view.nameInput.value).toBe(before);
    expect(el(view.root).findAll((e) => e.classes.has('error'))[0]?.textContent).toBe(WS.cat.nameInvalid);
  });

  it('keeps the secret-name note attached to the real name input, inside its row, whatever the active character', () => {
    const calls: string[] = [];
    let listener: (() => void) | null = null;
    const secret: WebSecretName = {
      available: true,
      setName: (n) => void calls.push(`name:${n}`),
      setTyped: (n) => void calls.push(`typed:${n}`),
      holdNote: () => () => undefined,
      state: () => ({ active: true, message: 'note' }),
      accessory: () => undefined,
      subscribe: (cb) => {
        listener = () => cb({ active: true, message: 'note' });
        return () => undefined;
      },
      onAccessoryChange: () => () => undefined,
      dispose: () => undefined,
    };
    const s = store();
    s.apply({ general: { activeCharacter: 'monkey' } });
    const view = createCustomizeView({ getSettings: s.get, apply: s.apply, secret });
    // The note element sits right after the input, in the same field row as the label.
    const row = el(view.nameInput).parent;
    expect(row?.classes.has('field')).toBe(true);
    expect(row?.find((e) => e.tagName === 'label')).not.toBeNull();
    const note = row?.children.find((c) => c instanceof FakeElement && c.classes.has('note')) as FakeElement | undefined;
    expect(note?.textContent).toBe('note');
    view.nameInput.value = 'Bobo';
    el(view.nameInput).dispatch('input');
    el(view.nameInput).dispatch('change');
    expect(calls).toContain('typed:Bobo');
    expect(calls).toContain('name:Bobo');
    expect(listener).not.toBeNull();
  });

  it('every behaviour, animation and interaction control goes through the allow-list', () => {
    const s = store();
    const view = createCustomizeView({ getSettings: s.get, apply: s.apply });
    const switches = el(view.root).findAll((e) => e.attrs.get('role') === 'switch');
    expect(switches.length).toBeGreaterThan(30); // behaviour, 26+ world events, animation, interactions
    for (const sw of switches) sw.click();
    // Every click produced a patch (hunting is two: the chase and the pounce) and the allow-list refused none.
    expect(s.state.patches.length).toBeGreaterThanOrEqual(switches.length);
    expect(s.state.refused).toEqual([]);
    expect(radios(view.root).length).toBeGreaterThan(15);
  });
});

describe('the core settings', () => {
  it('language: automatic, English and Turkish, saved as general.language', () => {
    const s = store();
    const core = createCoreSettings({ getSettings: s.get, apply: s.apply });
    expect(radios(core.language).map((r) => r.attrs.get('value'))).toEqual(['auto', 'en', 'tr']);
    expect(radio(core.language, 'auto').checked).toBe(true);
    radio(core.language, 'tr').click();
    expect(s.get().general.language).toBe('tr');
    radio(core.language, 'auto').click();
    expect(s.get().general.language).toBe('auto');
  });

  it('turning sound on runs the gesture hook first; reduced motion is saved', () => {
    const s = store();
    let gestures = 0;
    const core = createCoreSettings({ getSettings: s.get, apply: s.apply, onSoundGesture: () => void (gestures += 1) });
    const sw = el(core.sound).findAll((e) => e.attrs.get('role') === 'switch')[0] as FakeElement;
    sw.click();
    expect(gestures).toBe(1);
    expect(s.get().sound.enabled).toBe(true);
    const reduced = el(core.accessibility).findAll((e) => e.attrs.get('role') === 'switch')[0] as FakeElement;
    reduced.click();
    expect(s.get().companion.reducedMotion).toBe(true);
  });
});
