// Window shell: navigation rail, page switching (hash-based so a page can be
// deep-linked, e.g. settings/index.html#privacy) and state wiring.
import type { SettingsApi, SettingsViewState } from '../../shared/ipc';
import { isPageId, LEGACY_ROUTES, NAV_PAGE_IDS, PAGE_IDS, parseRoute, routeHash, type LegacyPageId, type PageId, type Route, type ViewId } from './catalog';
import type { PageContext, PageView } from './context';
import { h, icon, setTextGlyphs, type GlyphName } from './dom';
import { charactersPage } from './pages/characters';
import { customizePage } from './pages/customize';
import { homePage } from './pages/home';
import { settingsPage } from './pages/settings';
import { welcomePage } from './pages/welcome';
import { browserPreviewEnv, PreviewLoop } from './previews';
import { createAppListeners } from './appListeners';
import { brandMark } from './skins';
import { SettingsStore, type Timers } from './store';
import { DEFAULT_LOCALE, type Locale } from '../../shared/i18n/locale';
import { platformWording, S, setLocale } from './strings';

const NAV_ICONS: Record<PageId, GlyphName> = {
  welcome: 'sparkle',
  home: 'home',
  characters: 'people',
  customize: 'color',
  settings: 'settings',
};

const FACTORIES: Record<PageId, (ctx: PageContext) => PageView> = {
  welcome: welcomePage,
  home: homePage,
  characters: charactersPage,
  customize: customizePage,
  settings: settingsPage,
};

/** A page id, an area route or the id of an earlier page, as a route. */
function toRoute(target: Route | ViewId): Route {
  if (typeof target !== 'string') return target;
  if (isPageId(target)) return { page: target };
  return LEGACY_ROUTES[target as LegacyPageId] ?? { page: 'home' };
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

/** Puts the language on the document (screen readers, hyphenation, spell check) and the window title. */
function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.title = S.app.title;
}

