# Rabbit

Bright-eyed and light on its feet. Back to the [characters overview](README.md).

Status: *implemented* (`src/shared/characters/rabbit.ts`, `src/renderer/overlay/characters/rabbit/`, `src/shared/i18n/characters/rabbit.ts`); *covered by unit tests* (`tests/unit/renderer/characters/rabbit.module.test.ts`, `rabbit.test.ts`, not run by this documentation); *preview sheets* exist; *not yet run in the real app*.

## Personality

From the app's copy: "Affectionate, bubbly and a little timid. It needs a calm moment before it trusts a new surprise." Newborn means: curiosity 0.55, energy 0.78, playfulness 0.68, sociability 0.72, mischief 0.22, affection 0.78, independence 0.28 (spread 0.15). Tuning: speed 1.15, rests a little less (0.9), explores (1.2), plays (1.25), jumpy (1.3), very shy (1.45).

## How it moves

It hops instead of walking (locomotion `hop`): `walk`, `run`, `sprint`, `stalk` and `slink` are all drawn as `hop`. It draws `vanish` and `appear` natively (the burrow). Nominal size 66 by 68 DIP. It does **not** climb edges (it has no `climb` clip; that clip is drawn as a stand). It squashes when it lands (capability `squashes`).

## Signature behaviours

Eight, with cooldowns of 60 seconds to 4 minutes:

- **Binky**: a crouch, then a joyful leap with a twist (needs energy, not while sleepy).
- **Periscope**: stands tall on its hind feet and looks around, ears up (the most frequent).
- **Ear wash**: sits, pulls an ear down and washes it.
- **Foot thump**: thumps a hind foot as a warning, only when curious, startled or confused.
- **Nibble**: sits and nibbles something held in its forepaws (relaxed, happy or curious).
- **Zoomies**: hops in circles (needs high energy and a happy or excited mood).
- **Burrow**: dives into a burrow and pops up somewhere else, looking around (movement type `teleport`; rare; the code comment says the engine swaps it under reduced motion).
- **Peekaboo**: ducks low and peeks out again.

## What it reacts to

Most keen on: butterflies (2.2), falling leaves (1.8), boxes and bubble parties (1.5), magic sparkles (1.4). Cooler about: a tiny UFO (0.6), a little ghost and shadow visitor (0.5), thunderstorm (0.4), mouse encounter (0.7). Reactions: hops after a butterfly or the laser, nibbles at a leaf, hides in a box, freezes and thumps at a ghost or lightning bolt, shakes at a raindrop, hides from a shadow.

## Palettes

white (default), brown, gray, spotted. Soft pink inner ears and nose; a dark outline keeps it visible on light and dark desktops (palette comments).

## Voice

Soft voice, pitch 1.3, gain 0.8, at least 2.5 s between sounds. Cues: squeak (voice), trill (happy), thud (startled). Off by default; not heard in a real run.

## Capabilities

Climbs edges: no. Flies: no. Passes through things: no. Squashes: yes. Memory: an allow-list of ten kinds (pet, nap, chase, inspect, startle, play, attention, greet, hide, called).

## Known limitations

- Not run in the real app; preview sheets show posed frames only.
- It cannot climb window sides or hang from ledges.
- Hop-based motion on a tall window edge or other surface has not been observed in the real app.
- One character at a time.
