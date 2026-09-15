# Palette lock

**Status:** approved, not yet implemented
**Date:** 2026-09-15

## The problem

The project uses **591 unique colours**, counted across `src/`, `scripts/` and
`src/styles.css`. Of those, **856 pairs sit closer than 12 units in RGB** — near
enough that no player can tell them apart. Some are the same colour typed twice:
`#1d1712` and `#1f1710` are 2.8 units apart.

They are spread over six files, concentrated in two:

| File | Unique colours |
|---|---|
| `src/game/assets/createPixelArtTextures.ts` | 276 |
| `src/game/assets/itemIcons.ts` | 268 |
| `scripts/generate-plot-art.mjs` | 23 |
| `src/game/scenes/FarmScene.ts` | 13 |
| `scripts/generate-ui.mjs` | 11 |
| `scripts/generate-assets.mjs` | 7 |

Plus 39 `0x` tints in Phaser calls and 24 in `styles.css`.

The committed art in `public/assets/lpc/` uses **322 colours** on its own. Its
distribution is steep — the 48 most-used colours already cover 85.4% of all
opaque pixels, and 64 cover 90.9%.

Nothing enforces a relationship between any of these numbers. Each generator
picks its own hex, so objects that share a screen do not share a world. This is
the single largest reason the game reads as cheap, ahead of any individual
sprite being badly drawn.

A secondary finding, which the work below catches for free: `stump.png` carries
**123 colours across 462 opaque pixels** — roughly one new colour every four
pixels. That is a resampled, anti-aliased image that got into a pixel-art
folder. Every other file is clean, at 3 to 34 colours.

## Decisions taken

Two questions were settled before design, and both were the user's call:

1. **Scope: everything, including re-quantising the imported LPC PNGs.** The
   looser options — locking only code-generated art — leave the hand-drawn art
   off-palette, which defeats most of the point.
2. **Size: 48 colours, derived by k-means from the existing LPC art.** Not a
   ready-made palette such as DB32, because a palette derived from the art the
   game already ships means the generated tiles move toward the characters
   rather than both moving somewhere new.

## Design

### 1. Invert the ownership of `public/assets/lpc/`

Today that folder is both source and destination: `npm run lpc:import` writes
into it from a download that lives outside the repository, and nothing else
retains the original. Quantising in place would therefore be irreversible, and
`git status` currently shows a dozen of those PNGs modified but uncommitted.

So the pipeline gains a stage, and the folder becomes derived output:

```
downloaded sheet (outside the repo)
  |- npm run lpc:import ---> art/raw/lpc/*.png        source of truth, committed
                                  |
                           npm run palette:apply
                                  v
                            public/assets/lpc/*.png   derived, safe to delete
```

This mirrors what the repository already does with `maps.generated.ts` and
`lpc.generated.ts`: a committed input, a script, and an output nobody edits by
hand. It costs about 85 KB of extra committed PNG, and it makes every later
stage re-runnable.

`scripts/import-lpc.mjs` changes only in its `OUT_DIR`, from
`public/assets/lpc` to `art/raw/lpc`. Its `EXPECTED` size table stays exactly
as it is — those checks belong on the import, not on the quantiser.

The move is a copy, not a `git mv`, and it happens in phase 1 rather than
phase 2 — `derive-palette.mjs` has to read a settled input folder. Until phase
2 regenerates it, `public/assets/lpc/` keeps the files it has and the game runs
exactly as before. Phase 1 is therefore invisible at runtime, which is what
makes it low risk despite touching every art file.

### 2. The palette is data, generated into code

Two runtimes need the same table: `scripts/*.mjs` under Node, and
`src/game/assets/*.ts` in the browser through Vite. Node cannot import a `.ts`
module reliably, and duplicating the table is how it drifts.

- **`art/palette.json`** — the data. 48 entries, each `{ name, hex, oklab }`.
- **`scripts/derive-palette.mjs`** — writes it. Weighted k-means in OkLab over
  every opaque pixel in `art/raw/`, seeded k-means++ so a given input always
  yields the same palette. Committed output, re-run only deliberately.
- **`src/game/assets/palette.generated.ts`** — written from the JSON, giving
  named constants and a union type. Follows the existing `*.generated.ts`
  convention.

