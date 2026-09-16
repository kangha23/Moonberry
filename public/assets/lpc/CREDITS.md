# Art credits — `public/assets/lpc/`

Game code in this repo stays under the repo's MIT license.
The artwork files in this folder are **not** MIT — each keeps its own license:

## Liberated Pixel Cup (CC-BY-SA 3.0 + GPL 3.0, dual-licensed)

Applies to: `tile-grass*.png`, `tile-path.png`, `tile-water.png`,
`plot-*.png`, `grass-tuft.png`, `tree.png`, `farmhouse.png`,
`player-sheet.png`, `rowan-sheet.png`
(sliced and composed from LPC sheets; adaptations stay under the same licenses)

- Terrain, trees, house parts: **Lanea Zimmerman (Sharm)**
  https://opengameart.org/user/1727
- Character walkcycle templates (male/female): **Stephen Challener (Redshrike)**,
  commissioned by William Thompson (William.Thompsonj)
  https://opengameart.org/user/47
- Clothes, hair, shoes layers composited into the walkcycles (Farmer outfit:
  Forest long-sleeve, Leather pants, Brown shoes, Bedhead hair; Rowan outfit:
  Blue Irish dress, Ghillies, Brown Bangs-Long hair): **Universal LPC
  Spritesheet contributors** via the character set vendored in the LPC repo
  (`sprite/character/`)
  https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator
- Source: https://github.com/OpenGameArt/LiberatedPixelCup
- Licenses: https://creativecommons.org/licenses/by-sa/3.0/
  and https://www.gnu.org/licenses/gpl-3.0.html

## [LPC] Crops (CC-BY-SA 3.0+ or GPL 3.0+)

Applies to: `crop-sprout.png` and the ripe crops `crop-turnip`,
`crop-strawberry`, `crop-tomato`, `crop-melon`, `crop-rhubarb`, `crop-pumpkin`,
`crop-cranberry`, `crop-winterberry`.

> "[LPC] Crops" by bluecarrot16, Daniel Eddeland (daneeklu), Joshua Taylor,
> Richard Kettering (Jetrel). Commissioned by castelonia.
> License CC-BY-SA 3.0+ or GPL 3.0+.
> https://opengameart.org/content/lpc-crops

The licence requires the full attribution statement, so the upstream credits
file is vendored verbatim at [`credits/CREDITS-crops.txt`](credits/CREDITS-crops.txt)
and is part of this notice.

**How the sheet is read.** `crops.png` is 1024x1024 of native 32x32 cells, in
three bands of ten rows. Within a band the growth stages are on rows 1, 3, 5, 7
and 9 — the even rows are headroom for tall plants — and **row 7 is ripe**;
row 9 is the same plant after harvest. Columns follow the order of the item
table in the credits file exactly. So `crop-turnip` is band 1 column 10 row 7,
and `crop-strawberry` is band 2 column 20 row 17.

Two of these are stand-ins rather than name matches, and should be replaced if
the right drawing turns up: `crop-cranberry` is the pack's raspberry bush and
`crop-winterberry` is its blueberry bush. Both are the right shape and the
right colour temperature, which is most of what a crop sprite has to do.

## [LPC] Flowers / Plants / Fungi / Wood (CC-BY-SA 3.0)

