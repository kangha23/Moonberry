# Real art migration

**Status:** approved, not yet implemented
**Date:** 2026-09-16

## The problem

`createPixelArtTextures.ts` draws **263 unique textures** onto canvases at boot.
Only 22 of them are ever overridden by a real image; the rest are what the
player actually looks at. Counted by group:

| Group | Keys | What it is |
|---|---|---|
| `item-*` | 126 | Every hotbar and satchel icon |
| `edge-*` | 45 | Tile transition fringes, 3 boundaries x 15 masks |
| `placeable-*` | 15 | Chests, machines, fences, paths on the ground |
| `node-forage-*` | 12 | Forage standing in the grass |
| `node-*` | 11 | 5 tree stages, stump, rock, boulder, weed, grass, chip |
| `icon-*`, `clock-*` | 12 | HUD chrome |
| `npc-*` | 6 | Villager standing sprites |
| `building-*` | 5 | Shed, silo, coop, barn, scaffold |
| `animal-*` | 5 | 4 animals plus the hunger marker |
| `crop-*` | 4 | `crop-seeded`, clover, wheat, barley |
| Other | 22 | Particles, shadows, well, blacksmith, cottage, pen |

Against that, `public/assets/lpc/` holds **53 real texture keys** — ground
tiles, soil states, 10 ripe crops, the farmhouse, a tree, two human walk sheets
and four animal walk sheets.

The imbalance is the problem. A field of real LPC grass with a procedurally
drawn rectangle standing on it reads as a placeholder next to art, and no
amount of care in the rectangle fixes that. The pixel sizes agree — everything
is native 32px, and that is enforced — but the drawing quality does not.

## Decisions taken

Three questions were settled before design, all of them the user's call:

1. **Scope: every object in the world, not the effects and not the HUD.** The
   16 particle and shadow textures (rain, smoke, dust, sparkle, firefly, glow,
   cloud shadow, splash, tile cursor, the two shadows) and the 12 HUD chrome
   textures (season, weather, coin, energy, clock face and hand) stay
   generated. A 3x10px raindrop and an ellipse shadow are better as code: they
   cost nothing, they follow the palette automatically, and a bitmap of them
   would be strictly worse.

2. **The generated drawings stay, as fallback.** `withTexture` already yields
   to a loaded image, so nothing has to be deleted for real art to win. Keeping
   them means a blocked CDN or a half-cloned checkout is a plainer farm rather
   than a field of blank sprites. The cost is that
   `createPixelArtTextures.ts` stays long and there are two drawings of each
   object to maintain; that was accepted deliberately.

3. **Sources: LPC, with a declarative manifest.** LPC covers every group —
   `[LPC] Fish`, `[LPC] Hand Tools`, `[LPC] Food`, `[LPC] Containers`,
   `[LPC] Farming tilesets`, `[LPC] Blacksmith`, `[LPC] Woodshop`,
   `[LPC] Misc tile atlas` — which keeps one drawing style, one perspective and
   one pixel size across the whole farm.

### What those decisions take out of scope

Decision 2 shrinks the work. `animal-chicken/duck/cow/goat`, `player`, and
`npc-rowan/bram/juniper` are *already* shadowed by real sheets: they are the
fallback, and the fallback is being kept. `crop-seeded` stays generated for the
reason `CREDITS.md` already gives — the LPC set has no "just sown" frame, and
its nearest thing sits on `plot-tilled` looking like a hole.

So the real work is:

- **182 targets** to download and cut
- **45 `edge-*`** fixed in code, with nothing downloaded
- **6 new villager walk sheets**, which is new art rather than a replacement

## Approach

Three approaches were weighed: running `lpc:import` by hand 182 times; putting
every cut in a declarative table behind one sync command; or splitting the two.

**The split was chosen.** Roughly 200 of the cuts are "cell (x, y) of this
grid", which is exactly what a table is good at. Forcing a 21-row character
generator export into that same schema would grow a set of special cases each
used once, and `import-lpc.mjs` already handles those well with command-line
flags.

## Design

### 1. `art/sources.json` and `npm run art:sync`

The manifest has two sections — the packs, and the cuts:

