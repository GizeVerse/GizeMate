# Cat

The original companion, and the default. Every install made before the multi-character work has it, with its name, coat and memory. Back to the [characters overview](README.md).

Status: *implemented*; its module (`src/shared/characters/cat.ts`) describes the behaviour that shipped in 1.5.0, and a golden test of a seeded run is meant to show the cat's behaviour is unchanged by the character layer (*covered by unit tests*, not run by this documentation; not yet run in the real app).

## Personality

From the app's copy: "Moody in a gentle way: cuddly when it wants to be, aloof when it does not." It is a curious, independent cat who naps in sunny spots and chases the occasional butterfly. Means used when a brand-new cat is born: curiosity 0.6, energy 0.55, playfulness 0.6, sociability 0.5, mischief 0.35, affection 0.6, independence 0.45 (spread 0.2). An existing cat keeps the traits it was born with.

## How it moves

It walks (`walk`, `run`, `stalk`, `slink`, `sprint`) at the base gait limits (scale 1). Nominal size at 1.0: the cat's own base footprint (`CAT_BASE_WIDTH_DIP` by `CAT_BASE_HEIGHT_DIP` in `src/shared/cat.ts`). It climbs window edges on Windows (capability `climbsEdges`), but not on a platform whose host offers no edges.

## Signature behaviours

None as a separate list: its module has every tuning multiplier at 1, no signature actions, no alias table and no custom reactions. What it does on its own is the shared engine as documented in the [living companion](../living-companion/README.md) pages (grooming, loafing, zoomies, pouncing, window climbing, asking for attention, and so on).

## What it reacts to

All world events at their normal weights (no affinity table), and the shared reactions for petting, holding, startling, the laser, yarn and butterflies. The animations it draws are all of the shared vocabulary except the eleven performance clips only other characters perform (`hop`, `bounce`, `float`, `vanish`, `appear`, `swing`, `squish`, `scan`, `beam`, `peek`, `dance`).

## Palettes

ginger (default), gray, black, tuxedo, calico, siamese, cream. Chosen with `appearance.skin`. Its name is `general.catName`.

## Voice

Soft voice, pitch 1, gain 1, at least 1.5 s between sounds. Cues: meow (voice), purr (happy), hiss (startled). Off by default; synthesized on the device. Implemented; not heard in a real run.

## Capabilities

Climbs edges: yes. Flies: no. Passes through things: no. Squashes: no. Memory: all kinds.

## Known limitations

- Not run in the real app for this work.
- The cat stays in `cat-state.json` (Windows) or `gizecat.web.cat.v1` (web and Android host); a saved profile file carries the cat only.
- It is one of seven; only one character is active at a time.