export function mountApp(root: HTMLElement, api: SettingsApi, initial: SettingsViewState): () => void {
  let locale: Locale = initial.locale ?? DEFAULT_LOCALE;
  setLocale(locale);
  applyDocumentLocale(locale);
  setTextGlyphs(platformWording(initial.status.platform) !== 'windows');
  const store = new SettingsStore(api, initial, browserTimers);
  const previewEnv = browserPreviewEnv();
  // Motion is calm when the system asks for it or when the companion's own reduced-motion switch is on.
  const previews = new PreviewLoop({ ...previewEnv, reducedMotion: () => previewEnv.reducedMotion() || store.settings.companion?.reducedMotion === true });
  let current: PageId | null = null;
  let currentTab: string | undefined;
  let pages = new Map<PageId, PageView>();
  let navButtons = new Map<PageId, HTMLButtonElement>();
  let content = h('main', { class: 'content', id: 'content', tabindex: -1 });
  let nav = h('nav', { class: 'rail' });
  // App-level listeners live apart from the pages': a language rebuild clears the store's listeners.
  const appListeners = createAppListeners(store, previews);

  const ctx: PageContext = {
    api,
    store,
    timers: browserTimers,
    previews,
    now: () => Date.now(),
    navigate: (target) => show(toRoute(target), true),
    tabChanged: (route) => {
      if (route.page !== current) return;
      currentTab = route.tab;
      if (location.hash !== routeHash(route)) history.replaceState(null, '', routeHash(route));
    },
    refresh: async () => receive(await api.getState()),
  };

  /** (Re)builds the navigation rail and every page in the active language. */
  function build(): void {
    previews.dispose();
    pages = new Map<PageId, PageView>();
    navButtons = new Map<PageId, HTMLButtonElement>();
    content = h('main', { class: 'content', id: 'content', tabindex: -1 });
    const navList = h('ul', { class: 'nav-list' });
    for (const id of NAV_PAGE_IDS) {
      const btn = h('button', { type: 'button', class: 'nav-item', 'data-page': id, tabindex: -1, 'aria-label': S.nav[id] }, [icon(NAV_ICONS[id], 'nav-icon'), h('span', { class: 'nav-label', text: S.nav[id] })]);
      btn.addEventListener('click', () => show({ page: id }, true));
      // Roving tabindex: one stop in the rail (the current page), arrows/Home/End move between items.
      btn.addEventListener('keydown', (e) => {
        const i = NAV_PAGE_IDS.indexOf(id);
        let target: PageId | undefined;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') target = NAV_PAGE_IDS[(i + 1) % NAV_PAGE_IDS.length];
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') target = NAV_PAGE_IDS[(i - 1 + NAV_PAGE_IDS.length) % NAV_PAGE_IDS.length];
        else if (e.key === 'Home') target = NAV_PAGE_IDS[0];
        else if (e.key === 'End') target = NAV_PAGE_IDS[NAV_PAGE_IDS.length - 1];
        if (!target) return;
        e.preventDefault();
        for (const [pid, b] of navButtons) b.tabIndex = pid === target ? 0 : -1;
        navButtons.get(target)?.focus();
      });
      navButtons.set(id, btn);
      navList.append(h('li', {}, [btn]));
    }
    nav = h('nav', { class: 'rail', 'aria-label': S.app.navLabel }, [
      h('div', { class: 'brand' }, [h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, [brandMark()]), h('span', { class: 'brand-name', text: S.app.brand })]),
      navList,
    ]);
    for (const id of PAGE_IDS) {
      const view = FACTORIES[id](ctx);
      pages.set(id, view);
      content.append(view.element);
    }
    const skip = h('a', { class: 'skip-link', href: '#content', text: S.ui.skipLink });
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      content.focus();
    });
    root.replaceChildren(skip, h('div', { class: 'app' }, [nav, content]));
  }

  /**
   * A fresh view from main. When the effective language changed (the user switched it, or the system
   * language changed under 'auto'), the strings switch first and the shell is rebuilt on the same page.
   */
  function receive(view: SettingsViewState): void {
    const next: Locale = view.locale ?? DEFAULT_LOCALE;
    if (next === locale) {
      store.receive(view);
      return;
    }
    const keep = current;
    const keepTab = currentTab;
    if (keep !== null) pages.get(keep)?.onHide?.();
    // The old pages are about to be discarded: their bindings and listeners go with them.
    store.unbindAll();
    // Keyboard focus would fall to <body> when the old shell is replaced: remember where it was.
    const active = document.activeElement;
    const focusNav = active instanceof HTMLElement && nav.contains(active) ? (active.getAttribute('data-page') ?? null) : null;
    const hadFocus = active instanceof HTMLElement && active !== document.body && root.contains(active);
    locale = next;
    setLocale(locale);
    applyDocumentLocale(locale);
    store.receive(view);
    build();
    appListeners.attach();
    current = null;
    show(keep !== null ? { page: keep, ...(keepTab ? { tab: keepTab } : {}) } : (fromHash() ?? { page: 'home' }), false);
    if (hadFocus) {
      const navBtn = focusNav !== null && isPageId(focusNav) ? navButtons.get(focusNav) : undefined;
      const target = navBtn ?? (current !== null ? pages.get(current)?.element.querySelector<HTMLElement>('.page-title') : null) ?? content;
      target.focus();
    }
  }

  build();

  function show(route: Route, fromUser: boolean): void {
    const id = route.page;
    if (current === id) {
      if (route.tab !== undefined) {
        pages.get(id)?.selectTab?.(route.tab);
        currentTab = route.tab;
        if (location.hash !== routeHash(route)) history.replaceState(null, '', routeHash(route));
      }
      return;
    }
    const previous = current === null ? undefined : pages.get(current);
    current = id;
    const view = pages.get(id);
    currentTab = route.tab;
    if (route.tab !== undefined) view?.selectTab?.(route.tab);
    for (const [pid, v] of pages) v.element.hidden = pid !== id;
    previous?.onHide?.();
    for (const [pid, btn] of navButtons) {
      if (pid === id) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
      btn.tabIndex = pid === id || (!navButtons.has(id) && pid === NAV_PAGE_IDS[0]) ? 0 : -1;
    }
    document.title = S.app.pageTitle(view?.title ?? S.app.title);
    content.scrollTop = 0;
    view?.onShow?.();
    if (location.hash !== routeHash(route)) history.replaceState(null, '', routeHash(route));
    if (fromUser && document.activeElement && !nav.contains(document.activeElement)) {
      view?.element.querySelector<HTMLElement>('.page-title')?.focus();
    }
  }

  const fromHash = (): Route | null => parseRoute(location.hash);
  const onHash = (): void => {
    const r = fromHash();
    if (r) show(r, false);
  };
  window.addEventListener('hashchange', onHash);

  appListeners.attach();
  const unsubscribe = api.onStateChanged((view) => receive(view));
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') void store.flush();
    previews.refresh();
  };
  document.addEventListener('visibilitychange', onVisibility);

  root.removeAttribute('aria-busy');
  show(fromHash() ?? { page: initial.settings.general.firstRunCompleted ? 'home' : 'welcome' }, false);

  return () => {
    if (current !== null) pages.get(current)?.onHide?.();
    previews.dispose();
    appListeners.detach();
    store.unbindAll();
    unsubscribe();
    window.removeEventListener('hashchange', onHash);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
