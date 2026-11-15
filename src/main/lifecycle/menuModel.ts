// Pure descriptions of the tray menu, tray tooltip/icon and the cat's right-click
// menu. tray.ts and the overlay manager turn these into native menus. Text comes from the shared i18n
// catalogue (menu.*, vision.*, tray.*); the context carries the effective locale (absent = English).
import { BRAND } from '../../shared/brand';
import type { BehaviorState } from '../../shared/cat';
import { t, type I18nKey, type I18nParams } from '../../shared/i18n';
import { DEFAULT_LOCALE, type Locale } from '../../shared/i18n/locale';
import type { PerceptionMode } from '../../shared/perception';

/** Catalogue text in `locale` with the product name (the brand layer is the single name source) filled in. */
const tx = (locale: Locale, key: I18nKey, params?: I18nParams): string => t(locale, key, { product: BRAND.product, ...params });

export type MenuAction =
  | 'pet'
  | 'callCat'
  | 'play'
  | 'sleep'
  | 'wake'
  | 'pause'
  | 'resume'
  | 'hide'
  | 'show'
  | 'toggleInteractions'
  | 'privacyPause'
  | 'privacyResume'
  | 'startLaserMode'
  | 'stopLaserMode'
  | 'pauseEvents'
  | 'resumeEvents'
  | 'settings'
  | 'quit';

export type MenuItemModel =
  | { kind: 'separator' }
  | { kind: 'item'; action: MenuAction; label: string; enabled: boolean }
  | { kind: 'checkbox'; action: MenuAction; label: string; checked: boolean; enabled: boolean };

export interface MenuContext {
  catName: string;
  hidden: boolean;
  paused: boolean;
  state: BehaviorState;
  interactionsEnabled: boolean;
  /** settings.perception.visualMode !== 'off' */
  perceptionConfigured: boolean;
  perceptionPaused: boolean;
  perceptionMode: PerceptionMode;
  /** Living Companion Laser Mode is on (session-only). Absent = off. */
  laserActive?: boolean;
  /** The user paused world events for this session. Absent = not paused. */
  eventsPaused?: boolean;
  /** The effective interface language (GizeMate). Absent = English. */
  locale?: Locale;
}

const localeOf = (ctx: Pick<MenuContext, 'locale'>): Locale => ctx.locale ?? DEFAULT_LOCALE;

const SLEEPY: ReadonlySet<BehaviorState> = new Set<BehaviorState>(['sleeping', 'fallingAsleep']);

const VISION_KEY: Record<PerceptionMode, I18nKey> = {
  off: 'vision.off',
  'local-stats': 'vision.localStats',
  'ai-local': 'vision.aiLocal',
  'ai-cloud': 'vision.aiCloud',
};

/** The short vision-mode name in `locale` (English by default). */
export function visionLabel(mode: PerceptionMode, locale: Locale = DEFAULT_LOCALE): string {
  return tx(locale, VISION_KEY[mode]);
}

/** The English vision-mode names, kept for existing callers. */
export const VISION_LABEL: Record<PerceptionMode, string> = {
  off: visionLabel('off'),
  'local-stats': visionLabel('local-stats'),
  'ai-local': visionLabel('ai-local'),
  'ai-cloud': visionLabel('ai-cloud'),
};

export function describeState(state: BehaviorState, locale: Locale = DEFAULT_LOCALE): string {
  const key = `tray.state.${state}` as I18nKey;
  const text = tx(locale, key);
  // A state the catalogue does not know (an older or newer build) falls back to its spelled-out name.
  return text === key ? state.replace(/([A-Z])/g, ' $1').toLowerCase() : text;
}

function item(action: MenuAction, label: string, enabled = true): MenuItemModel {
  return { kind: 'item', action, label, enabled };
}

/** One toggling item: 'Laser mode' to start, 'Stop laser mode' to leave (the tray is always a way out). */
function laserItem(ctx: MenuContext, enabledToStart: boolean): MenuItemModel {
  const l = localeOf(ctx);
  return ctx.laserActive === true ? item('stopLaserMode', tx(l, 'menu.laserStop')) : item('startLaserMode', tx(l, 'menu.laser'), enabledToStart);
}

