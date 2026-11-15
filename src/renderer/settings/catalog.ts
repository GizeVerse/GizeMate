// Ordered id lists mirrored from src/shared/settings.ts. The settings module pulls
// zod in at runtime, which the renderer bundle does not need; the type-level checks
// below fail to compile if the shared lists gain an id that is missing here, and a
// unit test asserts the order matches.
import type { AiProviderId, LivelyBehavior, Settings, ToggleableBehavior } from '../../shared/settings';

type StartupState = Settings['general']['startupState'];

export const BEHAVIOR_IDS = [
  'chaseCursor',
  'pawAtCursor',
  'seekAttention',
  'inspectWindows',
  'perchOnWindows',
  'zoomies',
  'grooming',
  'taskbarPlay',
  'climbWindows',
  'tabStrips',
] as const satisfies readonly ToggleableBehavior[];

/** v1.2 opt-outs (behavior.disabledExtras), mirrored from LIVELY_BEHAVIORS. */
export const LIVELY_IDS = [
  'pounce',
  'screenEdges',
  'surfaceHops',
  'hissing',
  'tailChase',
  'tabReactions',
  'explorerTabs',
  'terminalTabs',
  'slips',
] as const satisfies readonly LivelyBehavior[];

/**
 * The v2 switch a v1.2 behaviour lives under (mirror of IMPLIED_OPT_OUTS): with that switch off the
 * v1.2 one is off too, so its toggle is shown off and disabled.
 */
export const LIVELY_PARENT: Readonly<Partial<Record<LivelyBehavior, ToggleableBehavior>>> = {
  pounce: 'chaseCursor',
  screenEdges: 'climbWindows',
  surfaceHops: 'perchOnWindows',
  explorerTabs: 'tabStrips',
  terminalTabs: 'tabStrips',
  tabReactions: 'tabStrips',
};

export const PROVIDER_IDS = ['none', 'ollama', 'openai-compatible', 'anthropic'] as const satisfies readonly AiProviderId[];

/** Choices of "When <product> starts" (general.startupState), in display order. */
export const STARTUP_STATES = ['visible', 'hidden', 'paused', 'remember'] as const satisfies readonly StartupState[];

type Missing<All, Listed> = Exclude<All, Listed>;
const behaviorsComplete: [Missing<ToggleableBehavior, (typeof BEHAVIOR_IDS)[number]>] extends [never] ? true : false = true;
const livelyComplete: [Missing<LivelyBehavior, (typeof LIVELY_IDS)[number]>] extends [never] ? true : false = true;
const providersComplete: [Missing<AiProviderId, (typeof PROVIDER_IDS)[number]>] extends [never] ? true : false = true;
const startupStatesComplete: [Missing<StartupState, (typeof STARTUP_STATES)[number]>] extends [never] ? true : false = true;
export const CATALOG_COMPLETE = behaviorsComplete && livelyComplete && providersComplete && startupStatesComplete;

/**
 * Top-level areas. Home, Characters, Customize and Settings are the navigation rail; Welcome is the
 * first-run page (not in the rail). Ids are hash targets (settings/index.html#customize).
 */
export const PAGE_IDS = ['welcome', 'home', 'characters', 'customize', 'settings'] as const;
export type PageId = (typeof PAGE_IDS)[number];
/** The areas the navigation rail lists, in order (Home first). */
export const NAV_PAGE_IDS = ['home', 'characters', 'customize', 'settings'] as const satisfies readonly PageId[];

export function isPageId(value: string): value is PageId {
  return (PAGE_IDS as readonly string[]).includes(value);
}

/** Tabs of the Customize area (the active character's look, character, behaviour, motion and touch). */
export const CUSTOMIZE_TABS = ['appearance', 'personality', 'behavior', 'animation', 'interaction'] as const;
export type CustomizeTab = (typeof CUSTOMIZE_TABS)[number];
/** Tabs of the Settings area; the rarely needed ones come last. */
export const SETTINGS_TABS = ['language', 'sound', 'privacy', 'data', 'performance', 'accessibility', 'desktop', 'advanced', 'about'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The page ids of earlier versions (their hashes still open the right place) and the views built from them. */
export const LEGACY_PAGE_IDS = [
  'welcome',
  'companion',
  'general',
  'appearance',
  'personality',
  'behavior',
  'interaction',
  'audio',
  'accessibility',
  'journal',
  'privacy',
  'ai',
  'diagnostics',
  'about',
] as const;
export type LegacyPageId = (typeof LEGACY_PAGE_IDS)[number];
/** Views that exist only inside the new structure. */
export type NewViewId = 'animation' | 'language' | 'performance' | 'memory' | 'characterDetail';
export type ViewId = PageId | LegacyPageId | NewViewId;

export interface Route {
  readonly page: PageId;
  readonly tab?: string;
}

/** Where each earlier page now lives. */
export const LEGACY_ROUTES: Readonly<Record<LegacyPageId, Route>> = {
  welcome: { page: 'welcome' },
  companion: { page: 'home' },
  general: { page: 'settings', tab: 'desktop' },
  appearance: { page: 'customize', tab: 'appearance' },
  personality: { page: 'customize', tab: 'personality' },
  behavior: { page: 'customize', tab: 'behavior' },
  interaction: { page: 'customize', tab: 'interaction' },
  audio: { page: 'settings', tab: 'sound' },
  accessibility: { page: 'settings', tab: 'accessibility' },
  journal: { page: 'settings', tab: 'data' },
  privacy: { page: 'settings', tab: 'privacy' },
  ai: { page: 'settings', tab: 'privacy' },
  diagnostics: { page: 'settings', tab: 'advanced' },
  about: { page: 'settings', tab: 'about' },
};

const TABS_OF: Readonly<Partial<Record<PageId, readonly string[]>>> = { customize: CUSTOMIZE_TABS, settings: SETTINGS_TABS };

export function tabsOf(page: PageId): readonly string[] {
  return TABS_OF[page] ?? [];
}

export function isTabOf(page: PageId, tab: string): boolean {
  return tabsOf(page).includes(tab);
}

/**
 * A location hash ('#settings/privacy', '#customize', '#privacy' of an earlier version) to a route, or
 * null when it names nothing known. An unknown tab keeps the area and drops the tab.
 */
export function parseRoute(hash: string): Route | null {
  const [head = '', tab] = hash.replace(/^#/, '').split('/', 2);
  if (isPageId(head)) return tab !== undefined && isTabOf(head, tab) ? { page: head, tab } : { page: head };
  if ((LEGACY_PAGE_IDS as readonly string[]).includes(head)) return LEGACY_ROUTES[head as LegacyPageId];
  return null;
}

export function routeHash(route: Route): string {
  return route.tab ? `#${route.page}/${route.tab}` : `#${route.page}`;
}

/** Upper bounds of the list fields, mirrored from the settings schema (asserted in tests). */
export const MAX_EXCLUDED_PROCESSES = 200;
export const MAX_EXCLUDED_TITLE_PATTERNS = 100;
export const MAX_LIST_ENTRY_LENGTH = 128;
export const MAX_CAT_NAME_LENGTH = 24;
export const MAX_SHORTCUT_LENGTH = 64;
export const MAX_URL_LENGTH = 200;
export const MAX_MODEL_LENGTH = { ollama: 200, openai: 200, anthropic: 100 } as const;
export const API_KEY_LENGTH = { min: 8, max: 400 } as const;
