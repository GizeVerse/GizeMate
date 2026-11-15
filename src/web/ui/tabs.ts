// The four-area navigation of the web panels (Home, Characters, Customize, Settings).
//
// It is a group of native radio buttons drawn as tabs, one panel per option, shown with `hidden`. The
// browser itself supplies the keyboard behaviour of a radio group: ONE tab stop (the checked option, a
// roving tabindex), and the arrow keys, which move to and select the neighbouring option and fire `change`.
// That is deliberate: the web host never listens to key events (ESLint, ADR 0004 section 8), so there is no
// key handler here at all; the same pattern as the radio cards of the settings (controls.ts).
// Pure DOM through the CSP-safe helpers.
import { h, uid } from '../../renderer/settings/dom';

export interface TabDef {
  id: string;
  label: string;
  panel: HTMLElement;
}

export interface Tabs {
  /** The group of options (the navigation bar). */
  readonly bar: HTMLElement;
  readonly current: string;
  select(id: string, focus?: boolean): void;
  /** Re-reads the labels (after a language change). */
  setLabels(labels: Readonly<Record<string, string>>): void;
}

export interface TabsOptions {
  label: string;
  tabs: readonly TabDef[];
  initial?: string;
  /** A tab was selected by the person (not for the initial one). */
  onSelect?: (id: string) => void;
  className?: string;
  /** A sessionStorage key that keeps the chosen tab across a restart of the page (language or character change). Optional; storage may be unavailable. */
  memoryKey?: string;
}

export function createTabs(opts: TabsOptions): Tabs {
  const base = uid('ui-tabs');
  const inputs = new Map<string, HTMLInputElement>();
  const labels = new Map<string, HTMLElement>();
  const items = new Map<string, HTMLElement>();
  const panels = new Map<string, HTMLElement>();
  const remembered = ((): string | null => {
    if (!opts.memoryKey) return null;
    try {
      return window.sessionStorage.getItem(opts.memoryKey);
    } catch {
      return null;
    }
  })();
  const known = (id: string | null | undefined): id is string => id !== null && id !== undefined && opts.tabs.some((t) => t.id === id);
  let current = known(remembered) ? remembered : known(opts.initial) ? opts.initial : (opts.tabs[0]?.id ?? '');

  const bar = h('div', { class: opts.className ?? 'tabbar', role: 'radiogroup', 'aria-label': opts.label });
  for (const tab of opts.tabs) {
    const labelId = `${base}-label-${tab.id}`;
    const panelId = `${base}-panel-${tab.id}`;
    const input = h('input', { type: 'radio', name: base, value: tab.id, 'aria-controls': panelId });
    input.addEventListener('change', () => {
      if (input.checked) select(tab.id, false);
    });
    const text = h('span', { class: 'tab-label', id: labelId, text: tab.label });
    const item = h('label', { class: 'tab' }, [input, text]);
    tab.panel.setAttribute('role', 'region');
    tab.panel.id = panelId;
    tab.panel.setAttribute('aria-labelledby', labelId);
    tab.panel.hidden = true;
    inputs.set(tab.id, input);
    labels.set(tab.id, text);
    items.set(tab.id, item);
    panels.set(tab.id, tab.panel);
    bar.appendChild(item);
  }

  function apply(): void {
    for (const [id, input] of inputs) {
      const on = id === current;
      input.checked = on;
      items.get(id)?.classList.toggle('selected', on);
      const panel = panels.get(id);
      if (panel) panel.hidden = !on;
    }
  }

  function select(id: string, focus = false): void {
    if (!inputs.has(id)) return;
    const changed = id !== current;
    current = id;
    if (opts.memoryKey) {
      try {
        window.sessionStorage.setItem(opts.memoryKey, id);
      } catch {
        // Storage is only a convenience.
      }
    }
    apply();
    if (focus) inputs.get(id)?.focus();
    if (changed) opts.onSelect?.(id);
  }

  apply();
  return {
    bar,
    get current() {
      return current;
    },
    select,
    setLabels(next) {
      for (const [id, text] of labels) {
        const value = next[id];
        if (value !== undefined) text.textContent = value;
      }
    },
  };
}