```json
{
  "packs": {
    "lpc-fish": {
      "title": "[LPC] Fish",
      "page": "https://opengameart.org/content/lpc-fish",
      "licence": "CC-BY-SA 3.0 / GPL 3.0+",
      "authors": ["bluecarrot16"],
      "files": { "fish.png": { "from": "https://.../fish.png", "sha256": "9f2c..." } }
    }
  },
  "notImported": {
    "tile-grass": "imported before this table existed; source coordinates were not recorded"
  },
  "cuts": [
    { "target": "item-carp", "pack": "lpc-fish", "file": "fish.png", "grid": 32, "cell": [0, 0] },
    { "target": "maeve-sheet", "pack": "lpc-generator", "walkcycle": true,
      "layers": {
        "010 body.png": { "from": "https://.../body.png", "sha256": "1a2b..." },
        "100 dress.png": { "from": "https://.../dress.png", "sha256": "3c4d..." }
      } }
  ]
}
```

`art:sync` downloads any missing pack file into `art/sources/<pack>/`
(gitignored — the whole upstream pack is not redistributed from this repo),
**verifies its sha256** and fails if upstream has changed, then for each cut
calls `planImport()` from `import-lpc.mjs` and writes
`art/raw/lpc/<target>.png`.

The important property is that **no cutting logic is reimplemented**.
`planImport` already holds every size rule the game depends on — 32x32 for a
tile or a crop, 576x256 for a walk cycle, divisible by 4x4 for an animal sheet —
and already refuses a cut that lands entirely off the edge of its source. It is
covered by `scripts/lib/png.test.mjs`. `art:sync` is a loop over a table that
calls it.

A `layers` cut downloads, caches and sha256-verifies each layer exactly the way
a plain pack file is — under `art/sources/<pack>/<target>/` rather than
`art/sources/<pack>/` — and hands that folder to `readSource()`, which
composites the PNGs in file-name order. The numeric prefixes are that order,
which is why the names carry them.

The command ends by running the existing `palette:apply` and `lpc:manifest`
steps, so one invocation takes a table entry all the way to a texture key the
game asks for.

### 2. `art:sync --check`

Runs in `npm test`. Two assertions:

- every PNG in `art/raw/lpc/` is either produced by a `cut` or listed in
  `notImported` with a reason
- every `pack` referenced by a cut appears in `public/assets/lpc/CREDITS.md`

`notImported` is the escape hatch, and it is a map rather than a list so that
each entry has to say *why*. It covers two cases: art drawn by hand for this
repo, and art imported before this table existed whose source coordinates were
never written down. It is not a place to put work that was skipped.

An art file with no recorded source, or with no attribution, becomes a red
build rather than a line somebody forgot. The licences here are CC-BY-SA and
GPL; attribution is a condition, not a courtesy.

**CREDITS.md is not generated.** It is prose explaining why each choice was
made — which crop is a stand-in for which, why the duck is a recoloured hen,
why the goat is drawn smaller than the rest of its set. Generating it would
destroy the part of it worth having. `--check` only stops it going stale.

### 3. `edge-*` sampled from real tiles

`drawFringe` currently fills with three flat colours from `FRINGE_PALETTES`.
The good part of it — depth wobbling per pixel from `hash`, a dithered leading
edge — has nothing to do with colour. Replace the fill:

1. draw the fringe mask in any opaque colour (only its alpha matters)
2. `ctx.globalCompositeOperation = 'source-in'`
3. `ctx.drawImage(scene.textures.get('tile-grass').getSourceImage(), 0, 0)`
4. redraw the dark leading edge on top, so the boundary keeps its definition

Grass spilling over a path becomes literally the pixels of the grass beside it.
`FRINGE_PALETTES` is deleted, the function gets shorter, and it stays correct
under the fallback, because it samples whatever `tile-grass` currently is.

45 textures move to real art with nothing downloaded.

### 4. `item-*` in React

`ItemIcon.tsx` draws SVG from `iconFor()` and knows nothing about the PNGs.
`generate-lpc-manifest.mjs` gains a `LPC_URL_BY_KEY` export, and the component
branches:

```tsx
const url = LPC_URL_BY_KEY[ITEMS[item].texture];
return url
  ? <img className="item-icon" src={url} width={size} height={size} alt="" />
  : <svg>{/* unchanged */}</svg>;
```

Plus `image-rendering: pixelated` in the stylesheet. The Phaser side needs no
change: hotbar and summary icons call `setDisplaySize`, so a 32px source sits
in the 16px slot the old icons used.

