// A top-level area made of tabs (Customize, Settings). Each tab shows one or more existing page views;
// the tab list follows the ARIA tabs pattern (roving tabindex, arrows, Home/End), only the visible
// tab's views get onShow (polls and previews stop for the others) and the active tab is recorded in the
// address so it can be deep-linked.
import type { PageId } from './catalog';
import type { PageContext, PageView } from './context';
import { page } from './controls';
import { h } from './dom';

export interface TabSpec {
  id: string;
  label: string;
  views: readonly PageView[];
  /** A short line shown above the views (e.g. the Advanced warning). */
  note?: string;
}

/** Replaces a view's h1 with an h2 (the area owns the h1), keeping id, class and focusability. */
export function demoteHeading(view: PageView): void {
  const old = view.element.querySelector<HTMLElement>('.page-title');
  if (!old || old.tagName === 'H2') return;
  const next = h('h2', { class: `${old.className} section-title`, id: old.id, tabindex: -1, text: old.textContent ?? '' });
  old.replaceWith(next);
}

export function tabbedPage(ctx: PageContext, spec: { id: PageId; title: string; tabsLabel: string; tabs: readonly TabSpec[] }): PageView {
  const first = spec.tabs[0];
  if (!first) throw new Error('tabbedPage: no tabs');
  const buttons = new Map<string, HTMLButtonElement>();
  const panels = new Map<string, HTMLElement>();
  const uidBase = `tabs-${spec.id}`;
  let current = first.id;
  let shown = false;

  const tabList = h('div', { class: 'tab-list', role: 'tablist', 'aria-label': spec.tabsLabel });
  for (const tab of spec.tabs) {
    const single = tab.views.length === 1;
    for (const v of tab.views) {
      demoteHeading(v);
      v.element.hidden = true;
      // The tab already names a single view; its heading stays for assistive technology only.
      if (single) v.element.querySelector('.page-title')?.classList.add('sr-only');
    }
    const btn = h('button', { type: 'button', class: 'tab', role: 'tab', id: `${uidBase}-t-${tab.id}`, 'aria-controls': `${uidBase}-p-${tab.id}`, 'aria-selected': 'false', tabindex: -1, text: tab.label });
    btn.addEventListener('click', () => select(tab.id, true));
    btn.addEventListener('keydown', (e) => {
      const i = spec.tabs.findIndex((t) => t.id === tab.id);
      let target: number;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') target = (i + 1) % spec.tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') target = (i - 1 + spec.tabs.length) % spec.tabs.length;
      else if (e.key === 'Home') target = 0;
      else if (e.key === 'End') target = spec.tabs.length - 1;
      else return;
      e.preventDefault();
      const next = spec.tabs[target];
      if (!next) return;
      select(next.id, true);
      buttons.get(next.id)?.focus();
    });
    buttons.set(tab.id, btn);
    tabList.append(btn);
    const panel = h('div', { class: 'tab-panel', role: 'tabpanel', id: `${uidBase}-p-${tab.id}`, 'aria-labelledby': btn.id, hidden: true }, [
      tab.note ? h('p', { class: 'page-note' }, [h('span', { text: tab.note })]) : null,
      ...tab.views.map((v) => v.element),
    ]);
    panels.set(tab.id, panel);
  }

  const element = page(spec.title, [tabList, ...[...panels.values()]]);

  function activate(id: string, on: boolean): void {
    const tab = spec.tabs.find((t) => t.id === id);
    if (!tab) return;
    panels.get(id)!.hidden = !on;
    for (const v of tab.views) {
      v.element.hidden = !on;
      if (on) v.onShow?.();
      else v.onHide?.();
    }
  }

  function select(id: string, fromUser: boolean): void {
    if (!panels.has(id)) return;
    if (id === current && panels.get(id)!.hidden === false) return;
    if (shown) activate(current, false);
    else panels.get(current)!.hidden = true;
    current = id;
    for (const [tid, btn] of buttons) {
      const on = tid === id;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
    if (shown) activate(id, true);
    else panels.get(id)!.hidden = false;
    if (fromUser) ctx.tabChanged({ page: spec.id, tab: id });
  }
  select(first.id, false);

  return {
    id: spec.id,
    title: spec.title,
    element,
    selectTab: (tab) => select(tab, false),
    onShow() {
      shown = true;
      activate(current, true);
    },
    onHide() {
      if (!shown) return;
      shown = false;
      activate(current, false);
      // Keep the panel visible for the next show; only the views were told to stop.
      panels.get(current)!.hidden = false;
    },
  };
}
