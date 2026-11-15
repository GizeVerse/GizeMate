# Fox

Clever, quick and a little aloof. Back to the [characters overview](README.md).

Status: *implemented* (`src/shared/characters/fox.ts`, `src/renderer/overlay/characters/fox/`, `src/shared/i18n/characters/fox.ts`); *covered by unit tests* (`tests/unit/renderer/characters/fox.module.test.ts`, `fox.test.ts`, not run by this documentation); *preview sheets* exist; *not yet run in the real app*.

## Personality

From the app's copy: "Independent and observant. It warms up slowly, but once it trusts you it is loyal in its own quiet way." Newborn means: curiosity 0.78, energy 0.66, playfulness 0.55, sociability 0.35, mischief 0.68, affection 0.4, independence 0.85 (spread 0.15). Tuning: explores more (1.25), rests a little less (0.85), watches the cursor slightly less than the cat (0.9), jumpy (1.25), shy (1.35), speed 1.06.

## How it moves

A long, low quadruped: it trots (`walk`, gait scale 1.1) and has its own `run`, `stalk` and `slink`, `climb`, and a mouse `pounce`. Nominal size 100 by 62 DIP. It climbs window edges. Clips such as `hop`, `bounce`, `float` and `appear` are drawn as other fox clips (`walk`, `dance`, `stand`, `stand`).

## Signature behaviours

Seven, each with a cooldown of 70 seconds to 4 minutes:

- **Mouse pounce**: alert, a low wiggle, a leap and a nose-first dive (moves a little; the most likely of its signatures).
- **Play bow**: chest down, rump up, brush wagging.
- **Peek out**: ducks low and rises to look.
- **Slow stare**: sits, then walks toward the cursor for a long, slow look (needs the cursor near).
- **Spin trick**: chases its own brush.
- **Head tilt**: a curious tilt at something near (needs the cursor near).
- **Roll around**: a roll on its back, only in a happy, relaxed or excited mood.

## What it reacts to

Most keen on: a mouse (2.4), butterflies (2.0), boxes (1.8), curious birds (1.6), falling leaves (1.5), tiny treasures (1.4). Cooler about: thunderstorm and mini tsunami (0.5), little ghost (0.6), shadow visitor (0.7), flying fish (0.8). Reactions include: crouching at a butterfly, pouncing at a mouse, batting at yarn, a leaf or a paper plane, peeking at a box, hiding from a lightning bolt, and a growl when startled.

## Palettes

red (default), arctic, silver, dusk. The dark coats add a light rim outside the outline for dark wallpapers (palette comments).

## Voice

Bright voice, pitch 1.15, gain 0.8, at least 2.8 s between sounds. Cues: yip (voice), chirp (happy), growl (startled). Off by default; not heard in a real run.

## Capabilities

Climbs edges: yes. Flies: no. Passes through things: no. Squashes: no. Memory: an allow-list of twelve kinds (pet, nap, chase, inspect, startle, play, hide, hunt, pounce, stay, attention, greet).

## Known limitations

- Not run in the real app; preview sheets show posed frames only (one extra scratch file, `_c3left.png`, sits among its sheets and is not a deliverable).
- Its `hop` is drawn as a `walk`, so a world event that asks for a hop shows a step.
- One character at a time.
