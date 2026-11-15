# Monkey

The acrobat. Back to the [characters overview](README.md).

Status: *implemented* (module `src/shared/characters/monkey.ts`, renderer `src/renderer/overlay/characters/monkey/`, copy `src/shared/i18n/characters/monkey.ts`); *covered by unit tests* (`tests/unit/shared/characters/monkey.test.ts`, `tests/unit/renderer/characters/monkey.test.ts`, not run by this documentation); *preview sheets* exist; *not yet run in the real app*.

## Personality

From the app's copy: "Playful, restless and a little mischievous. Gets bored quickly, so it is always up to something." Newborn means: curiosity 0.88, energy 0.86, playfulness 0.88, sociability 0.7, mischief 0.72, affection 0.55, independence 0.32 (spread 0.14). Tuning versus the cat: rests less (0.55), explores more (1.5), plays more (1.6), watches the cursor much more (1.7), jumpier (1.5), much less shy (0.55), speed 1.1.

## How it moves

A hunched knuckle-walk on all fours (locomotion `walk`, gait scale 1.05). Nominal size 72 by 86 DIP. It climbs window edges and hangs from ledges. Clips it draws natively include walk, run, climb, swing, hop, scan, peek, dance, scratch, groom, pawAt and a chest-beating `meow`; other clips resolve through its alias table (for example `stalk` and `slink` are drawn as `walk`, `bounce` as `hop`, `pounce` as `jump`).

## Signature behaviours

Nine, chosen by the shared weighted engine, each with its own cooldown (60 to 150 seconds):

- **Ledge swing**: hangs by its hands from a ledge and swings (needs a ledge and some energy).
- **Backflip**: a standing backflip, a few times in a row (needs energy, not while sleepy).
- **Silly dance**: pumping arms and bouncing knees.
- **Head scratch**: a long ponder, then the armpit.
- **Peekaboo**: ducks behind its hands, then peeks out.
- **Cursor mimic**: comes over to the cursor and copies it (needs the cursor near; moves toward it).
- **Chest beat**: a short hoot.
- **Survey the horizon**: a hand over the brow, looking around.
- **Pick fleas**: picks over its own fur (not when very energetic).

## What it reacts to

Most keen on: butterflies (2.2), toy springs (1.8), yarn, tiny treasures (1.7), boxes (1.6), mysterious balls, bubble parties, curious birds (1.5). Cooler about spooky or stormy things: little ghost (0.55), shadow visitor (0.5), thunderstorm (0.45), mini tsunami (0.5). Reactions are written for petting (heart, trill), being held (startled), the laser (crouches, chatters, excited), yarn, boxes (peeks), butterflies (hops), a mouse (startles), a ghost or dragon (hides), rain (annoyed), treasure and sparkles (dances) and more.

## Palettes

brown (default), golden, gray, cream, black. The black coat gets a thin light halo so it stays visible on a dark wallpaper (stated in the palette file's comments; check on the preview sheets).

## Voice

Bright voice, pitch 1.25, gain 0.8, at least 2.5 s between sounds. Cues: chatter (voice), chirp (happy), squeak (startled). Off by default; synthesized on the device; not heard in a real run.

## Capabilities

Climbs edges: yes. Flies: no. Passes through things: no. Squashes: no. Memory: all kinds.

## Known limitations

- Not run in the real app; the preview sheets show posed frames only.
- Its own name and palette are stored separately from the cat's (`general.characterNames`, `appearance.characterSkins`).
- One character at a time; switching on the web and Android host reloads the page.
