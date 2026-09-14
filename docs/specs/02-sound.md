# 02 — Sound

## Goal

Make the game audible. It is currently silent: `grep -r "sound\|audio" src/`
returns two matches and both are comments.

## Why it matters more than it looks

Stardew almost never tells you what happened in words. It shows you and it plays
you a sound: the hoe thunks, the crop pops, the watering can hisses. Our game
prints "The earth turns soft and ready." into a prompt bar — the feedback style
of a text adventure attached to a pixel game.

For a cosy farming game, silence is probably the single largest gap between how
this looks and how it feels. It is also the cheapest to close.

## Design decisions

**Events are already the right hook.** `GameEvent` exists and the renderer
already subscribes to it. Sound is one more listener, not a new pathway. Keep
the reducer ignorant of audio entirely.

**One place maps events to sounds**, so the table can be read and tuned without
hunting through the scene.

```ts
// src/game/audio/soundtrack.ts
const EVENT_SOUNDS: Partial<Record<GameEvent['kind'], SoundId>> = {
  plotChanged: 'tool-hit',     // refined below, see "Which sound"
  harvested: 'crop-pop',
  sold: 'coins',
  questRewarded: 'fanfare',
  dayStarted: 'rooster',
  areaChanged: 'footstep-gravel',
  playerJoined: 'chime',
};
```

**`plotChanged` is too coarse for tool sounds.** Tilling, watering and planting
all produce it. Either add the action to the event:

```ts
| { kind: 'plotChanged'; key: string; action?: FarmAction }
```

— which is the better change, because the renderer wants it for particles too —
or read the tool off the acting player, which is wrong the moment two players
act in the same tick. Add the field.

**Browsers will not play audio before a gesture.** Phaser's sound manager starts
locked. Unlock it on the first keypress or click, and do not log a warning that
looks like an error before then.

**Music is a loop per area, not per scene.** Areas already exist and already
carry a name; give the map a `music` property in Tiled so a new area brings its
own track without a code change, exactly as `displayName` does now.

**Weather and night override.** Rain has its own bed of sound; after 20:00 the
day loop crossfades to a quieter night one. Crossfade over ~1.5s — a hard cut
is the most noticeable cheap-feeling thing in game audio.

**Everything is mixable and mutable, and the setting persists.** Three buses:
master, music, effects. Store the levels in `localStorage` beside the save. A
player who muted the game and reloads should stay muted.

## Assets

None exist. They need sourcing, and the licence matters as much as the sound —
the repo already keeps `public/assets/lpc/CREDITS.md` because the art is not
MIT, and audio needs the same treatment.

- Prefer CC0 (no attribution required, no share-alike). Freesound and
  OpenGameArt both have usable CC0 farming and UI sets.
- Record every file's source and licence in `public/assets/audio/CREDITS.md`.
- **Do not** take audio from Stardew Valley itself, or from any commercial game.
  It is not licensed for reuse and shipping it would make the project
  undistributable.

Format: `.ogg` with an `.m4a` fallback. Phaser picks per browser. Keep effects
under 100 kB each; they are loaded eagerly. Music streams.

Minimum set to feel finished:

| Sound | Used for |
| --- | --- |
| `tool-hoe`, `tool-water`, `tool-plant` | The three acting verbs |
| `crop-pop` | Harvest |
| `coins` | Selling, quest reward |
| `footstep-grass`, `footstep-path` | Walking, per tile kind, at a step cadence |
| `rooster` | Day start |
| `ui-select`, `ui-confirm` | Tool switch, menu |
| `rain-loop`, `night-loop`, `day-farm-loop`, `day-village-loop` | Beds |

## Files

- `src/game/audio/SoundManager.ts` — wraps Phaser's sound manager, owns the
  buses, the unlock, and the crossfades.
- `src/game/audio/soundtrack.ts` — the event-to-sound table and area music.
- `src/game/scenes/FarmScene.ts` — preload the files; subscribe the manager to
  `onGameEvent`; call it on area change and weather change.
- `src/App.tsx` — volume sliders and a mute toggle in the HUD panel.

## Footsteps

Not event-driven: they are a cadence while moving. Play on the same throttle the
dust puffs already use in `handleMovement`, picking the sample from the tile the
player is standing on via `tileAt(area, ...)`. Only for the local player —
remote footsteps at a distance are noise.

## Tests

Audio is hard to assert usefully, so test the mapping, not the output:

- Every `GameEvent['kind']` either maps to a sound or is deliberately listed as
  silent, so a new event cannot be forgotten. A table-driven test over the union
  catches this at compile time plus runtime.
- Volume settings round-trip through storage, and a blocked `localStorage`
  degrades to defaults rather than throwing.
- The manager tolerates a missing audio file: the game plays on in silence
  rather than failing to start, the same way missing art already falls back to
  procedural textures.

## Out of scope

Positional audio, per-NPC voice barks, dynamic music that reacts to activity.
