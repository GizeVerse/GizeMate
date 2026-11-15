// Display names (ADR 0004 §9; GizeMate rename). Only what the user reads comes from here: UI strings, window
// titles, the tray tooltip, menus, dialogs and notices. Persistent identifiers (app id, userData
// folder, executable names, scheme, ...) are in identity.ts and never follow these names.

export const BRAND = Object.freeze({
  /** The platform the character belongs to. */
  platform: 'GizeVerse',
  /** The product name shown in the app (a universe of companions; the cat is one of them). */
  product: 'GizeMate',
  /**
   * The name Windows shows for the installed app: the Start menu and desktop shortcuts, Settings ›
   * Apps › Installed apps and Task Manager › Startup apps. The installer names keep it until an
   * upgrade test on a disposable machine allows renaming them (ADR 0004 §9, Deferred), so any text
   * that tells the user what to find or click in Windows names this, not `product`.
   */
  installedName: 'Desktop Cat',
  /** The name the product had before GizeVerse ("formerly ..." on the About page). */
  formerName: 'Desktop Cat',
  /** The display name immediately before the current one ("formerly GizeCat" on the About page). */
  previousName: 'GizeCat',
} as const);

/** Every earlier display name, most recent first (About page, "formerly ..."); never used as an identifier. */
export const FORMER_NAMES: readonly string[] = Object.freeze([BRAND.previousName, BRAND.formerName]);

export type Brand = typeof BRAND;