OkLab rather than RGB throughout, because nearest-colour in RGB pulls dark
shades toward each other and flattens exactly the shading that matters most on
a character sprite. No dependency is added; the sRGB-to-OkLab transform is
about twenty lines and goes in `scripts/lib/colour.mjs` next to `png.mjs`.

### 3. Colours carry role names, not indices

This is the part that decides whether the lock survives contact with the next
feature. A palette exposed as `PALETTE[23]` is unmaintainable, and within a
month someone types a raw hex instead. So the 48 centroids are sorted into
named ramps of four or five steps:

```
soil     5   trough low base high crown
grass    5   deep shade base lit bleached
foliage  4        wood 4        stone 4       water 4
skin     4        cloth.warm 4  cloth.cool 4  metal 4
accent   6   gold berry bloom sky ember bone
```

`derive-palette.mjs` proposes the grouping by sorting centroids on hue, then
lightness within a hue band. **The naming is reviewed by a human once** and
then frozen in `art/palette.json`; the script never renames an existing entry
on a re-run, it only reports centroids that no longer match their name.

After this, `scripts/generate-plot-art.mjs` writes `soil.crown` where it now
writes `#9d7049`, and its local `SOIL` table disappears.

### 4. The lock is a test

Convention alone is not a lock. A test in `npm test` is:

- Walk every PNG under `public/assets/`. Fail on any opaque pixel whose colour
  is not in the palette. Report the file, the count, and the nearest palette
  name.
- Walk every `#rrggbb` and `0xRRGGBB` literal in `src/` and `scripts/`. Fail on
  any that is not a palette colour, and suggest the nearest name.

`art/raw/` is **not** scanned. It holds the originals as they were drawn, and
being off-palette is its entire job; a test that policed it would be a test
against the safety net.

Two further carve-outs, both explicit and both small:

- **Identity tints.** `0xffffff` means "no tint" in Phaser and is not a colour
  choice. An allowlist covers it and the handful like it.
- **Semi-transparent pixels.** Alpha is preserved untouched by the quantiser;
  only RGB is snapped. `tree.png` is 2.9% semi-transparent and `grass-tuft.png`
  10.8%, and their edges must stay soft.

`src/styles.css` is in scope but draws from a restricted subset — the accent
ramp plus neutrals — because HUD chrome and world art have different jobs.

### 5. Four phases, with a stop after the second

| Phase | Work | Risk |
|---|---|---|
| 1 | Move the PNGs to `art/raw/lpc/`, repoint `import-lpc.mjs`; then `colour.mjs`, `derive-palette.mjs`, `art/palette.json`, role naming | low — the move is a rename, and nothing reads the palette yet |
| 2 | `palette:apply` quantiser, regenerate the LPC PNGs into `public/assets/lpc/` | **high** — hand-drawn art may band |
| 3 | Migrate 544 hex literals in `createPixelArtTextures.ts` and `itemIcons.ts`, plus the generator scripts and CSS | medium — large volume, mechanical |
| 4 | The lock test, wired into `npm test` | low |

**Implementation stops after phase 2 for a visual review of the running game.**
That is the only moment at which anyone can tell whether 48 colours cost
`player-sheet.png` its shading. If it does, raising the palette to 64 is a
one-line change at that point, and re-migrating 544 literals afterwards is not.

### Testing

- `colour.mjs`: round-trip sRGB to OkLab and back within tolerance;
  nearest-colour picks the perceptually closest entry on hand-checked cases.
- `derive-palette.mjs`: same input yields byte-identical output across runs.
- The quantiser: **idempotent** — applying it to its own output changes
  nothing. This is the property that makes the pipeline safe to re-run.
- Alpha preservation: a semi-transparent pixel keeps its exact alpha.
- The lock test, verified by a fixture with a known off-palette pixel.

Phases 1, 2 and 4 are test-driven. Phase 3 is a mechanical substitution
guarded by the phase 4 test and by eye.

### What this does not do

No change to lighting, colour grading, terrain transitions or HUD layout. Those
were raised alongside palette lock and are genuinely separate work. A locked
palette is what makes a grading pass worth writing later, because there is
finally a fixed set of inputs for it to act on.