This also closes something `CREDITS.md` currently apologises for — that the
field sprite and the satchel icon are separate decisions which agree on colour
but not on shape. They become the same file.

### 5. Villager sheets

`readSource()` already accepts a folder of layer PNGs. Six distinct villagers
is therefore one `layers` cut each, then in `src/game/npcs/villagers/`: point
`sheet` at the new sheet and set `tint` back to `0xffffff`. The `sheet` field is
typed from the generated manifest, so a wrong name is a compile error rather
than a villager who silently stops walking.

## Order of work

Eight batches, each one commit with `npm run quality:fast` green.

| Batch | Contents | Count | Why here |
|---|---|---|---|
| 0 | `art:sync`, `--check`, and `sources.json` backfilled for the art already committed | — | The tool proves itself by rebuilding files that already exist, where a wrong cut is visible as a diff. See the note below on how far the backfill can go. |
| 1 | `edge-*` sampled from real tiles | 45 | Nothing downloaded, pure code, immediate payoff. Lowest risk, so it validates the loop first. |
| 2 | Resource nodes and forage props | 23 | The plants/fungi/wood pack is already partly vendored, so few new packs. **First batch that measures the palette risk.** |
| 3 | Placeables, their item icons, and well/blacksmith/cottage/ranch-pen | 34 | One source pass covers the ground sprite and the inventory icon together. |
| 4 | 26 tool icons, 26 crop and seed icons, 3 missing field crops | 55 | What the player looks at most, because it is always in the hotbar. |
| 5 | 21 fish and junk, 12 animal produce, 12 forage icons, 7 materials, 6 artisan goods, bait | 59 | Split into one commit per source pack. |
| 6 | Six villager walk sheets | 6 | New art; also retires the runtime tint. |
| 7 | Five buildings | 5 | **Riskiest, so last.** See below. |

### How far batch 0 can actually backfill

`CREDITS.md` records exact grid coordinates for the crops pack ("band 1 column
10 row 7") and for the plants pack, so those entries are transcription. It does
**not** record them for the terrain tiles, the farmhouse, the tree or the walk
sheets. Those go into `notImported` with that as the reason, and are only
converted to real cuts if someone re-derives the coordinates.

Batch 0 is therefore not blocked on recovering history. Its job is to make the
tool work and to make every existing file *accounted for*, not to make every
existing file reproducible.

Note also that `art/raw/lpc/` holds 46 files while `public/assets/lpc/` holds
56: the `plot-*-2` and `plot-*-3` variants are produced by
`generate-plot-art.mjs` during `palette:apply` and never exist as raw files.
`--check` walks the raw folder, so it will not see them.

### Why buildings go last

The scene stretches one drawing to whatever footprint `BUILDING_DEFS` gives a
kind. A procedural drawing survives that because it is drawn in proportions;
real art stretched is real art distorted. Batch 7 will most likely have to fix
`BUILDING_DEFS` to sizes that match the art, or cut the art to the footprints.
That is a gameplay-adjacent change, and it should happen once everything else
has settled rather than halfway through.

## Testing

- `art:sync --check` in `npm test`, as described above.
- The existing palette lock already fails the build on any colour outside the
  48. No new test is needed for that.
- A new test: every `ITEMS[id].texture` resolves to either a PNG in the manifest
  or a generated icon — no item can render blank.
- `npm run quality:fast` green per batch.

## Risk: the 48-colour palette

`art/palette.json` holds 48 colours derived from the art that existed when the
lock was written. This migration pushes 182 new sprites through that lock — 18
fish, 12 forage, 6 artisan goods, a lot of new hues.

**The plan is to measure, not to guess.** After batch 2, compute the mean OkLab
distance between each new file and its quantised output. Within tolerance:
continue, 48 is enough. Clearly off — fish and artisan goods are the suspects —
then **widening the palette becomes its own spec**, because re-running
`palette:derive` recolours every file already committed. That decision must not
be swallowed inside an art-import batch.

## Licensing

Everything imported is CC-BY-SA 3.0 / GPL, or CC-BY 3.0. Adaptations stay under
the same licence and must not be relicensed as MIT. Each new pack gets a section
in `CREDITS.md` with authors, licence and source URL, and `--check` enforces
that the section exists before the build passes.
