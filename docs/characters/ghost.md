# Ghost

The harmless haunter. Back to the [characters overview](README.md).

Status: *implemented* (`src/shared/characters/ghost.ts`, `src/renderer/overlay/characters/ghost/`, `src/shared/i18n/characters/ghost.ts`); *covered by unit tests* (`tests/unit/renderer/characters/ghost.module.test.ts`, `ghost.test.ts`, not run by this documentation); *preview sheets* exist; *not yet run in the real app*.

## Personality

From the app's copy: "Playful, curious and a bit of a prankster, but never scary. It is happiest when someone plays along." Newborn means: curiosity 0.7, energy 0.55, playfulness 0.8, sociability 0.55, mischief 0.9, affection 0.5, independence 0.6 (spread 0.15). Tuning: speed 1.05, rests less (0.8), explores (1.25), plays (1.3), likes the cursor (1.3), not jumpy (0.7), a little bold (0.8).

## How it moves

It floats and bobs (locomotion `float`, gait scale 0.9); `walk`, `run`, `stalk`, `slink`, `sprint`, `climb`, `balance`, `hop` and `bounce` are all drawn as `float`. It draws `stretch`, `groom`, `scratch`, `meow`, `pawAt`, `swat`, `rollOver`, `tailChase` and `impact` natively (they used to be aliases). Nominal size 64 by 84 DIP. It can fly and pass through things (capabilities), and it fades out and back in (`vanish`, `appear`). It does not climb edges.

## Signature behaviours

Eight, with cooldowns of 25 seconds to 90 seconds:

- **Vanish and appear** (by far the most likely): fades out in a swirl of sparkles, relocates while hidden and pops up elsewhere to look around (movement type `teleport`).
- **Peekaboo**: hides, then peeks out.
- **Boo**: a short beam-pose "boo" with an exclamation.
- **Haunt drift**: drifts to another spot.
- **Phase through**: a quick squish and hop to a new spot.
- **Spin float**: a floating spin dance.
- **Giggle fit**: a short shake with a heart.
- **Curious scan**: looks around slowly.

The module's own comment says every trick is meant to be harmless; that intent is not something a test or a run has shown.

## What it reacts to

Most keen on: the little ghost event (3.0), magic sparkles (2.0), shadow visitor (1.8), bubble parties and boxes (1.6), falling stars and leaves (1.5). Cooler about: thunderstorm (0.5), mini tsunami (0.4), mouse encounter (0.7). It dances with a visiting little ghost, floats along with a leaf or a cloud, hides in a box and peeks at a shadow or a visitor.

## Palettes

pale (default), mint, lavender, midnight, peach. Bodies are light or mid-toned with a dark outline so they separate from a white window and from a near-black desktop (palette comments; see the preview sheets).

## Voice

Hollow voice, pitch 0.8, gain 0.8, at least 3 s between sounds. Cues: whoo (voice and startled), chime (happy), whoo (move). Off by default; not heard in a real run.

## Capabilities

Climbs edges: no. Flies: yes. Passes through things: yes. Squashes: no. Memory: an allow-list of ten kinds (pet, nap, inspect, startle, play, attention, greet, hide, chase, called).

## Known limitations

- Not run in the real app; translucency and the vanish effect have been seen only on preview sheets, if at all.
- The teleport changes where the character is on the desktop; on hosts with a small window (the Android floating cat) how that looks has not been observed.
- One character at a time.
