# Audio credits — `public/assets/audio/`

Unlike `public/assets/lpc/`, everything in this folder **is** under the repo's
MIT license: none of it is sampled or recorded. Every file is synthesised from
`scripts/generate-audio.mjs`, the same way the runtime textures are drawn from
`src/game/assets/createPixelArtTextures.ts`.

Regenerate with:

```
npm run generate:audio
```

The synthesis is deterministic — the noise source is a seeded LCG, not
`Math.random` — so re-running produces byte-identical files and a re-generate
is never an unreviewable diff.

## What is here

| File | Made of |
| --- | --- |
| `sfx/tool-hoe.wav` | Low-passed noise knock over a falling sine thump |
| `sfx/tool-water.wav` | Band-passed noise hiss with a wavering trickle tone |
| `sfx/tool-plant.wav` | Short muted noise pat plus a 210 Hz body |
| `sfx/crop-pop.wav` | Sine with a fast upward pitch sweep |
| `sfx/coins.wav` | Three inharmonic struck partials, 55 ms apart |
| `sfx/fanfare.wav` | Rising C–E–G–C, near-sine so it stays soft |
| `sfx/rooster.wav` | Stacked harmonics on a hand-drawn pitch contour |
| `sfx/footstep-grass.wav`, `sfx/footstep-path.wav` | Noise scuffs, different filter cutoffs |
| `sfx/footstep-wood.wav` | The same scuff with a short 190 Hz knock under it, for floorboards |
| `sfx/ui-select.wav`, `sfx/ui-confirm.wav` | One- and two-note sine blips |
| `sfx/chime.wav` | Bell partials at 1 : 2.01 : 2.98 : 4.2 |
| `sfx/slump.wav` | Falling low tone under a noise thud |
| `sfx/wither.wav` | A minor third gliding flat under a dry rustle |
| `sfx/animal-call.wav` | A two-note call on stacked harmonics, with a slow wobble |
| `music/day-farm-loop.wav` | C-major pad with a plucked eight-bar figure |
| `music/day-village-loop.wav` | D-major pad, busier figure |
| `music/night-loop.wav` | Low pad, sparse plucks, rolled off at 2.2 kHz |
| `music/home-loop.wav` | C-major pad an octave down, slow low plucks, rolled off at 2.8 kHz |
| `music/mine-loop.wav` | A-minor pad two octaves down, sparse high "drip" plucks, rolled off at 1.8 kHz |
| `music/rain-loop.wav` | Filtered noise rain with gusts over a quiet pad |

Every music bed is exactly 8 seconds and loops seamlessly: partial frequencies
are snapped to multiples of 1/8 Hz, pluck tails are written round to the start
of the buffer, and the rain's noise is crossfaded with half a second of
overhang.

## Replacing these with recordings

They are honest placeholders, not finished sound design — they make the game
audible and let the mix, the crossfades and the event table be tuned against
something real. Recorded samples will sound better. When sourcing them:

- **Prefer CC0** (no attribution required, no share-alike). Freesound and
  OpenGameArt both have usable CC0 farming and UI sets.
- Record every file's source, author and licence in this file, the way
  `../lpc/CREDITS.md` does for the art.
- **Do not** take audio from Stardew Valley or any other commercial game. It is
  not licensed for reuse and shipping it would make this project
  undistributable.

`.ogg` with an `.m4a` fallback is the format to aim for; these placeholders are
WAV because encoding either needs a dependency this repo does not carry.
Nothing in the game code cares: `SOUND_URLS` and `musicUrls` in
`src/game/audio/soundtrack.ts` hand Phaser a list of URLs per sound and Phaser
picks the first format the browser supports, so a new format is an extra entry
in that table and nothing else.
