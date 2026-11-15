// Characters: the collection. Each card shows the character animated with its real renderer on a small
// canvas (one shared low-frame-rate loop, still when motion is reduced); the detail panel describes the
// character and selects it as the active companion (general.activeCharacter).
import type { CharacterId } from '../../../shared/characters/registry';
import { activeCharacterOf, allCharacterIds, characterCard, paletteOf, type CharacterCard } from '../charactersView';
import type { PageContext, PageView } from '../context';
import { button, page, radioGroup, setNote, type RadioItem } from '../controls';
import { h, icon } from '../dom';
import { previewCanvas } from '../previewCanvas';
import type { PreviewSlot } from '../previews';
import { getLocale, S } from '../strings';

const C = S.ui.characters;

function badge(label: string, cls = ''): HTMLElement {
  return h('span', { class: `badge ${cls}`.trim(), text: label });
}

export function charactersPage(ctx: PageContext): PageView {
  const ids = allCharacterIds();
  const slots = new Map<CharacterId, PreviewSlot>();
  const pills = new Map<CharacterId, HTMLElement>();
  const cards = new Map<CharacterId, HTMLElement>();
  const infos = new Map<CharacterId, CharacterCard>();
  let viewed: CharacterId = activeCharacterOf(ctx.store.settings);
  let shown = false;

  const items: Array<RadioItem<CharacterId>> = ids.map((id) => {
    const info = characterCard(id, getLocale());
    infos.set(id, info);
    const preview = previewCanvas(ctx, id, paletteOf(ctx.store.settings, id).current);
    slots.set(id, preview.slot);
    const pill = h('span', { class: 'badge badge-accent', text: C.active, hidden: true });
    pills.set(id, pill);
    const el = h('button', { type: 'button', class: 'character-card', 'data-character': id }, [
      h('span', { class: 'character-stage' }, [preview.element]),
      h('span', { class: 'character-meta' }, [
        h('span', { class: 'character-name', text: info.name }),
        h('span', { class: 'character-tagline', text: info.tagline }),
        h('span', { class: 'badge-row' }, [badge(info.kindLabel), pill]),
      ]),
    ]);
    cards.set(id, el);
    return { value: id, el };
  });

  const grid = h('div', { class: 'character-grid', 'aria-label': C.listLabel }, items.map((i) => i.el));
  const detail = h('section', { class: 'character-detail', 'aria-live': 'polite' });
  const status = h('div', { class: 'row-note', role: 'status', hidden: true });
  const stillNote = h('p', { class: 'page-note', hidden: true }, [icon('info'), h('span', { text: C.stillNote })]);

  const handle = radioGroup<CharacterId>(grid, items, (id) => {
    viewed = id;
    handle.set(id);
    renderDetail();
  });

  const section = (heading: string, body: HTMLElement): HTMLElement => h('div', { class: 'detail-block' }, [h('h3', { class: 'detail-heading', text: heading }), body]);

  function renderDetail(): void {
    const info = infos.get(viewed);
    if (!info) return;
    const active = activeCharacterOf(ctx.store.settings) === viewed;
    const pick = button(active ? C.isActive : C.select(info.name), { variant: active ? 'standard' : 'accent', icon: active ? 'check' : 'heart' });
    pick.disabled = active;
    pick.addEventListener('click', () => {
      ctx.store.set('general', 'activeCharacter', viewed);
      setNote(status, C.selected(info.name), 'ok');
    });
    const customize = button(C.customize(info.name), { icon: 'color' });
    customize.hidden = !active;
    customize.addEventListener('click', () => ctx.navigate({ page: 'customize', tab: 'appearance' }));
    const abilities =
      info.abilities.length > 0
        ? h('div', { class: 'badge-row' }, info.abilities.map((a) => badge(a, 'badge-ability')))
        : h('p', { class: 'muted', text: C.noAbilities });
    detail.replaceChildren(
      h('div', { class: 'detail-head' }, [
        h('h2', { class: 'detail-name', text: info.name }),
        h('div', { class: 'badge-row' }, [badge(info.kindLabel), badge(info.locomotionLabel), active ? badge(C.active, 'badge-accent') : null]),
      ]),
      h('p', { class: 'detail-tagline', text: info.tagline }),
      section(C.headingAbout, h('p', { text: info.description })),
      section(C.headingPersonality, h('p', { text: info.personality })),
      section(C.headingInteractions, h('p', { text: info.interactions })),
      section(C.headingAbilities, abilities),
      h('div', { class: 'actions' }, [pick, customize]),
      status,
    );
  }

  const element = page(C.title, [h('p', { class: 'page-note' }, [icon('info'), h('span', { text: C.intro })]), stillNote, grid, detail]);

  const sync = (): void => {
    const s = ctx.store.settings;
    const active = activeCharacterOf(s);
    for (const id of ids) {
      pills.get(id)?.toggleAttribute('hidden', id !== active);
      slots.get(id)?.setSkin(paletteOf(s, id).current);
      const info = infos.get(id);
      cards.get(id)?.setAttribute('aria-label', info ? C.cardLabel(info.name, info.tagline, id === active) : '');
    }
    handle.set(viewed);
    stillNote.hidden = !ctx.previews.reduced;
    renderDetailIfChanged(active);
  };
  let lastActive: CharacterId | null = null;
  function renderDetailIfChanged(active: CharacterId): void {
    if (lastActive === active && detail.childElementCount > 0) return;
    lastActive = active;
    renderDetail();
  }
  ctx.store.subscribe(sync);

  const setShown = (on: boolean): void => {
    shown = on;
    for (const slot of slots.values()) slot.setVisible(on);
  };
  return {
    id: 'characters',
    title: C.title,
    element,
    onShow() {
      viewed = activeCharacterOf(ctx.store.settings);
      sync();
      renderDetail();
      setShown(true);
    },
    onHide() {
      if (shown) setShown(false);
    },
  };
}
