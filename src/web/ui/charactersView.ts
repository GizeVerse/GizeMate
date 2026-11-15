// The CHARACTERS area (and the active-character card of HOME): each of the seven companions on a small
// canvas drawn by its real renderer (scenePreview.ts) through the one shared loop (previewLoop.ts), with
// its description, personality, what it likes to do and capability badges. Choosing one goes through
// deps.choose (the web allow-list's activeCharacter patch; the page restarts on a swap, main.ts).
// textContent only; no timers of its own.
import { CHARACTERS, type CharacterId } from '../../shared/characters/registry';
import type { Settings } from '../../shared/settings';
import { h, uid } from '../../renderer/settings/dom';
import { WS } from '../strings';
import { activeId, badgesFor, characterText, displayName, skinFor } from './characterInfo';
import type { PreviewLoop } from './previewLoop';
import { createScenePreview, type ScenePreview } from './scenePreview';

export interface CharactersViewDeps {
  getSettings(): Settings;
  choose(id: CharacterId): void;
  previews: PreviewLoop;
}

export interface CharactersView {
  readonly root: HTMLElement;
  refresh(): void;
  dispose(): void;
}

interface Registered {
  canvas: HTMLCanvasElement;
  preview: ScenePreview;
  remove(): void;
}

/** A preview canvas registered with the shared loop; `remove` unregisters it. */
function makePreview(loop: PreviewLoop, id: CharacterId, skin: string): Registered {
  const canvas = h('canvas', { class: 'preview-canvas', role: 'img' });
  const preview = createScenePreview(canvas, id, skin);
  const unregister = loop.add(preview);
  return {
    canvas,
    preview,
    remove() {
      unregister();
      preview.dispose();
    },
  };
}

interface Card extends Registered {
  root: HTMLElement;
  name: HTMLElement;
  pick: HTMLButtonElement;
}

export function createCharactersView(deps: CharactersViewDeps): CharactersView {
  const cards = new Map<CharacterId, Card>();
  const list = h('div', { class: 'char-grid' });
  const s0 = deps.getSettings();
  for (const mod of CHARACTERS) {
    const id = mod.id;
    const headingId = uid('char-name');
    const reg = makePreview(deps.previews, id, skinFor(s0, id));
    const name = h('h3', { class: 'char-name', id: headingId, text: displayName(s0, id) });
    const pick = h('button', { type: 'button', class: 'char-pick' });
    pick.addEventListener('click', () => deps.choose(id));
    const facts = h('dl', { class: 'char-facts' }, [
      h('dt', { text: WS.characters.personality }),
      h('dd', { text: characterText(id, 'personality') }),
      h('dt', { text: WS.characters.interactions }),
      h('dd', { text: characterText(id, 'interactions') }),
    ]);
    const root = h('article', { class: 'char-card', 'aria-labelledby': headingId, 'data-character': id }, [
      h('div', { class: 'char-stage' }, [reg.canvas]),
      h('div', { class: 'char-body' }, [
        name,
        h('p', { class: 'char-tagline', text: characterText(id, 'tagline') }),
        h('p', { class: 'char-desc', text: characterText(id, 'description') }),
        facts,
        h('ul', { class: 'badges' }, badgesFor(id).map((b) => h('li', { class: 'badge', text: b }))),
        h('div', { class: 'actions' }, [pick]),
      ]),
    ]);
    cards.set(id, { ...reg, root, name, pick });
    list.appendChild(root);
  }

  const root = h('div', { class: 'characters-view' }, [h('p', { class: 'lead', text: WS.characters.intro }), h('p', { class: 'note', text: WS.characters.switchNote }), list]);

  function refresh(): void {
    const s = deps.getSettings();
    const current = activeId(s);
    for (const [id, c] of cards) {
      const label = displayName(s, id);
      c.name.textContent = label;
      c.canvas.setAttribute('aria-label', WS.characters.previewLabel(label));
      c.preview.setSkin(skinFor(s, id));
      const on = id === current;
      c.root.classList.toggle('active', on);
      c.pick.textContent = on ? WS.characters.active : WS.characters.choose;
      c.pick.setAttribute('aria-pressed', on ? 'true' : 'false');
      c.pick.setAttribute('aria-label', on ? `${WS.characters.active}: ${label}` : WS.characters.chooseLabel(label));
      c.pick.classList.toggle('primary', !on);
    }
  }

  refresh();
  return {
    root,
    refresh,
    dispose() {
      for (const c of cards.values()) c.remove();
      cards.clear();
    },
  };
}

/** The HOME card: the active character, live, with its name and tagline. */
export interface ActiveCard {
  readonly root: HTMLElement;
  refresh(): void;
  dispose(): void;
}

export function createActiveCard(deps: { getSettings(): Settings; previews: PreviewLoop }): ActiveCard {
  const s0 = deps.getSettings();
  let shown = activeId(s0);
  let current = makePreview(deps.previews, shown, skinFor(s0, shown));
  const stage = h('div', { class: 'char-stage' }, [current.canvas]);
  const nameId = uid('active-name');
  const name = h('h2', { class: 'active-name', id: nameId });
  const tagline = h('p', { class: 'char-tagline' });
  const desc = h('p', { class: 'char-desc' });
  const root = h('section', { class: 'pcard active-card', 'aria-labelledby': nameId }, [stage, h('div', { class: 'char-body' }, [name, tagline, desc])]);

  function refresh(): void {
    const s = deps.getSettings();
    const id = activeId(s);
    if (id !== shown) {
      // The page restarts on a swap; this keeps the card right if it ever does not.
      current.remove();
      shown = id;
      current = makePreview(deps.previews, id, skinFor(s, id));
      stage.replaceChildren(current.canvas);
    }
    const label = displayName(s, id);
    name.textContent = label;
    tagline.textContent = characterText(id, 'tagline');
    desc.textContent = characterText(id, 'description');
    current.canvas.setAttribute('aria-label', WS.home.previewLabel(label));
    current.preview.setSkin(skinFor(s, id));
  }

  refresh();
  return {
    root,
    refresh,
    dispose() {
      current.remove();
    },
  };
}
