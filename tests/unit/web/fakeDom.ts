// A tiny DOM for the panel tests (the unit tests run in node, without jsdom): just enough of Document and
// Element for src/renderer/settings/dom.ts (h, uid), the ui/ views and their events. It is not a browser:
// layout, focus rules and default actions are not modelled. REAL for the logic under test; the visual result
// is UNVERIFIED by these tests.
import { createMockCtx, type MockCtx } from '../renderer/mockCtx';

type Listener = (e: FakeEvent) => void;

export interface FakeEvent {
  type: string;
  key?: string;
  target?: unknown;
  prevented: boolean;
  preventDefault(): void;
}

export class FakeText {
  constructor(public data: string) {}
  get textContent(): string {
    return this.data;
  }
}

export class FakeElement {
  readonly children: Array<FakeElement | FakeText> = [];
  readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();
  readonly classes = new Set<string>();
  parent: FakeElement | null = null;
  hidden = false;
  disabled = false;
  checked = false;
  open = false;
  value = '';
  tabIndex = -1;
  width = 0;
  height = 0;
  scrollTop = 0;
  id = '';
  constructor(
    readonly tagName: string,
    private readonly doc: FakeDocument,
  ) {}

  get classList() {
    const set = this.classes;
    return {
      add: (c: string) => void set.add(c),
      remove: (c: string) => void set.delete(c),
      contains: (c: string) => set.has(c),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !set.has(c);
        if (on) set.add(c);
        else set.delete(c);
        return on;
      },
    };
  }
  set className(v: string) {
    this.classes.clear();
    for (const c of v.split(/\s+/).filter(Boolean)) this.classes.add(c);
  }
  get className(): string {
    return [...this.classes].join(' ');
  }
  setAttribute(name: string, value: string): void {
    if (name === 'class') this.className = value;
    else if (name === 'id') this.id = value;
    else this.attrs.set(name, value);
    if (name === 'hidden') this.hidden = true;
  }
  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className;
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  appendChild<T extends FakeElement | FakeText>(c: T): T {
    if (c instanceof FakeElement) {
      c.parent?.removeChild(c);
      c.parent = this;
    }
    this.children.push(c);
    return c;
  }
  append(...cs: Array<FakeElement | FakeText | string>): void {
    for (const c of cs) this.appendChild(typeof c === 'string' ? new FakeText(c) : c);
  }
  get parentNode(): FakeElement | null {
    return this.parent;
  }
  get nextSibling(): FakeElement | FakeText | null {
    const siblings = this.parent?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  insertBefore(node: FakeElement, ref: FakeElement | FakeText | null): void {
    node.parent?.removeChild(node);
    node.parent = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node);
    else this.children.splice(i, 0, node);
  }
  removeChild(c: FakeElement | FakeText): void {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    if (c instanceof FakeElement) c.parent = null;
  }
  replaceChildren(...cs: Array<FakeElement | FakeText | string>): void {
    for (const c of this.children) if (c instanceof FakeElement) c.parent = null;
    this.children.length = 0;
    this.append(...cs);
  }
  set textContent(v: string) {
    this.replaceChildren(new FakeText(v));
  }
  get textContent(): string {
    return this.children.map((c) => c.textContent).join('');
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== fn));
  }
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const e: FakeEvent = { type, target: this, prevented: false, preventDefault: () => void (e.prevented = true), ...init };
    for (const l of this.listeners.get(type) ?? []) l(e);
    return e;
  }
  click(): void {
    if (this.tagName === 'input' && this.attrs.get('type') === 'checkbox') this.checked = !this.checked;
    if (this.tagName === 'input' && this.attrs.get('type') === 'radio') this.checked = true;
    this.dispatch('click');
    if (this.tagName === 'input') this.dispatch('change');
  }
  focus(): void {
    this.doc.activeElement = this;
  }
  remove(): void {
    this.parent?.removeChild(this);
  }
  /** Depth-first search by a predicate. */
  find(pred: (el: FakeElement) => boolean): FakeElement | null {
    if (pred(this)) return this;
    for (const c of this.children) {
      if (c instanceof FakeElement) {
        const r = c.find(pred);
        if (r) return r;
      }
    }
    return null;
  }
  findAll(pred: (el: FakeElement) => boolean, out: FakeElement[] = []): FakeElement[] {
    if (pred(this)) out.push(this);
    for (const c of this.children) if (c instanceof FakeElement) c.findAll(pred, out);
    return out;
  }
  getContext(kind: string): unknown {
    if (this.tagName !== 'canvas' || kind !== '2d') return null;
    const mock = createMockCtx();
    this.doc.contexts.push(mock);
    return mock.ctx;
  }
}

export class FakeDocument {
  activeElement: FakeElement | null = null;
  hidden = false;
  readonly contexts: MockCtx[] = [];
  readonly documentElement = new FakeElement('html', this);
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  createElementNS(_ns: string, tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  createTextNode(text: string): FakeText {
    return new FakeText(text);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

/** Installs a fake `document` for one test; returns it and the function that removes it. */
export function installFakeDom(): { doc: FakeDocument; restore(): void } {
  const g = globalThis as unknown as { document?: unknown };
  const before = g.document;
  const doc = new FakeDocument();
  g.document = doc;
  return {
    doc,
    restore() {
      if (before === undefined) delete g.document;
      else g.document = before;
    },
  };
}
