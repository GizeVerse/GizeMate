# Slime

The bouncy blob. In Turkish it is called Jöle. Back to the [characters overview](README.md).

Status: *implemented* (`src/shared/characters/slime.ts`, `src/renderer/overlay/characters/slime/`, `src/shared/i18n/characters/slime.ts`); *covered by unit tests* (`tests/unit/renderer/characters/slime.module.test.ts`, `slime.test.ts`, not run by this documentation); *preview sheets* exist; *not yet run in the real app*.

## Personality

From the app's copy: "Playful and affectionate. Everything is a game, and everything wobbles." Newborn means: curiosity 0.55, energy 0.72, playfulness 0.95, sociability 0.7, mischief 0.45, affection 0.8, independence 0.25 (spread 0.15). Tuning: speed 0.95, rests less (0.8), explores (1.15), plays much more (1.5), likes the cursor (1.4), jumpy (1.5), bold (0.7).

## How it moves

A limbless jelly that bounces (locomotion `bounce`, gait scale 0.95): `walk`, `run` and `sprint` are drawn as `bounce`. It squashes and stretches with each step and wobbles after landing (capability `squashes`). Nominal size 70 by 58 DIP. It flattens to a puddle for `hide`, `sleep` and `squish`, so its clickable region is widest there. It does not climb edges.

## Signature behaviours

Eight, with cooldowns of 35 to 100 seconds:

- **Stretch to the cursor**: reaches tall toward the cursor (moves toward it).
- **Double bounce**: crouches and springs twice, high.
- **Melt into a puddle**: squishes flat, rests, re-forms with a wobble.
- **Wobble dance**: shakes the whole body to a beat.
- **Shape shift**: tries tall, flat and ball shapes while looking around.
- **Bubble blow**: blows a bubble and watches it float away.
- **Peekaboo**: sinks into a puddle and peeks out.
- **Jelly shake**: shakes like jelly on a plate.

## What it reacts to

Most keen on: bubble parties (2.2), toy springs (1.8), butterflies (1.6), mini tsunami (1.5, it likes water), magic sparkles (1.5), yarn (1.4). Cooler about: thunderstorm (0.6), shadow visitor (0.6), mouse encounter and wind gust (0.8). Reactions: squishes at yarn and a wave, bounces after a ball or a butterfly, splashes, hides in a box, peeks at a mouse or ghost, dances at a leaf or sparkles.

## Palettes

lime (default), berry, ocean, sunset. Each has a darker core, a brighter highlight and a deep outline of the body's own hue so the silhouette reads on light and dark desktops (palette comments).

## Voice

Squelchy voice, pitch 1, gain 0.8, at least 2.5 s between sounds. Cues: squelch (voice), boing (happy), squeak (startled), boing (move); it also uses splash for water. Off by default; not heard in a real run.

## Capabilities

Climbs edges: no. Flies: no. Passes through things: no. Squashes: yes. Memory: all kinds.

## Known limitations

- Not run in the real app; the squash and stretch have been seen only on preview sheets, if at all.
- A flat puddle is a wide target; whether the clickable region ever feels too generous is unobserved.
- One character at a time.
