// Accessibility of the REAL desktop settings window (Electron, the built app in out/). REAL: the window, the
// browser's accessibility tree (ariaSnapshot), computed styles and real key events. NOT covered (needs a human with
// NVDA/Narrator): what is read aloud, sound, high-contrast themes, a real keyboard-only session.
// See docs/accessibility-validation.md.
import { expect, hook, launchApp, quitApp, settingsPage, test, waitForCat } from './fixtures';
import type { ElectronApplication, Page } from '@playwright/test';

const NAMED = /^- [\w-]+ "[^"]+"/;
const AREAS = ['Home', 'Characters', 'Customize', 'Settings'] as const;

interface Stop {
  tag: string;
  snapshot: string;
  ring: boolean;
  seen: boolean;
  onBody: boolean;
}

async function prepare(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchApp(userData);
  try {
    await waitForCat(app);
    expect((await hook(app, 'patchSettings', { general: { language: 'en', firstRunCompleted: true } })).ok).toBe(true);
    const page = await settingsPage(app);
    await expect(page.locator('#root, body').first()).toBeVisible();
    await expect(page.locator('.rail .nav-item').first()).toBeVisible();
    // On first run the settings window may already be open, drawn in the system language (Turkish on a Turkish PC);
    // the patch above re-renders it in place a moment later. Wait for that before anything reads labels.
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.emulateMedia({ reducedMotion: null });
    return { app, page };
  } catch (error) {
    // Do not leave the launched app running (and its temp folder locked) when setup fails.
    await quitApp(app).catch(() => undefined);
    throw error;
  }
}

/** A window nobody has touched yet: nothing focused and the sequential-focus start point at the top of the document (a click at x=1,y=1 would start inside the rail). */
async function resetFocus(page: Page): Promise<void> {
  await page.evaluate('(() => { document.body.setAttribute("tabindex", "-1"); document.body.focus(); document.body.removeAttribute("tabindex"); document.activeElement && document.activeElement.blur(); })()');
}

async function goto(page: Page, area: string): Promise<void> {
  await page.getByRole('navigation').getByRole('button', { name: area, exact: true }).click();
  await expect(page.getByRole('navigation').getByRole('button', { name: area, exact: true })).toHaveAttribute('aria-current', 'page');
}

/** `- <role> "<name>"` for the focused element straight from Chromium's accessibility tree (CDP), or null. */
async function axLine(page: Page): Promise<string | null> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.activeElement' });
    if (!result.objectId) return null;
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    const n = nodes[0];
    const role = String((n?.role as { value?: string } | undefined)?.value ?? '');
    const name = String((n?.name as { value?: string } | undefined)?.value ?? '').trim();
    return role && name ? `- ${role} "${name}"` : null;
  } finally {
    await cdp.detach();
  }
}

/** The focused element: its accessibility-tree line and its computed focus indicator (own, label, sibling track or text-input underline). */
async function stop(page: Page): Promise<Stop> {
  const onBody = (await page.evaluate<boolean>('document.activeElement === document.body || document.activeElement === null'));
  let snapshot = onBody ? '' : (await page.locator(':focus').ariaSnapshot({ timeout: 5000 })).trim();
  // ariaSnapshot has no line for a few native roles (a <summary> prints as plain text): ask Chromium's accessibility tree itself for role and name.
  if (!onBody && !NAMED.test(snapshot)) snapshot = (await axLine(page)) ?? snapshot;
  const info = await page.evaluate<Omit<Stop, 'snapshot'>>(`(() => {
    const el = document.activeElement;
    // Chromium snaps an outline to whole DEVICE pixels (2 css px at 125% scaling is 2 device px = 1.6 css px), so the width is measured in device pixels.
    const visible = (n) => { if (!n) return false; const s = getComputedStyle(n); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) * window.devicePixelRatio >= 1.99; };
    const own = visible(el);
    const track = visible(el.nextElementSibling) || visible(el.parentElement) || visible(el.closest('label'));
    const input = el.tagName === 'INPUT' && el.type === 'text' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
    const underline = input && parseFloat(getComputedStyle(el).borderBottomWidth) * window.devicePixelRatio >= 1.99;
    const seen = el.hasAttribute('data-a11y-seen'); el.setAttribute('data-a11y-seen', '1');
    return { tag: el.tagName.toLowerCase(), ring: own || track || underline, seen, onBody: el === document.body };
  })()`);
  return { ...info, snapshot };
}

