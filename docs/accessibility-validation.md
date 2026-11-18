# Accessibility validation (GizeMate 1.6.0 release candidate)

Status of this file: written alongside the automated checks. It claims only what was executed; the results section is filled from the runs listed there. Everything in the second half still needs a person.

## What the automation checks

| Check | How to run | Covers |
| --- | --- | --- |
| Contrast of every design token pair | `npx vitest run tests/unit/renderer/settings/contrast.test.ts` | Parses the CSS custom properties of `src/renderer/settings/styles.css` and `src/web/web.css`, light and dark. WCAG 2.1 AA: 4.5:1 text, 3:1 UI components and focus rings. Translucent tokens are composited over their surface. |
| Desktop settings window | build (`node scripts/build.mjs`), then `npx playwright test tests/e2e/a11y.spec.ts` | Real Electron window: html lang and title, skip link, nav rail roving tabindex (arrows, Home, End, Enter), tabs pattern, every Tab stop on every area and tab has a role and accessible name in the browser's accessibility tree and a computed visible focus indicator, keyboard-only character selection, modal dialog semantics, focus trap, Escape and focus return, switches/sliders/radiogroups/canvases named, reduced motion (system preference and the companion switch). |
| Web host panel | `npm run test:web -- -g a11y` | Real page in Chrome and Edge; phone and tablet projects are Chrome device emulation (SIMULATED). Language, title, toolbar order, modal sheet, Escape and focus return, Tab stops with names and focus rings on all four areas, radiogroup tabs with arrows, keyboard character selection, 44 px targets, reduced motion. |

The accessibility tree used is Chromium's (Playwright `ariaSnapshot`). It shows roles and names as the browser computes them. It is not what NVDA, Narrator, TalkBack or VoiceOver say.

## What needs a human

Run these on a real Windows 11 PC (and, for the web panel, a real phone or tablet). Tick and date each line; note the screen reader and version.

### Screen reader (NVDA and Narrator on Windows)
- [ ] Open Settings. The window title and the first heading are announced; the skip link is reachable and moves to the content.
- [ ] Navigation: the rail is announced as navigation, the current page as current; arrow keys move between items and speech is not chatty.
- [ ] Each page: headings navigate sensibly (H key in NVDA); the order read matches the visual order.
- [ ] Switches read as "switch, on/off" with their title and description. Sliders read a value in words (for example a percentage or a label), not a bare number.
- [ ] Characters: the seven characters read as one group; the active one is announced as active; "Make ... my companion" announces the result once (status line) and does not repeat the whole description.
- [ ] A confirmation dialog: title and text are read on open; Escape closes; focus returns to the control that opened it.
- [ ] Changing the language: the new language is spoken with the right voice (lang attribute) and focus stays where you were.
- [ ] Character previews: they are either silent or described as a picture of the character; they must not be read as "unlabelled graphic".
- [ ] Sound: the companion's sounds are not the only way any state is conveyed. UNVERIFIED by automation: nothing here was heard.

### Keyboard only (no mouse)
- [ ] Complete first run, pick a character, rename the companion, change a setting on every page, close the window, using only the keyboard.
- [ ] The focus ring is visible on every control in light and dark Windows themes, and on a high-contrast Windows theme (forced-colors rules exist in CSS and were not exercised).
- [ ] No keyboard trap anywhere; Tab order matches the visual order at 100%, 150% and 200% display scaling and with the window narrowed.

### Visual and motion
- [ ] Windows "Animation effects" off: previews are still, nothing slides or fades. The companion's own "reduce motion" switch does the same.
- [ ] Text at 200% size and at 400% zoom (web panel) stays readable and nothing is cut off.
- [ ] Colour is never the only signal (active character, errors, warnings, selected skin).

### Web and Android panel (real device)
- [ ] Touch targets are comfortable to hit with a thumb (automation only measures sizes: at least 44 CSS px).
- [ ] TalkBack (Android) or VoiceOver (iOS) reads the toolbar, the sheet and the four areas; swipe order matches the visual order; the sheet can be dismissed with the system back gesture or a two-finger scrub. Android and iOS were out of scope for the automated run: UNVERIFIED.

## Results of the automated runs
Executed on the validation PC (Windows 11, display scaling 125%), after fixes to the first run (6 desktop and 35 web failures, each classified):

- Desktop settings window (`tests/e2e/a11y.spec.ts`, real Electron): 10 passed, 0 failed. REAL.
- Web panel (`npm run test:web -- -g a11y`, 5 projects): 56 passed, 4 skipped (the Turkish-locale check runs on one project only), 0 failed. REAL on Chrome and Edge, SIMULATED on the three device-emulation projects.
- Contrast and the rest of `tests/unit/renderer/settings` and `tests/unit/web`: 59 files, 736 tests passed. REAL.
- Full web suite (`npm run test:web`, all projects): 133 passed, 22 skipped (opt-in or single-project), 0 failed. REAL/SIMULATED as above.
- Full desktop E2E (`npx playwright test`): 42 passed, 14 opt-in skipped, 0 failed (32 passed before the 10 accessibility tests were added). REAL.

How the automated checks measure focus (so the numbers mean something):
- Focus indicator: a computed outline of at least 2 DEVICE pixels (Chromium snaps outlines to device pixels, so 2 css px at 125% is 1.6 css px), on the control, its holder or its track; a text field may use a 2 px accent underline. A bare box-shadow does not count. The ring's colour contrast (3:1) is checked by the contrast unit test, not by the Playwright runs.
- Accessible name: the role and name come from Chromium's accessibility tree (`ariaSnapshot`, and CDP `Accessibility.getPartialAXTree` for roles it prints as plain text, such as `<summary>`).
- Skip link and dialog: first Tab from a fresh window lands on the skip link; the privacy consent dialog is a modal `<dialog>` with a label and description, traps Tab, closes on Escape and focus returns to the radio group's checked radio (the choice reverts to Off); in the web panel focus returns to the Settings button, also after a page restart that reopened the sheet.
- Touch targets: toolbar and every sheet control, with folds opened, at least 44 css px.

Still needs a person: everything under "What needs a human" above (speech output, high-contrast themes, real touch, TalkBack/VoiceOver, 200%/400% zoom). Not claimed by any automated run.
