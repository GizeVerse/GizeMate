# ADR 0005: GizeMate, many characters on one core

- Status: accepted (2026-11-15). Branch `feature/gizemate`, cut from release v1.5.0 (`3d247af`). Builds on ADR 0001 to 0004.
- **No invariant in CLAUDE.md changes.** Privacy defaults, the sandboxed renderers, validated IPC, click-through and the platform-agnostic core are untouched. Windows is the validation platform for this work; the Android and macOS sources are kept compatible by inspection only.
- Labels: statements about behaviour are UNVERIFIED until the tests named in the test report ran; see docs/TEST_REPORT.md for what was actually executed.

## 1. Context

Until v1.5.0 the product was one procedural cat. ADR 0004 §10 left a type-level seam (`CharacterDescriptor`) that nothing read. The product is becoming a small universe of independent companions (animals and fantasy creatures) under the provisional name **GizeMate**. A read-only audit of v1.5.0 found: the renderer is one cat (`Pose`, `Rig`, `puppet`, `draw`, `clips` behind `scene.ts`); the simulation is mostly generic but names cat clips and cat events; there was no localisation layer; hosts assumed exactly one companion; frozen identifiers and storage keys are pinned by tests.

## 2. Decisions

| # | Concern | Decision |
|---|---|---|
| M1 | Scope of simultaneity | **One active character at a time** (`settings.general.activeCharacter`, default `cat`). Several characters on the desktop at once would need per-character sims, hit-region unions and gesture routing in the overlay manager; it is deferred and recorded as a limitation. |
| M2 | Roster | `cat` (the original companion, kept for upgrade compatibility), then `monkey`, `fox`, `rabbit` (animals) and `ghost`, `slime`, `alien` (fantasy). |
| M3 | Contract | Pure data in `src/shared/characters/`: a `CharacterModule` per character (identity, body, palettes, clips and aliases, personality means, behaviour tuning, signature actions, reactions, sound profile, memory allow-list, capabilities) and a registry. The engine reads fields; it never switches on a character name. |
| M4 | Renderer | A `CharacterRenderer` interface (`src/renderer/overlay/character/types.ts`). The scene keeps the view transform, facing turn, opacity, pixel layer, dirty rectangle, emote placement, pacing and hit reporting; a renderer owns pose, drawing and geometry. The cat is wrapped unchanged (`CatRenderer`); each character has its own renderer under `src/renderer/overlay/characters/<id>/`. |
| M5 | Clips | One shared vocabulary (`ANIM_CLIPS`) plus eleven performance clips (`hop`, `bounce`, `float`, `vanish`, `appear`, `swing`, `squish`, `scan`, `beam`, `peek`, `dance`). A character draws what it lists and aliases or falls back for the rest, so no snapshot ever asks for a pose that does not exist. Unknown clips or palettes no longer drop a frame (mixed-version bundles). |
| M6 | Simulation | `createCatSim` takes an optional `character`. Locomotion clips follow the module (`walk`, `hop`, `float`, `bounce`); decision weights, event affinities, signature actions, reactions and the memory allow-list come from the module. For the cat every multiplier is 1, and a golden hash of a seeded run is identical to v1.5.0. |
| M7 | Personality | The seven dimensions (curiosity, energy, playfulness, sociability, mischief, affection, independence) are a **derived read-only view** over the stored traits and drives, so the stored format does not change. A new non-cat companion draws its traits from the module means on a dedicated random stream. |
| M8 | Persistence | The cat keeps `cat-state.json` and `gizecat.web.cat.v1` exactly. Other characters get their own file (`characters/<id>.json`) or slot (`gizecat.web.characters.v1`) with their own schema version. A corrupt entry yields a fresh companion for that character only and never touches the cat. |
| M9 | Settings | Additive, tolerant fields only: `general.activeCharacter`, `general.language`, `general.characterNames`, `appearance.characterSkins`. Every v1.5.0 settings file still parses and re-saves. |
| M10 | Localisation | A typed catalogue (`src/shared/i18n/`): English is the source of truth for the key set, Turkish mirrors it (a missing key is a compile error), runtime falls back to English, no fetch or eval (the settings window's CSP forbids them). `general.language` is `auto`, `en` or `tr`; `auto` follows the system (Turkish system language gives Turkish, everything else English). The detected language is never stored and never overwrites an explicit choice. |
| M11 | Branding | `BRAND.product` is the single display-name source (`GizeMate`). Every persistent identifier stays frozen (`src/shared/identity.ts`): app id, userData folder, executable and installer names, scheme, storage keys, the Android application id. |
| M12 | Information architecture | Home, Characters, Customize, Settings. Advanced settings stay secondary. |

## 3. Consequences

- A user upgrading from v1.5.0 keeps their cat, its name, coat and memory, and starts as the cat.
- Adding a character is one module file, one renderer folder, one copy file and one registry line each; no engine change.
- Other characters' hit regions, footprints and window sizes come from their own bodies; the Android window sizing is clamped page-side so a tall or wide character can never produce a window message the native side would drop.
- The secret-name mechanism keeps working for whichever character is active (it is fed the active character's name; the renderer attaches the accessory).

## 4. Out of scope and limitations

- Several simultaneous characters (M1).
- A profile file that carries a non-cat companion (profile format 1.1 stays cat-only; a future minor bump with a character-keyed section is described in the host notes).
- Non-Windows validation: the macOS and Android sources are kept compatible by inspection only; real-device feedback will follow.
