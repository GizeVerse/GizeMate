import type { SettingsApi } from '../../shared/ipc';
import type { Route, ViewId } from './catalog';
import type { PreviewLoop } from './previews';
import type { SettingsStore, Timers } from './store';

/** Everything a page needs; created once by app.ts. */
export interface PageContext {
  readonly api: SettingsApi;
  readonly store: SettingsStore;
  readonly timers: Timers;
  /** The one animation loop behind every live character preview (paused when hidden or when motion is reduced). */
  readonly previews: PreviewLoop;
  now(): number;
  /** Opens an area, a tab ('#settings/privacy') or the home of an earlier page id. */
  navigate(target: Route | ViewId): void;
  /** Records the tab a tabbed area shows (keeps the address deep-linkable). */
  tabChanged(route: Route): void;
  /** Re-reads the full view from main (after actions whose effects main may not broadcast). */
  refresh(): Promise<void>;
}

export interface PageView {
  id: ViewId;
  title: string;
  element: HTMLElement;
  /** Called every time the page becomes visible. */
  onShow?(): void;
  /** Called every time the page is replaced by another one. */
  onHide?(): void;
  /** Tabbed areas: shows a tab (an unknown id is ignored). */
  selectTab?(tab: string): void;
}
