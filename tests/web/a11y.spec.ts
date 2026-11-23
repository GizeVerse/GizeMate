// Accessibility of the web host panel (Chrome/Edge desktop, plus the emulated phone and tablets). REAL: the page,
// the browser's accessibility tree (ariaSnapshot), computed styles, real Tab/Arrow/Enter/Escape key events through the
// browser input pipeline. SIMULATED: the mobile projects are device emulation in Chrome. NOT covered (needs a human):
// what a screen reader says aloud, touch use on a real device (docs/accessibility-validation.md).
import { expect, test, type Locator, type Page } from '@playwright/test';

const NAMED = /^- [\w-]+ "[^"]+"/;
const TOUCH = new Set(['mobile-emulated', 'tablet-ipad-emulated', 'tablet-android-emulated']);
const TABS = ['Home', 'Characters', 'Customize', 'Settings'] as const;

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    '(() => { const h = globalThis.__gizecatWebTest; if (!h) return false; const s = h.state(); return s.visible && s.bounds !== null && s.overlay.ready; })()',
    undefined,
    { timeout: 20_000 },
  );
}

async function openSheetByKeyboard(page: Page): Promise<Locator> {
  await page.locator('#btn-settings').focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  await expect(sheet).toBeVisible();
  return sheet;
}

interface Stop {
  tag: string;
  snapshot: string;
  outlineStyle: string;
  outlineWidth: number;
  boxShadow: string;
  ringOnHolder: boolean;
  inDialog: boolean;
}

/** `- <role> "<name>"` for the focused element straight from Chromium's accessibility tree, or null. */
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

/** The focused element: its accessibility-tree line (from the browser) and its computed focus indicator. */
async function stop(page: Page): Promise<Stop> {
  const onBody = (await page.evaluate<boolean>('document.activeElement === document.body || document.activeElement === null'));
  // Nothing focused (focus left the page): no tree line, and inDialog false ends the cycle.
  let snapshot = onBody ? '' : (await page.locator(':focus').ariaSnapshot({ timeout: 5000 })).trim();
  // ariaSnapshot prints a <summary> as plain text and quotes a pressed button as YAML: for anything it does not print as `role "name"`, ask Chromium's accessibility tree (CDP) for role and name.
  if (!onBody && !NAMED.test(snapshot)) snapshot = (await axLine(page)) ?? snapshot;
  const info = await page.evaluate<Omit<Stop, 'snapshot'>>(`(() => {
    const el = document.activeElement; const cs = getComputedStyle(el);
    const holder = el.closest('label, .card, .tab') || el; const hs = getComputedStyle(holder);
    return { tag: el.tagName.toLowerCase(), outlineStyle: cs.outlineStyle, outlineWidth: (parseFloat(cs.outlineWidth) || 0) * window.devicePixelRatio, boxShadow: cs.boxShadow,
      ringOnHolder: hs.outlineStyle !== 'none' && parseFloat(hs.outlineWidth) * window.devicePixelRatio >= 1.99, inDialog: !!el.closest('dialog') && el !== document.body };
  })()`);
  return { ...info, snapshot };
}

/** A native radio/checkbox/switch may show its ring on the label (:focus-within) instead of the input. A box-shadow alone is not accepted: cards carry shadows at rest. */
const hasRing = (s: Stop): boolean => (s.outlineStyle !== 'none' && s.outlineWidth >= 1.99) || s.ringOnHolder;

/** `- button "Close"`: a role and a quoted name. An unnamed control prints as a bare role. */
/** Opens every fold (native details) in the sheet so their contents are part of the tab order and size checks. */
async function openFolds(page: Page): Promise<void> {
  await page.evaluate('document.querySelectorAll("dialog details").forEach(d => { d.open = true; })');
}

test.beforeEach(({ browser }, info) => {
  info.annotations.push({ type: TOUCH.has(info.project.name) ? 'SIMULATED' : 'REAL', description: `${info.project.name}: ${browser.version()}` });
});

test('a11y: document language, title and the decorative canvas', async ({ page }) => {
  await boot(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle(/GizeMate/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('#cat')).toHaveAttribute('aria-hidden', 'true');
});

test('a11y: toolbar tab order, names and focus indicator', async ({ page }) => {
  await boot(page);
  await page.locator('#btn-call').focus();
  const seen: Stop[] = [await stop(page)];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    seen.push(await stop(page));
  }
  const names = seen.map((s) => /^- button "([^"]+)"/.exec(s.snapshot)?.[1] ?? s.snapshot);
  expect(names[0]).toMatch(/^Call/);
  expect(names[1]).toMatch(/^(Sleep|Wake)$/); // the button offers Wake while the companion sleeps
  expect(names[2]).toBe('Pause');
  expect(names[3]).toMatch(/sound/i);
  expect(names[4]).toBe('Settings');
  for (const s of seen) expect(hasRing(s), `${s.snapshot} has a visible focus ring`).toBe(true);
});

test('a11y: the sheet opens by keyboard, is a modal dialog, and Escape returns focus to the opener', async ({ page }) => {
  await boot(page);
  const sheet = await openSheetByKeyboard(page);
  expect(await page.evaluate('(() => { const d = document.querySelector("dialog#settings"); return d.open && d.matches(":modal"); })()')).toBe(true);
  expect(await page.evaluate('!!document.activeElement.closest("dialog")'), 'focus moved into the dialog').toBe(true);
  // The page behind a modal dialog is inert: many Tab presses never land on the toolbar.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate('!document.activeElement.closest(".bar")'), 'Tab reached the inert toolbar').toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.locator('#btn-settings')).toBeFocused();
});