Applies to: `crop-sunflower.png` (column 4, row 6), `crop-frostcap.png`
(column 5, row 22 — the pack's ice-blue mushroom), and the scatter props
`bush` (8, 22), `tuft-tall` (9, 22), `flowers-red` (8, 5), `flowers-gold`
(9, 5), `flowers-white` (8, 10), `stump` (0, 24), `log` (3, 24) and
`stump-flowers` (5, 24).

Also nine forage icons from the same sheet, listed in `art/sources.json` with
their exact cells: `item-purple-mushroom` (0, 22), `item-wild-daisy` (1, 3),
`item-poppy` (8, 9), `item-buttercup` (9, 9), `item-daffodil` (9, 4),
`item-wild-grape` (3, 19), `item-chestnut` (3, 7), `item-wild-greens` (10, 10)
and `item-wild-leek` (0, 10). Note the coordinates in this file are quoted the
way the pack's own documentation reads them; `art/sources.json` is zero-based,
and `npm run art:sync -- --verify` is what decides which is right.

Also seventeen resource nodes from the same sheet — the five tree growth
stages, the stump, the grass clump, the bramble, and one for each of the nine
forage items above. These are not grid cells: a node is drawn in a 64x80 box
with its feet on a floor line at y=74, which is where the scene hangs it off
the ground, so each one is a `rect` of the sheet padded into that box by
`--box 64x80 --floor 74`. The exact rectangles are in `art/sources.json`.

The tree stages were chosen for silhouette rather than for being the same
drawing five times: a sprout, a bare sapling with its first leaves, a young
round tree, a tall thin one, and a full canopy. Two candidates that looked
right in the sheet turned out to be hedges rather than trees, which only
became obvious once they were rendered standing on the floor line — worth
knowing before picking the next batch by eye.

`node-rock` and `node-boulder` keep their generated art: this is a pack of
flowers, plants, fungi and wood, and there is no stone in it. So does
`node-chip`, which is a 6x6 particle rather than an object.

The three remaining forage items keep their generated icons, because this pack
has no mineral and no root vegetable in it: `item-quartz`, `item-snow-yam` and
`item-winter-root`.

**What the palette does to these.** Quantising them to the 48 colours moves
every pixel by a mean of 0.022 to 0.064 in OkLab, which is small. Three of the
nine used to lose the colour they are named for — the palette held no saturated
yellow at all and only one muted purple, so `item-daffodil` and
`item-buttercup` came out cream and `item-purple-mushroom` and
`item-wild-grape` came out a violet-grey.

That is fixed, and the fix is worth recording because the obvious answer was
the wrong one. The palette did not need to be bigger. It had been derived from
the art that existed when it was written — grass, soil, people — and that
corpus never asked for yellow, so clustering never kept any. Re-deriving it
from the art as it stands now finds yellow immediately, at the same 48. But a
re-derivation renames every entry: only 7 of 48 names survived, breaking 38 of
the 45 names the code uses across 935 call sites.

So three entries were swapped by hand instead. `clothDeep.1/2/3` were named by
no code at all, and became `gold.0`, `gold.1` and `berry.0` — two olive-golds
taken off the art that needed them, and one berry purple. Nothing in `src/`
changed. The cost is real but small and was measured: those three were doing
some work on the two walk sheets, so re-quantising moves the player's mean
error from 0.0132 to 0.0176, which is below the point where two colours read
as different when they are not side by side, and the before/after renders of
both characters are indistinguishable.

It also fixed something nobody was aiming at: the yellow-green highlights on
`node-tree-4` used to quantise to near-white, and now stay yellow-green.

The scatter props are placed by `scripts/generate-maps.mjs`, not by hand: it
sprinkles them over any grass tile whose eight neighbours are also grass, which
keeps every one of them a clear tile away from paths, shores and field edges.

> "[LPC] Flowers / Plants / Fungi / Wood," by bluecarrot16, Guido Bos,
> Ivan Voirol (Silver IV), SpiderDave, William.Thompsonj, Yar, Stephen
> Challener and the Open Surge team, Gaurav Munjal, Johann Charlot, Casper
> Nilsson, Jetrel, Zabin, Hyptosis, Surt, Lanea Zimmerman, George Bailey,
> ansimuz, Buch, and the Open Pixel Project contributors. CC-BY-SA 3.0.
> https://opengameart.org/content/lpc-flowers-plants-fungi-wood

Full per-item credits vendored at
[`credits/CREDITS-plants.txt`](credits/CREDITS-plants.txt).

## [LPC] Containers (mixed licences — see the vendored credits)

Applies to six things the player builds and puts down, each cut once and used
twice — as the sprite standing on the tile and as the icon in the satchel:
`chest` (a plain banded chest), `big-chest` (the red ornate one, so the two
read apart at a glance), `keg` (a barrel), `jar` (a clay pot), `churn` (a
wooden bucket) and `kiln` (a dark cauldron). Exact rectangles are in
`art/sources.json`.

The ground sprite and the icon differ only in where the content sits inside
its 32x32 box. The scene centres a placeable texture on its tile, so the
ground version stands on the box's bottom edge; the hotbar forces a square, so
the icon is centred instead.

> "[LPC] Containers" by bluecarrot16, Lanea Zimmerman (Sharm), William
> Thompson, Tuomo Untinen (Reemax), Evert, Buch, Blarumyrran, n2liquid,
> Jetrel, Guido Bos, Hyptosis, Bonsaiheldin, NaRNeRZz, PriorBlue, Jerom,
> 7Soul, and Wolthera van Hövell tot Westerflier (TheraHedwig).
> https://opengameart.org/content/lpc-containers

**This pack's licence is not one licence.** It is assembled from eighteen
upstream sets under CC-BY-SA 3.0, CC-BY-SA 4.0, CC-BY 3.0, CC-BY 4.0, GPL 3.0,
GPL 2.0, OGA-BY 3.0 and CC0, and its own credits file does not say which
sprite came from which set. Two consequences worth stating rather than
glossing: the pack asks that **all** the authors above be credited with a link
back, which is why the whole list is here; and because one contributing set is
CC-BY-SA **4.0**, which 3.0 cannot absorb, anything derived from this pack
should be treated as CC-BY-SA 4.0 rather than 3.0 unless someone traces the
individual sprite. The upstream credits file is vendored verbatim at
[`credits/CREDITS-container.txt`](credits/CREDITS-container.txt) and is part of
this notice.

## [LPC] Farming tilesets, magic animations and UI elements (CC-BY-SA 3.0 or GPL 3.0)

Applies to the two fences, the plank path, and four of the fish:
`placeable-wood-fence` / `item-wood-fence` (a rail fence),
`placeable-hardwood-fence` / `item-hardwood-fence` (a picket fence),
`placeable-wood-path` / `item-wood-path` (decking cut out of the middle of the
pack's dock), and `item-perch`, `item-smallmouth-bass`, `item-rainbow-trout`,
`item-pike`. Exact rectangles are in `art/sources.json`.

> "[LPC] Farming tilesets, magic animations and UI elements" by
> **Daniel Eddeland (Daneeklu)**. Dual-licensed CC-BY-SA 3.0 or GPL 3.0 or
> later. Some of the art is based on the LPC competition base assets.
> https://opengameart.org/content/lpc-farming-tilesets-magic-animations-and-ui-elements

The pack's own readme is vendored verbatim at
[`credits/CREDITS-daneeklu.txt`](credits/CREDITS-daneeklu.txt).

The three tiles are cut so that they **repeat**: the fences are the middle
piece of a horizontal run, so a row of them is one continuous fence rather
than a row of separate posts, and the decking is cut on the planking's own
32-pixel period (`y = 10`, not `y = 0`) so that a path has no seam across it.
Each was checked by tiling it three by three before it was committed.

**Only four fish, not the eighteen the game has.** The pack draws five
species — perch, bass, trout, pike and a tuna — and the game's list has no
tuna in it, so four are imported and fourteen keep their generated drawings.
Recolouring one fish into five would have put five names on one drawing, which
is the thing this whole migration exists to stop doing.

The four share a 40x40 box rather than the 32x32 every other icon uses,
because a pike is 36 pixels long and a perch is 18: boxing each one snugly
would have drawn them the same size in the satchel. The box is square, so
`ItemIcon`'s `width={size} height={size}` still scales it without distortion.

## [LPC] Terrains (CC-BY-SA 3.0 / GPL 3.0 / CC-BY 3.0)

Applies to: `placeable-stone-path` / `item-stone-path` (pale flagstone, the
`Stone_White` terrain) and `placeable-gravel-path` / `item-gravel-path` (the
`Gravel_1` terrain).

> "[LPC] Terrains" by **bluecarrot16, Lanea Zimmerman (Sharm), Daniel Eddeland
> (Daneeklu), Richard Kettering (Jetrel), Zachariah Husiar (Zabin), Hyptosis,
> Casper Nilsson, Buko Studios, Nushio, ZaPaper, billknye, William Thompson,
> caeles, Stephen Challener (Redshrike), Bertram, and Rayane Félix
> (RayaneFLX)**.
> https://opengameart.org/content/lpc-terrains

This pack is also assembled from other people's work — twelve upstream sets —
but unlike the containers pack every one of them is CC-BY-SA 3.0, GPL 3.0 or
CC-BY 3.0, so the whole thing sits under CC-BY-SA 3.0 with no 4.0 surprise in
it. The upstream credits file, which names each set and its licence, is
vendored verbatim at [`credits/CREDITS-terrain.txt`](credits/CREDITS-terrain.txt)
and is part of this notice.

Both cuts are the **centre** tile of the terrain's 3x3 blob, which is the one
tile in the set designed to tile against itself. The cells either side of it
are edge pieces with transparent corners and were rejected by tiling them and
looking: a path built from one of those is a row of ragged islands.

## [LPC] Floors (CC-BY-SA 4.0)

Applies to `tile-floor-wood` (cell 6, 37 — honey-coloured boards laid in a
staggered run, which tiles with no visible seam) and `furniture-rug` (the red
fringed rug, boxed into 96x84 so it can be centred on a three-tile footprint in
front of the hearth). Exact cells are in `art/sources.json`.

> "[LPC] Floors" by bluecarrot16, Lanea Zimmerman (Sharm), William Thompson
> (William.Thompsonj), Hyptosis, SpiderDave, Cougarmint, Stephen Challener
> (Redshrike), Bonsaiheldin, Tyler Olsen (Roots), Jetrel, jestan, The Open
> Surge team (http://opensnc.sourceforge.net), Gaurav Munjal, Reemax, Silveira
> Neto, bleutailfly, Casper Nilsson, NaRNeRZz, Buch, keith karnage, Arthur
> Carvalho, Guilherme Vieira (n2liquid), Chris Hamons (maintainer).
> CC-BY-SA 4.0. https://opengameart.org/content/lpc-floors

**This one is CC-BY-SA 4.0, not 3.0**, and is listed apart from the 3.0 packs
for that reason: the two licences can sit side by side in one game, but each
file keeps the licence of the pack it came from. The upstream credits file is
vendored verbatim at [`credits/CREDITS-floors.txt`](credits/CREDITS-floors.txt)
and is part of this notice.

## [LPC] Walls (CC-BY-SA 3.0)

Applies to the thirteen `tile-wall-*` tiles of the farmhouse interior. The
back wall is the cream plaster with dark timber framing (columns 60..62, rows
56 and 58 — the top and bottom rows of the three-row set, so the wall keeps its
header beam and its skirting in two tiles); the side and front walls are the
ceiling trim from the top-left of the sheet, one piece per edge and corner.

> "[LPC] Walls" by bluecarrot16, Lanea Zimmerman (Sharm), Daniel Armstrong
> (HughSpectrum), William Thompson (William.Thompsonj), Hyptosis, Zabin,
> Daniel Cook, Guido Bos, SpiderDave, Cougarmint, Stephen Challener
> (Redshrike), Matthew Nash, Wolthera van Hövell tot Westerflier (TheraHedwig),
> Reemax, bleutailfly, NaRNeRZz, Sir Spummington, Casper Nilsson,
> KnoblePersona. CC-BY-SA 3.0. https://opengameart.org/content/lpc-walls

The upstream credits file is vendored verbatim at
[`credits/CREDITS-walls.txt`](credits/CREDITS-walls.txt) and is part of this
notice.

## [LPC] Wooden Furniture (CC-BY-SA 4.0 / CC-BY-SA 3.0 / GPL 3.0)

Applies to `furniture-bed`, `furniture-stove` (the sink and the range, cut
as one run of counter), `furniture-table`, `furniture-chair-east`,
`furniture-chair-west` and `furniture-fireplace`, all from `blonde-wood.png`.
The same sheet ships in dark wood, which is kept in reserve for a house upgrade.

> "LPC Wooden Furniture" by bluecarrot16, Baŝto, Lanea Zimmerman (Sharm),
> William Thompson, Tuomo Untinen (Reemax), Janna/Lilius/Jannax.
> https://opengameart.org/content/lpc-wooden-furniture

The upstream credits file says "All information in this file must be
included", so it is vendored verbatim at
[`credits/CREDITS-furniture.txt`](credits/CREDITS-furniture.txt) and is part
of this notice.

## [LPC] Style Farm Animals (CC-BY 3.0 or GPL 2.0+)

Applies to: `animal-chicken-sheet.png`, `animal-cow-sheet.png` and
`animal-duck-sheet.png`.

> "LPC Style Farm Animals" by Daniel Eddeland (daneeklu), commissioned by
> Thomas Bruno (tebruno99). License: CC-BY 3.0 or GPL 2.0+.
> https://opengameart.org/content/lpc-style-farm-animals

Cut from `chicken_walk.png` and `cow_walk.png` with
`scripts/import-lpc.mjs --animals`, which takes the four walk rows and trims
the empty space off every frame at once. The source draws each animal in a box
big enough for the largest of them — 128px for the cow, of which it uses about
seventy — and the game measures a frame to decide where an animal's shadow and
its hunger marker go, so the padding had to come off before it became a
measurement.

**`animal-duck-sheet.png` is a recolour of the chicken, not a separate
drawing.** The set has one bird in it and this farm keeps two, so the duck is
the hen in a mallard's colours: brown body, dark green head, orange bill, done
as a colour map at import time rather than a tint at draw time so the bill
stays orange while the feathers turn brown. The silhouette is still a hen's.
Anyone who finds a real LPC duck should replace it — the import line is in the
repo's history and the recolour flag is `--recolour`.

## [LPC] Goat (CC-BY 3.0 or GPL 2.0+)

Applies to: `animal-goat-sheet.png`.

> "LPC Goat" by bluecarrot16. License: CC-BY 3.0 / GPL 2.0+.
> Based on "LPC Style Farm Animals" by Daniel Eddeland (daneeklu),
> commissioned by Thomas Bruno (tebruno99). License: CC-BY 3.0 / GPL 2+.
> https://opengameart.org/content/lpc-goat

The source sheet is eight rows — walk, then a grazing cycle. Only the four walk
rows are imported. It is drawn over the llama from the same set and therefore
stands taller than a goat does, which is why `ANIMAL_SCALE` in `FarmScene.ts`
draws it smaller than everything else from this set rather than at the 0.62 the
rest of the LPC art shares.

## CC0 (public domain, no attribution required — credited anyway)

- Ground decoration reference: **Kenney Tiny Farm** (CC0)
  https://kenney.nl/assets/tiny-farm

## Why every crop is now native 32px

The crops used to come from "Farming crops 16x16" by josehzz — good drawings,
but 16x16 art upscaled 2x, which put pixels twice the size of the ground
underneath them. One tile of the world was drawn at two different pixel sizes,
and that reads as cheap however well the turnip itself is drawn.

Everything in this folder is now checked to be native: no file is made of 2x2
blocks. That is the single rule holding the look together, and it is worth more
than any individual sprite being prettier.

## Generated placeholders (MIT, part of the repo's code)

Spec 04 grows thirteen crops, and ten of them now have a drawing. The other
three — clover, wheat, barley — are **procedurally generated placeholders**,
not artwork: each names a form (root, berry, fruit, gourd, grain, bloom, cap)
and three colours in `src/game/assets/itemIcons.ts`, and the rectangles are
drawn from those by `createPixelArtTextures.ts` for the field and by
`ItemIcon.tsx` for the satchel. The same is true of every seed packet.

`crop-seeded` is generated too. The LPC set has no "just sown" frame — its
earliest frame is already a sprout — and the nearest thing, a bare mound of
turned soil, sat on top of `plot-tilled` looking like a hole rather than a
planting. The generated specks are drawn at native 32px, so they cost nothing
in consistency.

Note that the field sprite and the satchel icon are separate decisions. Turnip
and strawberry have hand-placed `ITEM_ICONS` entries; the eight crops drawn
from LPC have the drawing in the field and a generated icon in the satchel,
which agree on colour but not on shape. Closing that is a hand-placed
`ITEM_ICONS` entry each.

They are honest placeholders and are meant to be replaced. Replacing one is:
drop a 32x32 `crop-<id>.png` in this folder, run `npm run lpc:manifest`, add a
hand-placed entry to `ITEM_ICONS` if you want the satchel icon to match, and
credit it above. The loader reads this folder rather than a list somebody
maintains, so the manifest step is what makes the file appear in the game.

Spec 06 adds three more sets on the same terms:

- **The tool ladder.** Twelve tool icons from three shapes and four metal
  palettes in `itemIcons.ts` — a copper hoe is the iron hoe recoloured,
  because a better hoe should still read as the hoe you know at a glance in a
  twelve-cell bar. Replacing one is a hand-placed `ITEM_ICONS` entry, which
  wins over the generated recolour.
- **The farm's buildings** (`building-shed/silo/coop/barn`, and the
  `building-scaffold` each one starts as): one drawing function and a table of
  four palettes in `createPixelArtTextures.ts`, stretched to whatever
  footprint `BUILDING_DEFS` gives the kind.
- **The blacksmith's forge** in the village, drawn the same way.

Spec 07 puts five people in the village, and their art is worth being precise
about because half of it is LPC and half of it is not:

- **The walk cycles are recoloured LPC.** Every villager borrows one of the two
  real walk sheets already in this folder — `player-sheet.png` or
  `rowan-sheet.png` — and is tinted at runtime from the `sheet` and `tint`
  fields of their definition in `src/game/npcs/villagers/`. A runtime tint is
  an adaptation, so **those sprites are CC-BY-SA 3.0 / GPL 3.0 on screen**,
  exactly like the sheets underneath them, and the credits above apply to them
  unchanged. The Universal LPC Spritesheet Character Generator is the proper
  way to make five genuinely distinct villagers and is the recommended
  replacement path; it is a browser app this repo cannot run for you, but
  `npm run lpc:import -- <export> <name>-sheet --walkcycle` takes what it gives
  you and cuts it to the shape the game reads. Tinting two real sheets was the
  honest alternative to inventing attribution for art nobody drew.
- **The standing sprites are generated placeholders** (MIT, part of the code):
  `npc-rowan/maeve/tobias/juniper/ash`, one drawing function and a table of
  five palettes in `createPixelArtTextures.ts`. These are what is drawn if the
  walk sheets have not loaded, on the same terms as the crops above.
- **The cottages and the gift heart** are generated the same way, from the
  same file.

Spec 09 adds the herd and spec 10 adds everything standing on the ground, both
on the same terms and from the same file:

- **The four animals** (`animal-chicken/duck/cow/goat`), the stock pen, and the
  marker over a hungry one: one drawing function and a table of four palettes.
  Side-on and facing right, with the scene mirroring the sprite rather than
  asking for a second drawing.
- **The resource nodes** (`node-tree-0` through `node-tree-4`, `node-stump`,
  `node-rock`, `node-boulder`, `node-weed`, `node-grass`, and one
  `node-forage-<item>` each): the trees and the boulders are rows of a squashed
  circle, the brambles and the grass are stacked leaf and stalk, and the forage
  borrows its own inventory icon's palette so the thing you picked up is the
  thing you saw in the grass.
- **Three new tool shapes** on the twelve-icon ladder above — axe, pickaxe and
  scythe — recoloured per tier exactly as the first three are.
- **Six material icons and twelve forage icons** in `itemIcons.ts`: the
  materials are hand-placed rectangles, the forage reuses the crop forms.

Replacing any of them is the same one move it has always been: a hand-drawn
PNG in this folder, `npm run lpc:manifest`, and a credit line above. A loaded
image wins over anything generated.

Replacing a villager properly is: export a sheet from the LPC character
generator, run

    npm run lpc:import -- <that file> <name>-sheet --walkcycle
    npm run lpc:manifest

then point that villager's `sheet` at `<name>-sheet`, set `tint` back to
`0xffffff`, and credit the layers you composed here. The `sheet` field is typed
from this folder, so the new name is valid the moment the manifest is
regenerated — and a name that is not here is a compile error rather than a
villager who silently stops walking.

## Adding art to this folder

Two commands, and both of them are about not getting the geometry wrong by
hand:

- **`npm run lpc:import -- <source.png> <target> [options]`** takes a region
  out of a downloaded sheet, scales it by a whole number, and writes it here
  under the name the loader expects. It knows the sizes the game requires — a
  32x32 world tile, a 576x256 walk cycle of nine 64px frames by four — and
  refuses a cut that is not one of them, which is the whole reason it exists.
  `--grid 16 --cell 3,0` takes one cell out of a 16x16 crop pack and doubles it
  to this farm's tile size; `--walkcycle` lifts the four walk rows out of a
  character-generator export. Run it with no arguments for the rest.
- **`npm run lpc:manifest`** regenerates `src/game/assets/lpc.generated.ts`
  from whatever is in this folder. Nothing scans a directory at runtime, so the
  game asks for exactly the files that are here — which is why eleven missing
  crops are a deliberate fallback rather than eleven load errors on every boot.

Where to look for art that fits: the LPC character generator at
<https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/>
for people, OpenGameArt's LPC terrain and tile atlas collections for ground,
and Kenney's CC0 packs for tools and props.

If you replace files in this folder with your own art, update this file
accordingly. Adaptations of the LPC files must remain under CC-BY-SA 3.0
(or GPL 3.0) — do not relicense them as MIT. The CC0 sources above need no
attribution, and are credited anyway.

## Modification notice

Every PNG in this folder has been colour-reduced to the 48-colour palette in
`art/palette.json`. No shape, frame or layout was altered — only the colour of
individual pixels, by nearest-neighbour matching in OkLab. The unmodified
originals are kept in `art/raw/lpc/` and are what the CC-BY-SA attributions
above describe. Rebuild this folder with `npm run palette:apply`.