async function tabCycle(page: Page, max = 160): Promise<Stop[]> {
  await page.evaluate('document.querySelectorAll("[data-a11y-seen]").forEach(e => e.removeAttribute("data-a11y-seen"))');
  const out: Stop[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const s = await stop(page);
    if (s.onBody || s.seen) break;
    out.push(s);
  }
  return out;
}

function assertStops(stops: Stop[], where: string): void {
  expect(stops.length, `${where}: tab stops`).toBeGreaterThan(0);
  for (const s of stops) {
    expect(s.snapshot, `${where}: focused ${s.tag} has a role and an accessible name`).toMatch(NAMED);
    expect(s.ring, `${where}: ${s.snapshot} shows a visible focus indicator`).toBe(true);
  }
}

test('a11y: language, title, skip link and landmarks', async ({ userData }) => {
  const { app, page } = await prepare(userData);
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle(/ · GizeMate$|GizeMate/);
    await expect(page.getByRole('navigation', { name: /.+/ })).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    // First Tab: the skip link, visible; Enter moves focus into the main content.
    await resetFocus(page);
    await page.keyboard.press('Tab');
    const skip = page.locator('.skip-link');
    await expect(skip).toBeFocused();
    const box = await skip.boundingBox();
    expect(box && box.y >= 0 && box.height > 0, 'skip link is on screen when focused').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#content')).toBeFocused();
    // Page titles follow the page.
    await goto(page, 'Characters');
    await expect(page).toHaveTitle(/Characters/);
    // Language follows the setting.
    expect((await hook(app, 'patchSettings', { general: { language: 'tr' } })).ok).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    expect((await hook(app, 'patchSettings', { general: { language: 'en' } })).ok).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  } finally {
    await quitApp(app);
  }
});