for (const tabName of TABS) {
  test(`a11y: sheet ${tabName} area: every tab stop is named and shows a focus ring`, async ({ page }) => {
    await boot(page);
    const sheet = await openSheetByKeyboard(page);
    await sheet.getByRole('radio', { name: tabName, exact: true }).check();
    await openFolds(page);
    await sheet.getByRole('radio', { name: tabName, exact: true }).focus();
    const stops: Stop[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 150; i++) {
      await page.keyboard.press('Tab');
      const s = await stop(page);
      if (!s.inDialog) break;
      if (seen.has(s.snapshot)) break; // one full cycle
      seen.add(s.snapshot);
      stops.push(s);
    }
    expect(stops.length, `${tabName}: tab stops`).toBeGreaterThan(1);
    for (const s of stops) {
      expect(s.snapshot, `${tabName}: accessible name of the focused ${s.tag}`).toMatch(NAMED);
      expect(hasRing(s), `${tabName}: ${s.snapshot} shows a visible focus indicator`).toBe(true);
    }
  });
}

test('a11y: sheet navigation is a labelled radiogroup; arrows move and select; the area is a named region', async ({ page }) => {
  await boot(page);
  const sheet = await openSheetByKeyboard(page);
  const group = sheet.getByRole('radiogroup').first();
  await expect(group).toBeVisible();
  const snap = await group.ariaSnapshot();
  for (const name of TABS) expect(snap).toContain(`radio "${name}"`);
  await group.getByRole('radio', { name: 'Home', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  const characters = sheet.getByRole('radio', { name: 'Characters', exact: true });
  await expect(characters).toBeChecked();
  await expect(characters).toBeFocused();
  await expect(sheet.getByRole('region', { name: 'Characters' })).toBeVisible();
});

test('a11y: choosing a character by keyboard only; Active is text, previews are labelled images', async ({ page }) => {
  await boot(page);
  const sheet = await openSheetByKeyboard(page);
  await sheet.getByRole('radio', { name: 'Home', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  const region = sheet.getByRole('region', { name: 'Characters' });
  await expect(region).toBeVisible();
  const canvases = region.locator('canvas');
  expect(await canvases.count()).toBeGreaterThanOrEqual(7);
  for (const c of await canvases.all()) {
    await expect(c).toHaveAttribute('role', 'img');
    expect(((await c.getAttribute('aria-label')) ?? '').length).toBeGreaterThan(2);
  }
  const active = region.getByRole('button', { pressed: true });
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText(/Active/);
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate<boolean>('/Monkey/.test(document.activeElement.getAttribute("aria-label") || "")');
  }
  expect(reached, 'the Monkey button is reachable with Tab').toBe(true);
  await page.keyboard.press('Enter');
  await expect(region.getByRole('button', { name: /^Active: Monkey/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(region.getByRole('button', { pressed: true })).toHaveCount(1);
  await expect(region.getByRole('button', { pressed: true })).toHaveText(/Active/);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.locator('#btn-settings')).toBeFocused();
});

test('a11y: touch targets are at least 44 CSS px (toolbar and every sheet control)', async ({ page }) => {
  await boot(page);
  const toolbar = await page.evaluate<Array<[string, number, number]>>(
    `[...document.querySelectorAll('.bar button')].filter(b => !b.hidden).map(b => { const r = b.getBoundingClientRect(); return [b.id, Math.round(r.width), Math.round(r.height)]; })`,
  );
  for (const [id, w, h] of toolbar) expect(Math.min(w, h), `toolbar #${id} ${w}x${h}`).toBeGreaterThanOrEqual(44);
  const sheet = await openSheetByKeyboard(page);
  for (const tabName of TABS) {
    await sheet.getByRole('radio', { name: tabName, exact: true }).check();
    await openFolds(page);
    const small = await page.evaluate<string[]>(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('dialog button, dialog summary, dialog input:not([type=hidden]), dialog select, dialog textarea')) {
        if (el.closest('[hidden]')) continue;
        const holder = (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) ? (el.closest('label') || el) : el;
        const r = holder.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
        if (Math.min(r.width, r.height) < 43.5) out.push((el.id || el.className || el.tagName) + ' ' + el.tagName + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30));
      }
      return out;
    })()`);
    expect(small, `${tabName}: controls under 44px`).toEqual([]);
  }
});

test('a11y: prefers-reduced-motion leaves no CSS transition running', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);
  await openSheetByKeyboard(page);
  const moving = await page.evaluate<string[]>(
    `[...document.querySelectorAll('dialog *, .bar button')].map(e => getComputedStyle(e).transitionDuration).filter(d => d.split(',').some(x => parseFloat(x) > 0))`,
  );
  expect(moving, 'elements still transitioning under prefers-reduced-motion').toEqual([]);
});

test('a11y: the document language follows a Turkish browser', async ({ page }, info) => {
  test.skip(info.project.name !== 'chrome', 'one project is enough for the locale check');
  await page.context().addInitScript(
    `Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr'] }); Object.defineProperty(navigator, 'language', { get: () => 'tr-TR' });`,
  );
  await boot(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
});