function eventsItem(ctx: MenuContext): MenuItemModel {
  const l = localeOf(ctx);
  return ctx.eventsPaused === true ? item('resumeEvents', tx(l, 'menu.eventsResume')) : item('pauseEvents', tx(l, 'menu.eventsPause'));
}

export function trayMenuModel(ctx: MenuContext): MenuItemModel[] {
  const l = localeOf(ctx);
  const name = ctx.catName;
  const items: MenuItemModel[] = [
    item(ctx.hidden ? 'show' : 'hide', tx(l, ctx.hidden ? 'menu.show' : 'menu.hide', { name })),
    item(ctx.paused ? 'resume' : 'pause', tx(l, ctx.paused ? 'menu.resumeCat' : 'menu.pauseCat'), !ctx.hidden),
    { kind: 'checkbox', action: 'toggleInteractions', label: tx(l, 'menu.interactions'), checked: ctx.interactionsEnabled, enabled: true },
  ];
  if (ctx.perceptionConfigured) {
    const mode = visionLabel(ctx.perceptionMode, l);
    items.push(ctx.perceptionPaused ? item('privacyResume', tx(l, 'menu.visionResume', { mode })) : item('privacyPause', tx(l, 'menu.visionPause', { mode })));
  }
  items.push(
    { kind: 'separator' },
    item('callCat', tx(l, 'menu.callCat', { name }), !ctx.paused),
    laserItem(ctx, !ctx.hidden && !ctx.paused),
    eventsItem(ctx),
    item('settings', tx(l, 'menu.settings')),
    { kind: 'separator' },
    item('quit', tx(l, 'menu.quit')),
  );
  return items;
}

export function catContextMenuModel(ctx: MenuContext): MenuItemModel[] {
  const l = localeOf(ctx);
  const asleep = SLEEPY.has(ctx.state);
  const active = !ctx.paused && !ctx.hidden;
  return [
    item('pet', tx(l, 'menu.pet', { name: ctx.catName }), active && !asleep),
    item('callCat', tx(l, 'menu.callToCursor'), active),
    item('play', tx(l, 'menu.play'), active && !asleep),
    asleep ? item('wake', tx(l, 'menu.wake'), active) : item('sleep', tx(l, 'menu.sleep'), active),
    // The laser exit is offered while Laser Mode is on, whatever the cat is doing.
    laserItem(ctx, active),
    eventsItem(ctx),
    { kind: 'separator' },
    item(ctx.paused ? 'resume' : 'pause', tx(l, ctx.paused ? 'menu.resume' : 'menu.pause')),
    item('hide', tx(l, 'menu.hideShort')),
    { kind: 'separator' },
    item('settings', tx(l, 'menu.settings')),
    item('quit', tx(l, 'menu.quit')),
  ];
}

/** Windows truncates notification-area tooltips at 127 UTF-16 units. */
export const TRAY_TOOLTIP_MAX = 127;

/** Fits `text` into the tooltip limit: over-long (Turkish) text is cut there, never inside a surrogate pair, and ends with an ellipsis. */
export function fitTooltip(text: string, max: number = TRAY_TOOLTIP_MAX): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

export function trayTooltip(ctx: MenuContext): string {
  const l = localeOf(ctx);
  const state = ctx.hidden ? tx(l, 'tray.hidden') : ctx.paused ? tx(l, 'tray.paused') : describeState(ctx.state, l);
  let vision = visionLabel(ctx.perceptionMode, l);
  if (ctx.perceptionMode !== 'off' && ctx.perceptionPaused) vision += tx(l, 'tray.visionPaused');
  return fitTooltip(tx(l, 'tray.tooltip', { state, vision }));
}

export type TrayIconVariant = 'tray' | 'tray-paused' | 'tray-vision';

export function trayIconVariant(ctx: MenuContext): TrayIconVariant {
  if (ctx.paused) return 'tray-paused';
  if (ctx.perceptionMode !== 'off' && !ctx.perceptionPaused) return 'tray-vision';
  return 'tray';
}
