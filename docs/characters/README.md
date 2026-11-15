# The characters

The product is becoming a small universe of independent companions that share one desktop overlay. Its display name is **GizeMate** (a provisional name; the single place it is set is `src/shared/brand.ts`, and every persistent identifier stays frozen under the old names, see `src/shared/identity.ts`). The decision record is [ADR 0005](../adr/0005-gizemate-multi-character.md).

Status of everything on this page: **implemented in the repository on branch `feature/gizemate`; not yet run in the real app.** Where something is backed by unit tests or by the character preview sheets, it says so. Those tests exist in `tests/unit/`; this documentation did not run them, and [docs/TEST_REPORT.md](../TEST_REPORT.md) (the evidence record) has no entry for this work yet. Labels used below: *implemented* (the code exists), *covered by unit tests* (a test exists, not run by this documentation), *preview sheets* (rendered by `npm run preview:characters`, see the end of this page), *not yet run in the real app*.

## The roster

One character lives on the desktop at a time. The cat is the original companion and the default; every existing install keeps it.

| Character | Kind | How it moves | One line (from the app's own copy) | Page |
|---|---|---|---|---|
| Cat | animal | walks | The original companion | [cat](cat.md) |
| Monkey | animal | walks (knuckle-walk), climbs ledges | The acrobat | [monkey](monkey.md) |
| Fox | animal | walks and trots | Clever, quick and a little aloof | [fox](fox.md) |
| Rabbit | animal | hops | Bright-eyed and light on its feet | [rabbit](rabbit.md) |
| Ghost | fantasy | floats | The harmless haunter | [ghost](ghost.md) |
| Slime | fantasy | bounces | The bouncy blob | [slime](slime.md) |
| Alien | fantasy | glides, a little above the ground | The curious visitor | [alien](alien.md) |

The names above are the English copy. Turkish names are Kedi, Maymun, Tilki, Tavşan, Hayalet, Jöle (the slime) and Uzaylı; the authoritative text is in `src/shared/i18n/characters/*.ts`, and a unit test requires every key to exist in both languages.

## The contract in plain words

Everything the engine needs to know about a character is **data** in one file, `src/shared/characters/<id>.ts`, a `CharacterModule` (type in `src/shared/characters/types.ts`). The shared engine never switches on a character name; it reads these fields:

- **Identity.** Its id, whether it is an animal or a fantasy creature, and how it moves (walk, hop, float, bounce or glide).
- **Body.** Its nominal size in DIP at size 1.0, a gait scale versus the cat's speed limits, and how far in front of the body the clickable region may reach for particular poses. The clickable region is what stays interactive on the click-through overlay, so it must cover the whole visible body and nothing much more.
- **Palettes ("skins").** The coat or colour choices offered in Customize. The first is the default.
- **Clips.** The animations its renderer draws itself, and an alias table that says which of its own clips stands in for every other clip in the shared vocabulary (for example the rabbit draws `walk` as `hop`). A clip nobody lists still resolves to something through the shared fallbacks, so the engine never asks for a pose that does not exist.
- **Personality.** Means for seven dimensions (curiosity, energy, playfulness, sociability, mischief, affection, independence) and a spread. They are used only when a **new** companion of that character is born; they are not shown as a stored field and never change what an existing cat has saved.
- **Behaviour tuning.** Multipliers on the shared decision engine (speed, rest, exploring, play, interest in the cursor, jumpiness, shyness), weights on the 26 world events, and **signature behaviours**: autonomous actions that only this character performs (a monkey swinging from a ledge, a ghost vanishing and reappearing), picked by the same weighted engine as everything else, each with a cooldown and optional requirements (energy, mood, cursor nearby, a ledge).
- **Reactions.** What it does when petted, held, startled, when the cursor is near, when the laser is on, and for each kind of world-event prop.
- **Voice.** A pitch, a voice type, a loudness, a minimum gap between sounds and the cues it uses. Sound is still **off by default**; all sounds are synthesized on the device.
- **Memory.** Which kinds of content-free memory tokens it records ("all", or an allow-list).
- **Capabilities.** Four flags: climbs edges, flies, passes through things, squashes.

What the contract does **not** change: the privacy defaults and invariants in [CLAUDE.md](../../CLAUDE.md) and [docs/PRIVACY.md](../PRIVACY.md); the overlay stays click-through with a hit region only over the character; memory holds content-free tokens only.

### Things that belong to the user, not to the module

- **Which character is active:** `general.activeCharacter` (default `cat`; an unknown value becomes the cat).
- **Names:** the cat keeps `general.catName`; the other characters use `general.characterNames`, one entry per character id (1 to 24 characters; clearing the field returns to the default name).
- **Palette:** the cat keeps `appearance.skin`; the others use `appearance.characterSkins`.
- **Language:** `general.language` is `auto`, `en` or `tr`. `auto` follows the system: Turkish when the first system language is Turkish, otherwise English. An explicit choice is never overwritten by detection, and the detected language is never stored (`src/shared/i18n/locale.ts`).
- **Each character has its own companion state**, so each has its own personality numbers, mood history, counters and journal:
  - Windows: the cat stays in `cat-state.json`; every other character is in `characters/<id>.json` inside the same user-data folder (`%APPDATA%\Desktop Cat\characters\`). A missing or corrupt character file gives a fresh companion for that character only and never touches the cat or another character.
  - Web and Android host: the cat stays in `gizecat.web.cat.v1`; the others share one slot, `gizecat.web.characters.v1`, with one entry per character, each validated on its own.
- **Switching** saves the current companion, then builds the next one from its own file. On the web and Android host the page reloads to do it.

## How to add a character

Adding a character is one module, one renderer folder, one copy file and a few registry lines. No engine change is needed (ADR 0005, consequences).

1. **Module.** Create `src/shared/characters/<id>.ts` exporting `<ID>_MODULE: CharacterModule`. Copy the shape of a close relative (the rabbit for a hopper, the ghost for a floater). Keep it platform-agnostic (no Electron, no DOM): `src/shared` is lint-enforced. Declare `skins`, `clips` and `clipAlias`, personality means, behaviour tuning, at least four signature behaviours, reactions, a sound profile, a memory allow-list and capabilities.
2. **Id.** Add the id to `CHARACTER_IDS` in `src/shared/characters/types.ts`, and the module to the list in `src/shared/characters/registry.ts`.
3. **Renderer.** Create `src/renderer/overlay/characters/<id>/` exporting `create<Id>Renderer(random): CharacterRenderer` (interface in `src/renderer/overlay/character/types.ts`). The scene keeps the view transform, facing turn, opacity, pixel layer, dirty rectangle, emote placement, frame-rate policy, props, laser dot, sound and hit reporting; the renderer owns pose, drawing and geometry. Rules the other renderers follow: no allocation per frame, finite numbers only, bounds that cover everything drawn, at most eight hit rectangles that cover the whole visible body, a pixel-mode fallback, calmer motion when `reducedMotion` is set, and a sleep pose that is clearly still. Register the factory in `src/renderer/overlay/characters/registry.ts`.
4. **Copy.** Create `src/shared/i18n/characters/<id>.ts` with `name`, `tagline`, `description`, `personality` and `interactions` in English and Turkish, and add it to the catalogue. A missing key is a compile error, and a parity test checks both languages.
5. **Tests.** Add module and renderer tests next to the existing ones (`tests/unit/renderer/characters/<id>.module.test.ts` and `<id>.test.ts`, `tests/unit/shared/characters*.test.ts`). Existing suites that walk the registry then cover the new id as well; read them before assuming.
6. **Preview.** Run the preview tool and look at the sheets (below) before calling the drawing done.
7. **Docs.** Add `docs/characters/<id>.md` and a row in the table above.

## The preview tool

`npm run preview:characters` runs `scripts/preview-characters.cjs` under Electron (through the machine lock, so run it one at a time). It renders a character with its real renderer and the real scene, with the scene bounds (cyan) and the numbered hit rectangles (magenta) drawn on every cell, into `out/preview-characters/<id>/`. Options: `--character=<id|all>`, `--sheet=clips|skins|pixel|motion|poses|focus` (comma list; default all), `--dpr=1|1.25|2`, `--out=<dir>`, `--stride=<ticks>`. It uses a temporary user-data folder and software rendering and never sends operating-system input. `out/` is not tracked and `npm run build` wipes it; copy anything worth keeping first.

At the time of writing, sheets for all seven characters exist in this working copy's `out/preview-characters/` (the cat has only the clips sheets). They are the only runtime-like evidence for the drawing; they show posed frames, not the full simulation, and nobody has written down a review of them yet.

## Honest limits of the whole feature

- **One active character at a time.** Several characters on the desktop together would need per-character simulations and hit-region handling in the overlay manager; deferred.
- **Nothing here has run in the real app.** The unit tests and preview sheets are the only evidence, and this documentation did not execute either.
- **Android and macOS sources were only inspected, not run** for this work. Windows is the validation platform, and it has not run this work either. Non-Windows platforms were not validated this cycle.
- **Installers are unsigned** (SmartScreen warns; Smart App Control may block).
- **The web and Android host reloads the page** when you switch characters.
- **A saved profile file still carries the cat only** (profile format 1.1). A non-cat companion does not travel in a profile, and the cat is not changed by importing one ([profile transfer](../platforms/profile-transfer.md)).
- **Personality profiles and Laser mode, world events and the journal are shared features.** The seven named personalities and the event settings are global choices that apply to whichever character is active; the cat-specific wording of older documents refers to the cat's behaviour unless this folder says otherwise.
- **Turkish text** covers the interface, character copy, menus and world-event text that the code ships; a native-speaker review has not been done.
