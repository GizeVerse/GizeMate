# Alien

The curious visitor. In Turkish it is called Uzaylı. Back to the [characters overview](README.md).

Status: *implemented* (`src/shared/characters/alien.ts`, `src/renderer/overlay/characters/alien/`, `src/shared/i18n/characters/alien.ts`); *covered by unit tests* (`tests/unit/renderer/characters/alien.module.test.ts`, `alien.test.ts`, not run by this documentation); *preview sheets* exist; *not yet run in the real app*.

## Personality

From the app's copy: "Endlessly curious and a little unpredictable, drawn to anything with a screen or a blinking light. Never quite sure what counts as normal here." Newborn means: curiosity 0.95, energy 0.6, playfulness 0.5, sociability 0.4, mischief 0.55, affection 0.35, independence 0.7 (spread 0.15). Tuning: speed 1.05, rests less (0.8), explores (1.3), watches the cursor closely (1.6), not jumpy (0.7), a little bold (0.75).

## How it moves

It levitates a few DIP above the ground and glides (locomotion `glide`, gait scale 1.1): `walk`, `run`, `stalk`, `slink`, `sprint` and `climb` are all drawn as `float` (`bounce` as `hop`). It draws `meow`, `pawAt`, `swat`, `hiss`, `impact`, `edgeSit` and `tailChase` natively (they used to be aliases). Nominal size 76 by 80 DIP. It can fly (capability), but it does not pass through things and does not climb edges.

## Signature behaviours

Eight, with cooldowns of 45 seconds to 3 minutes:

- **Scan sweep**: a slow sweep, a thin scan line passing the body while the head pans.
- **Light pulse**: the antennae charge, then send rings of light.
- **Teleport hop**: dissolves, reappears elsewhere (movement type `teleport`) and looks around.
- **Antenna tune**: strokes one antenna, tips pulsing.
- **Levitate spin**: a barrel roll in mid-air.
- **Probe the cursor**: drifts up to the cursor and studies it close up (moves toward it).
- **Robot dance**: stiff snapping poses (needs energy and a happy, excited or curious mood; rare).
- **Recharge**: a long stretch with the antennae dimming and flaring (only when energy is low; rare).

## What it reacts to

Most keen on: the tiny UFO (3.0, it dances), falling stars (2.2), paper planes and mysterious balls (1.8), magic sparkles (1.6), boxes (1.6), little ghost (1.5). Cooler about: thunderstorm (0.6), mini tsunami (0.5), wind gust (0.7). The laser is "the most fascinating thing there is": it tracks and scans it for up to six seconds. It scans a box, leaf, ball or paper plane, beams at a golden butterfly or a star, and startles at a lightning bolt or the tiny dragon.

## Palettes

green (default), blue, violet, silver. Each has a different antenna glow colour (lime, cyan, pink, gold) and a dark outline of the body's hue (palette file).

## Voice

Synthetic voice, pitch 1.4, gain 0.8, at least 2.5 s between sounds. Cues: bleep (voice and startled), chime (happy), whoo (move). Off by default; not heard in a real run.

## Capabilities

Climbs edges: no. Flies: yes. Passes through things: no. Squashes: no. Memory: all kinds.

## Known limitations

- Not run in the real app; the glow, scan line and teleport have been seen only on preview sheets, if at all.
- The glow and light pulse are subtle effects that calm under reduced motion; how they look on a bright desktop is unobserved.
- One character at a time.