test('a11y: navigation rail has a roving tabindex with arrows, Home and End', async ({ userData }) => {
  const { app, page } = await prepare(userData);
  try {
    const nav = page.getByRole('navigation');
    const snap = await nav.ariaSnapshot();
    for (const a of AREAS) expect(snap).toContain(`button "${a}"`);
    const items = page.locator('.rail .nav-item');
    await expect(items.locator('xpath=self::*[@tabindex="0"]')).toHaveCount(1);
    await items.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(nav.getByRole('button', { name: 'Characters', exact: true })).toBeFocused();
    await page.keyboard.press('End');
    await expect(nav.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown'); // wraps
    await expect(nav.getByRole('button', { name: 'Home', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(nav.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(nav.getByRole('button', { name: 'Home', exact: true })).toBeFocused();
    await expect(items.locator('xpath=self::*[@tabindex="0"]')).toHaveCount(1);
    // Enter activates: the page changes, aria-current moves, the title follows.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(nav.getByRole('button', { name: 'Characters', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle(/Characters/);
    // The rail is ONE tab stop: Tab leaves it for the content.
    await nav.getByRole('button', { name: 'Characters', exact: true }).focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate('!!document.activeElement.closest(".rail")'), 'Tab left the rail').toBe(false);
  } finally {
    await quitApp(app);
  }
});

for (const area of AREAS) {
  test(`a11y: ${area} area: tab order, accessible names and visible focus on every stop`, async ({ userData }) => {
    const { app, page } = await prepare(userData);
    try {
      await goto(page, area);
      const tabs = page.getByRole('tab');
      const tabNames = (await tabs.count()) > 0 ? await tabs.allInnerTexts() : [];
      const rounds = tabNames.length > 0 ? tabNames : [null];
      for (const t of rounds) {
        if (t !== null) {
          await page.getByRole('tab', { name: t.trim(), exact: true }).click();
          await expect(page.getByRole('tab', { name: t.trim(), exact: true })).toHaveAttribute('aria-selected', 'true');
        }
        await resetFocus(page);
        const stops = await tabCycle(page);
        assertStops(stops, `${area}${t ? ' / ' + t.trim() : ''}`);
      }
    } finally {
      await quitApp(app);
    }
  });
}

test('a11y: tabs follow the tabs pattern (one stop, arrows, Home/End, tabpanel labelled)', async ({ userData }) => {
  const { app, page } = await prepare(userData);
  try {
    await goto(page, 'Customize');
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible();
    expect(await tablist.getAttribute('aria-label')).toBeTruthy();
    const tabs = tablist.getByRole('tab');
    const n = await tabs.count();
    expect(n).toBeGreaterThan(1);
    await expect(tablist.locator('[role=tab][tabindex="0"]')).toHaveCount(1);
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tabs.nth(n - 1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.first()).toBeFocused();
    const panel = page.getByRole('tabpanel');
    await expect(panel).toHaveCount(1);
    expect(await panel.getAttribute('aria-labelledby')).toBeTruthy();
    expect((await page.getByRole('tabpanel').ariaSnapshot()).length).toBeGreaterThan(0);
  } finally {
    await quitApp(app);
  }
});

test('a11y: choose a character by keyboard only; Active is text; Escape closes a dialog and returns focus', async ({ userData }) => {
  const { app, page } = await prepare(userData);
  try {
    await goto(page, 'Characters');
    const group = page.getByRole('radiogroup');
    await expect(group).toBeVisible();
    expect(await group.getAttribute('aria-label')).toBeTruthy();
    const snap = await group.ariaSnapshot();
    for (const name of ['Cat', 'Monkey', 'Fox', 'Rabbit', 'Ghost', 'Slime', 'Alien']) expect(snap, `radio for ${name}`).toMatch(new RegExp(`radio "${name}`));
    // The active one is conveyed in text (its accessible name says "active"), not colour only.
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);
    await expect(group.getByRole('radio', { name: /^Cat.*active/ })).toHaveCount(1);
    // Decorative canvases are not exposed as unnamed images.
    const unnamedImg = await page.evaluate(`[...document.querySelectorAll('.character-card canvas, .character-stage canvas')].filter(c => c.getAttribute('aria-hidden') !== 'true' && !c.getAttribute('aria-label') && !c.closest('[aria-hidden=true]')).length`);
    expect(unnamedImg).toBe(0);
    await group.getByRole('radio', { checked: true }).focus();
    // Arrow to the Monkey.
    for (let i = 0; i < 8; i++) {
      const name = (await page.locator(':focus').getAttribute('aria-label')) ?? '';
      if (/^Monkey/.test(name)) break;
      await page.keyboard.press('ArrowRight');
    }
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', /^Monkey/);
    await page.keyboard.press('Tab');
    const select = page.getByRole('button', { name: 'Make Monkey my companion' });
    await expect(select).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await hook(app, 'getSettings')).general.activeCharacter).toBe('monkey');
    await expect(page.getByRole('status').filter({ hasText: /Monkey/ })).toBeVisible();
    await expect(group.getByRole('radio', { name: /^Monkey.*active/ })).toHaveCount(1);
    // Focus did not fall to <body>.
    expect(await page.evaluate('document.activeElement !== document.body')).toBe(true);
    // Put the cat back for the rest of the run.
    expect((await hook(app, 'patchSettings', { general: { activeCharacter: 'cat' } })).ok).toBe(true);

    // A dialog: the privacy consent. Escape cancels and focus returns to the opener.
    await goto(page, 'Settings');
    const privacyTab = page.getByRole('tab', { name: /Privacy/i });
    if (await privacyTab.count()) await privacyTab.first().click();
    // The screen-analysis choice is a radio group; activating "Local statistics" asks for consent in a modal dialog.
    const modes = page.getByRole('radiogroup').filter({ has: page.getByRole('radio', { name: /Local statistics/ }) });
    const opener = modes.getByRole('radio', { name: /Local statistics/ });
    await expect(opener).toBeVisible();
    await opener.focus();
    await page.keyboard.press('Space');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await page.evaluate('document.querySelector("dialog").matches(":modal")')).toBe(true);
    expect(await dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(await dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(await page.evaluate('!!document.activeElement.closest("dialog")'), 'focus is inside the dialog').toBe(true);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate('!!document.activeElement.closest("dialog")'), 'Tab stays inside the modal').toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Cancelling reverts the choice (Off stays selected) and focus returns to the group's tab stop, the checked radio, which is inside the group that opened the dialog.
    const off = modes.getByRole('radio', { name: /^Off/ });
    await expect(off).toHaveAttribute('aria-checked', 'true');
    await expect(opener).toHaveAttribute('aria-checked', 'false');
    await expect(off).toBeFocused();
    expect((await hook(app, 'getSettings')).perception?.visualMode ?? 'off').toBe('off');
  } finally {
    await quitApp(app);
  }
});

test('a11y: switches, sliders and groups expose roles, names and values', async ({ userData }) => {
  const { app, page } = await prepare(userData);
  try {
    await goto(page, 'Settings');
    for (const sw of await page.getByRole('switch').all()) {
      await expect(sw).toHaveAttribute('aria-checked', /^(true|false)$/).catch(async () => {
        // A native checkbox with role=switch exposes its state through `checked`: accept that too.
        expect(['true', 'false']).toContain(String(await sw.isChecked()));
      });
      expect(Boolean((await sw.getAttribute('aria-labelledby')) || (await sw.getAttribute('aria-label'))), 'switch has a label').toBe(true);
    }
    await goto(page, 'Customize');
    for (const tabName of await page.getByRole('tab').allInnerTexts()) {
      await page.getByRole('tab', { name: tabName.trim(), exact: true }).click();
      for (const r of await page.getByRole('slider').all()) {
        if (!(await r.isVisible())) continue;
        const named = Boolean((await r.getAttribute('aria-labelledby')) || (await r.getAttribute('aria-label')));
        expect(named, `${tabName}: slider has a name`).toBe(true);
        expect(await r.getAttribute('aria-valuetext'), `${tabName}: slider has aria-valuetext`).toBeTruthy();
      }
      for (const g of await page.getByRole('radiogroup').all()) {
        if (!(await g.isVisible())) continue;
        expect(Boolean((await g.getAttribute('aria-labelledby')) || (await g.getAttribute('aria-label'))), `${tabName}: radiogroup is labelled`).toBe(true);
      }
      for (const c of await page.locator('canvas:visible').all()) {
        const ok = (await c.getAttribute('aria-hidden')) === 'true' || ((await c.getAttribute('role')) === 'img' && Boolean(await c.getAttribute('aria-label'))) || (await c.locator('xpath=ancestor::*[@aria-hidden="true" or @role="img"]').count()) > 0;
        expect(ok, `${tabName}: canvas is decorative or a labelled image`).toBe(true);
      }
    }
  } finally {
    await quitApp(app);
  }
});

test('a11y: reduced motion (system preference and the companion switch) stops CSS motion', async ({ userData }) => {
  const { app, page } = await prepare(userData);
  try {
    const moving = `[...document.querySelectorAll('body *')].filter(e => { const s = getComputedStyle(e); return s.transitionDuration.split(',').some(x => parseFloat(x) > 0) || (s.animationName !== 'none' && s.animationDuration.split(',').some(x => parseFloat(x) > 0)); }).length`;
    // Baseline: without a preference the interface does animate something (so the check below is meaningful).
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(((await page.evaluate<number>(moving))), 'baseline has transitions').toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(moving), 'prefers-reduced-motion: reduce').toBe(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect((await hook(app, 'patchSettings', { companion: { reducedMotion: true } })).ok).toBe(true);
    await expect(page.locator('html[data-calm]')).toHaveCount(1);
    expect(await page.evaluate(moving), 'companion reduced-motion switch').toBe(0);
    expect((await hook(app, 'patchSettings', { companion: { reducedMotion: false } })).ok).toBe(true);
    await expect(page.locator('html[data-calm]')).toHaveCount(0);
  } finally {
    await quitApp(app);
  }
});
