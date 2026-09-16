# Art credits — `public/assets/lpc/`

Game code in this repo stays under the repo's MIT license.
The artwork files in this folder are **not** MIT — each keeps its own license:

## Liberated Pixel Cup (CC-BY-SA 3.0 + GPL 3.0, dual-licensed)

Applies to: `tile-grass*.png`, `tile-path.png`, `tile-water.png`,
`plot-*.png`, `grass-tuft.png`, `tree.png`, `farmhouse.png`,
`player-sheet.png`
(sliced and composed from LPC sheets; adaptations stay under the same licenses)

- Terrain, trees, house parts: **Lanea Zimmerman (Sharm)**
  https://opengameart.org/user/1727
- Character walkcycle templates (male/female): **Stephen Challener (Redshrike)**,
  commissioned by William Thompson (William.Thompsonj)
  https://opengameart.org/user/47
- Clothes, hair, shoes layers composited into the walkcycles (Farmer outfit:
  Forest long-sleeve, Leather pants, Brown shoes, Bedhead hair): **Universal LPC
  Spritesheet contributors** via the character set vendored in the LPC repo
  (`sprite/character/`)
  https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator
- Source: https://github.com/OpenGameArt/LiberatedPixelCup
- Licenses: https://creativecommons.org/licenses/by-sa/3.0/
  and https://www.gnu.org/licenses/gpl-3.0.html

## [LPC] Crops (CC-BY-SA 3.0+ or GPL 3.0+)

Applies to: `crop-seeded.png`, `crop-sprout.png` and the ripe crops `crop-turnip`,
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

There is no stone in this pack, so `node-rock` and `node-boulder` come from
[LPC] Rocks below. `node-chip` keeps its generated art: it is a 6x6 particle
rather than an object.

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

## [LPC] Rocks (CC-BY-SA 4.0 / CC-BY-SA 3.0)

Applies to the resource nodes `node-rock` (a round stone, 30x27 at 257, 291)
and `node-boulder` (the big boulder with grass at its foot, 48x55 at 391, 388).
Both come from the second of the sheet's four colour bands, so they share a
stone and a light direction, and both are boxed into 64x80 with their feet on
the node floor line at y=74 like every other node. Exact rectangles are in
`art/sources.json`.

**Why the second band, and why each cut recolours one colour.** The sheet draws
the same rocks four times, in pale grey, dark grey, darker grey and sand. Put
through the 48-colour palette, the pale band's mauve-greys land on the soil
browns and come out as tan lumps, and the darkest band's shadows land on
`foliage.2` and turn green. The second band survives nearly whole, except for
one shadow colour in each drawing: `#3d3748` on the rock goes to the teal
`foliage.2` and `#3a313a` on the boulder to the brown `soil.1`. There is no
palette grey between `shadow.2` and `foliage.4`, so each cut maps its one
stray colour to `shadow.2` before quantising, and the stone keeps one hue from
top to bottom.

> "[LPC] Rocks" by **bluecarrot16, Johann Charlot, Yar, Hyptosis, Evert, Lanea
> Zimmerman (Sharm), Guillaume Lecollinet, Richard Kettering (Jetrel),
> Zachariah Husiar (Zabin), Redshrike, Rayane Félix (RayaneFLX), and Michele
> Bucelli (Buch)**.
> CC-BY-SA 4.0 / CC-BY-SA 3.0. https://opengameart.org/content/lpc-rocks

The author asks that everything in the pack's credits file be included, and it
names each upstream set and its licence (CC-BY-SA 3.0, CC-BY 3.0, CC-BY 4.0 and
CC0), so it is vendored verbatim at
[`credits/CREDITS-rocks.txt`](credits/CREDITS-rocks.txt) and is part of this
notice.

## [LPC] Farm (CC-BY 4.0)

Applies to all four of the farm's buildings — `building-silo` (the stone tower
with the slate cone, 64x160 at 0, 768, boxed into 96 wide so it stands centred
on its three tiles), `building-shed` (the slate-roofed granary on stone feet),
`building-barn` (the red gambrel barn) and `building-coop` (the slate-roofed
hen house with its ramp) — and to the village's `ranch-pen`, a run of the
pack's rail fence around its feed trough.

**The barn and the coop are rebuilt from the author's own preview.** In this
pack a barn is not a drawing but a set of 32px tiles meant to be assembled in
Tiled — gable corners, trim, door leaves, roof slopes — and guessing that
assembly by eye came out patchwork. `farm-preview.png` on the pack's page is
the author's assembly, at 1:1 and on the 32px grid, so each of its cells was
matched against every tile of `barn.png` (top layer first, then whatever is
visible underneath) and the matches became the cut's `pieces`. Where the
preview has something in front that is not in the sheet — a cow in the barn
door, hay bales along its foot, hens behind the coop's lattice — those cells
were finished by hand from the same tiles: the barn's door leaves are the
sheet's own 2x3 leaves, its open doorway is the inside of the sheet's open
shed, and the coop's upper lattice is the sheet's dark-backed version rather
than the see-through one. The barn is 256x352 and the coop 116 wide boxed
into 192; both are drawn at their own size, centred on their footprint.

The shed is the first cut in this folder laid out from **pieces** rather than
cut as one rectangle: a small stone pot from the next drawing in the sheet sits
inside the granary's bounding box, over the empty sky beside its roof ridge,
so the roof's top ten rows are taken from a rectangle that stops short of it
and the rest of the building from one that starts below it. `art/sources.json`
has both rectangles and where each is laid.

Both carry a `recolour`. The slate and the stone shade through `#3a313a` and
`#3d3748`, which the palette would send to a soil brown and to the teal
`foliage.2`, so both go to `shadow.2`; the silo's pale mortar `#b19998` would
go to tan and goes to `building.2` instead.

> "[LPC] Farm" by **bluecarrot16, Wolthera van Hövell tot Westerflier
> (TheraHedwig), and Ivan Voirol**. Commissioned by Rupil. CC-BY 4.0.
> https://opengameart.org/content/lpc-farm

It is built on Ivan Voirol's Slates set (CC-BY 4.0) and TheraHedwig's LPC
compatible Ancient Greek Architecture (CC-BY 4.0 / GPL 3.0 / OGA-BY 3.0). The
upstream credits file is vendored verbatim at
[`credits/CREDITS-farm.txt`](credits/CREDITS-farm.txt) and is part of this
notice.

## [LPC] Thatched-roof Cottage (CC-BY-SA 3.0 / GPL 3.0+)

Applies to the three village houses, `cottage`, `cottage-brown` and
`cottage-stone`, each 128x190 on a four-by-three footprint. Each is laid out
from pieces: the pack's hip roof (120x97, the yellow one at 88, 8 or the brown
one at 88, 232) over a timber wall made of two overlapping halves of one
three-tile panel — cream plaster, yellow plaster or stone infill — so the wall
is 112 wide and the roof overhangs it by four pixels a side.

The yellow thatch and the yellow plaster would quantise to the olive
`gold.0`, so each cut maps its one yellow to `light.5` first.

> "[LPC] Thatched-roof Cottage" by **bluecarrot16**, based on "LPC Base
> Assets" by Lanea Zimmerman (Sharm) and Daniel Armstrong (HughSpectrum) and
> "LPC art entry" by Casper Nilsson. CC-BY-SA 3.0 / GPL 3.0+.
> https://opengameart.org/content/lpc-thatched-roof-cottage

## [LPC] Windows & Doors (CC-BY-SA 3.0 / GPL 3.0+)

The cottages' doors, windows and window boxes. The pack's own preview is what
the thatched cottage pack was drawn against.

> "LPC Windows & Doors" by **bluecarrot16, Lanea Zimmerman (Sharm) and Daniel
> Armstrong (HughSpectrum), Casper Nilsson, Anamaris, Krusmira, Keith Karnage,
> Guido Bos, and Talosaurus**. CC-BY-SA 3.0 / GPL 3.0+.
> https://opengameart.org/content/lpc-windows-doors

The upstream credits file, which names each set it draws on and its licence,
is vendored verbatim at
[`credits/CREDITS-windows-doors.txt`](credits/CREDITS-windows-doors.txt) and
is part of this notice.

## [LPC] Blacksmith (OGA-BY 3.0 / CC-BY 3.0+ / GPL 2.0+)

The village forge, `blacksmith`, 128x124 on a four-by-two footprint: the pack's
lit brick smelter with its chimney, one of its anvils in front, and the open
timber shelter from [LPC] Medieval Village Decorations beside it.

> "[LPC] Blacksmith Workshop" by **bluecarrot16**. OGA-BY 3.0, CC-BY 3.0+,
> GPL 2.0+. https://opengameart.org/content/lpc-blacksmith

Vendored at [`credits/CREDITS-blacksmith.txt`](credits/CREDITS-blacksmith.txt).

## [LPC] Medieval Village Decorations (CC-BY-SA 4.0 / CC-BY-SA 3.0)

Applies to two things in the village, and one piece of a third (the timber
shelter beside the forge in `blacksmith`): `well` (the stone well under a timber
winch frame, 64x96 at 448, 416) and `market-stall` (the two-tile stall with the
striped awning, 64x158 at 192, 800, boxed into 96 wide to stand centred on the
market's three tiles). `market-stall` replaces the generated `market-ribbon`
SVG, which is still loaded under the stall's key if the PNG is ever missing.

The awning is drawn in white and orange, and the palette has neither a pure
white nor an orange that is not a brick red, so the stall's `recolour` moves
its oranges to the soil browns before quantising. It comes out cream and brown
rather than pink and red.

> "[LPC] Medieval Village Decorations" by **bluecarrot16, Lanea Zimmerman
> (Sharm), Reemax (Tuomo Untinen), Xenodora, Johann C, Johannes Sjölund, Casper
> Nilsson, Daniel Cook, Rayane Félix (RayaneFLX), Wolthera van Hövell tot
> Westerflier (TheraHedwig), Hyptosis, mold, Zachariah Husiar (Zabin), Clint
> Bellanger, Jetrel, Nemisys, Guido Bos, Curt, Bertram, and Daniel Eddeland
> (daneeklu)**. CC-BY-SA 4.0 / CC-BY-SA 3.0.
> https://opengameart.org/content/lpc-medieval-village-decorations

The author asks that everything in the pack's credits file be included — it
names each upstream set and its licence, among them "LPC Style Well" by
Xenodora and Sharm — so it is vendored verbatim at
[`credits/CREDITS-decorations-medieval.txt`](credits/CREDITS-decorations-medieval.txt)
and is part of this notice.

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

## Universal LPC Spritesheet Character Generator (per layer — see below)

Applies to the six villager walk sheets: `rowan-sheet`, `maeve-sheet`,
`tobias-sheet`, `juniper-sheet`, `ash-sheet` and `bram-sheet`.

Each is stacked from the generator's own layers — a body, a head, hair,
clothes — taken at commit `553ba75` of
<https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator>
and recorded layer by layer, with the colour swaps each one gets, in
`art/sources.json`. The generator ships every item in one base palette and
recolours it in the browser; the same swaps are applied here from its
`palette_definitions`, so a skin, a shirt and a head of hair can be three
different colours without anyone repainting them. `--dropstand` then removes
the standing pose each row opens with, so the stride sits in the eight columns
the game plays.

The licences differ by item and every item is credited below, as the generator
credits it. Where an item offers several licences, it is used under the most
permissive one listed (OGA-BY or CC-BY where offered); items offered only
under CC-BY-SA 3.0 / GPL 3.0 keep those terms, and so do the sheets built
from them.

- `beards/beard/basic` — JaidynReiman, Carlo Enrico Victoria (Nemisys). CC-BY-SA 3.0 / GPL 3.0.
  Original by Nemisys, repositioning by JaidynReiman.
  <https://opengameart.org/content/lpc-white-beard>
- `beards/mustache/basic` — JaidynReiman, Carlo Enrico Victoria (Nemisys). CC-BY-SA 3.0 / GPL 3.0.
  Original by Nemisys, repositioning by JaidynReiman.
  <https://opengameart.org/content/lpc-brunet-mustache>
- `beards/mustache/bigstache` — JaidynReiman, Thane Brimhall (pennomi), laetissima. CC-BY-SA 3.0 / GPL 3.0.
  Original by Pennomi, repositioning by JaidynReiman.
  <https://opengameart.org/content/lpc-base-character-expressions>
- `body/bodies/child` — bluecarrot16, Benjamin K. Smith (BenCreating), ElizaWy, MuffinElZangano, Durrani, Nila122, kheftel, Stephen Challener (Redshrike). OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-child-standing-template>
  <https://opengameart.org/content/lpc-children-walk-animation>
  <https://opengameart.org/content/lpc-male-jumping-animation-by-durrani>
  <https://opengameart.org/content/lpc-jump-expanded>
- `body/bodies/female` — Benjamin K. Smith (BenCreating), bluecarrot16, TheraHedwig, Evert, MuffinElZangano, Durrani, Pierre Vigier (pvigier), ElizaWy, Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike). OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  see details at https://opengameart.org/content/lpc-character-bases
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-medieval-fantasy-character-sprites>
  <https://opengameart.org/content/lpc-ladies>
  <https://opengameart.org/content/lpc-7-womens-shirts>
  <https://opengameart.org/content/lpc-jump-expanded>
  <https://opengameart.org/content/lpc-be-seated>
  <https://opengameart.org/content/lpc-revised-character-basics>
  <https://gitlab.com/vagabondgame/lpc-characters>
  <https://opengameart.org/content/lpc-male-jumping-animation-by-durrani>
  <https://opengameart.org/content/lpc-runcycle-and-diagonal-walkcycle>
- `body/bodies/male` — bluecarrot16, JaidynReiman, Benjamin K. Smith (BenCreating), Evert, Eliza Wyatt (ElizaWy), TheraHedwig, MuffinElZangano, Durrani, Johannes Sjölund (wulax), Stephen Challener (Redshrike). OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  see details at https://opengameart.org/content/lpc-character-bases; 'Thick' Male Revised Run/Climb by JaidynReiman (based on ElizaWy's LPC Revised)
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-medieval-fantasy-character-sprites>
  <https://opengameart.org/content/lpc-male-jumping-animation-by-durrani>
  <https://opengameart.org/content/lpc-runcycle-and-diagonal-walkcycle>
  <https://opengameart.org/content/lpc-revised-character-basics>
  <https://opengameart.org/content/lpc-be-seated>
  <https://opengameart.org/content/lpc-runcycle-for-male-muscular-and-pregnant-character-bases-with-modular-heads>
  <https://opengameart.org/content/lpc-jump-expanded>
  <https://opengameart.org/content/lpc-character-bases>
- `eyes/eyebrows/thick` — ElizaWy. OGA-BY 3.0.
  <https://github.com/ElizaWy/LPC/tree/main/Characters/Hair>
  <https://opengameart.org/content/lpc-expanded-sit-run-jump-more>
- `eyes/eyebrows/thin` — ElizaWy. OGA-BY 3.0.
  <https://github.com/ElizaWy/LPC/tree/main/Characters/Hair>
  <https://opengameart.org/content/lpc-expanded-sit-run-jump-more>
- `feet/boots/basic` — JaidynReiman, bluecarrot16, Nila122. OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 2.0 / GPL 3.0.
  original by Nila122, edited for male and v3 bases by bluecarrot16, Jump/Sit/Emote/Run/Revised Combat by JaidynReiman
  <https://opengameart.org/content/lpc-clothes-and-hair>
  <https://opengameart.org/content/lpc-expanded-socks-shoes>
- `feet/boots/basic/thin` — JaidynReiman, bluecarrot16, Nila122. OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 2.0 / GPL 3.0.
  original by Nila122, edited for v3 bases by bluecarrot16, Jump/Sit/Emote/Run/Revised Combat by JaidynReiman
  <https://opengameart.org/content/lpc-clothes-and-hair>
  <https://opengameart.org/content/lpc-expanded-socks-shoes>
- `feet/shoes` — JaidynReiman, bluecarrot16, Johannes Sjölund (wulax). OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  original by wulax, edited for v3 base by bluecarrot16, Jump/Sit/Emote/Run/Revised Combat by JaidynReiman
  <https://opengameart.org/content/lpc-medieval-fantasy-character-sprites>
  <http://opengameart.org/content/lpc-clothing-updates>
  <https://opengameart.org/content/lpc-expanded-socks-shoes>
- `hair/braid` — Nila122, ElizaWy. OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 / GPL 2.0.
  <https://opengameart.org/content/3-hairs-for-lpc>
  <https://opengameart.org/content/lpc-hair>
- `hair/halfmessy` — Nila122, bluecarrot16. OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 / GPL 2.0.
  <https://opengameart.org/content/more-lpc-clothes-and-hair>
  <https://opengameart.org/content/lpc-hair>
- `hair/parted` — JaidynReiman, Joe White, Manuel Riecke (MrBeast). CC-BY-SA 3.0 / GPL 3.0.
  down 4 and 5 added by JaidynReiman; recolors by Joe White; original by Manuel Riecke (MrBeast)
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://github.com/jrconway3/Universal-LPC-spritesheet/commit/46ddcf05a0e43e7aa6ffd47d350eef0eb529ac24>
  <https://opengameart.org/content/lpc-expanded-hair>
- `hair/plain` — JaidynReiman, Manuel Riecke (MrBeast), Joe White. OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/ponytail-and-plain-hairstyles>
  <https://opengameart.org/content/lpc-expanded-hair>
- `hair/ponytail` — JaidynReiman, Manuel Riecke (MrBeast). CC-BY-SA 3.0 / GPL 3.0.
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-expanded-hair>
- `hair/swoop_side` — JaidynReiman. OGA-BY 3.0+ / CC-BY 3.0+ / CC-BY-SA 3.0 / GPL 3.0.
  <https://opengameart.org/content/lpc-1-hairstyle-2-hair-extensions-3-previously-unofficially-released-hairstyles>
  <https://github.com/jrconway3/Universal-LPC-spritesheet/commit/46ddcf05a0e43e7aa6ffd47d350eef0eb529ac24>
- `hat/cloth/bandana` — Matthew Krohn (makrohn), JaidynReiman, Marcel van de Steeg (MadMarcel), JaidynReiman. OGA-BY 3.0 / CC-BY-SA 3.0.
  <https://opengameart.org/content/lpc-female-orcogregoblintroll-base-walkcycle>
  <https://github.com/makrohn/Universal-LPC-spritesheet/commit/f50007cb47c235d8896cafae7a613f0b6a9a09a8?short_path=02b86d4#diff-02b86d45789a3e3e8e79519c7d17d15c9e6ecc9b4ddecb1bcd8dfbbaef430b75>
  <https://opengameart.org/content/lpc-expanded-hats-facial-helmets>
- `head/heads/human/child` — Stephen Challener (Redshrike), kheftel, bluecarrot16. OGA-BY 3.0 / CC-BY 3.0 / GPL 3.0.
  <https://opengameart.org/content/>
  <https://opengameart.org/content/lpc-child-standing-template>
  <https://opengameart.org/content/lpc-character-bases>
- `head/heads/human/female` — bluecarrot16, Benjamin K. Smith (BenCreating), Stephen Challener (Redshrike). OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  original head by Redshrike, tweaks by BenCreating, modular version by bluecarrot16
  <https://opengameart.org/content/>
  <https://opengameart.org/content/lpc-character-bases>
- `head/heads/human/male` — bluecarrot16, Benjamin K. Smith (BenCreating), Stephen Challener (Redshrike). OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  original head by Redshrike, tweaks by BenCreating, modular version by bluecarrot16
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-character-bases>
- `head/heads/human/male_elderly` — Benjamin K. Smith (BenCreating), Eliza Wyatt (ElizaWy), Stephen Challener (Redshrike). OGA-BY 3.0 / CC-BY 3.0.
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-revised-elders>
  <https://opengameart.org/content/lpc-character-bases>
- `head/heads/human/male_plump` — Stephen Challener (Redshrike), ??. CC-BY-SA 3.0 / GPL 3.0.
  original head by Redshrike, plump version by ??
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-folk>
- `legs/pants/child` — Nila122. OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  <https://opengameart.org/content/lpc-clothes-for-children>
- `legs/pants/male` — bluecarrot16, JaidynReiman, ElizaWy, Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike). OGA-BY 3.0 / GPL 3.0 / CC-BY-SA 3.0.
  original male pants by wulax, recolors and edits to v3 base by bluecarrot16, climb/jump/run/sit/emotes/revised combat by JaidynReiman based on ElizaWy's LPC Revised
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-medieval-fantasy-character-sprites>
  <https://opengameart.org/content/lpc-expanded-pants>
- `legs/pants/thin` — bluecarrot16, JaidynReiman, ElizaWy, Joe White, Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike). OGA-BY 3.0 / GPL 3.0 / CC-BY-SA 3.0.
  original male pants by wulax, edited for female by Joe White, recolors and edits to v3 base by bluecarrot16, teen legs by ElizaWy derived from base, climb/jump/run/sit/emotes/revised combat by JaidynReiman based on ElizaWy's LPC Revised
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-medieval-fantasy-character-sprites>
  <http://opengameart.org/content/lpc-clothing-updates>
  <https://opengameart.org/content/lpc-expanded-pants>
- `torso/aprons/overalls` — ElizaWy, bluecarrot16, JaidynReiman. OGA-BY 3.0 / GPL 3.0.
  original overalls by ElizaWy, extended to all animation frames, adapted from teen to male base, and edited for v3 bases by bluecarrot16; extended to combat animations by JaidynReiman
  <https://opengameart.org/content/lpc-revised-character-basics>
  <http://opengameart.org/content/lpc-clothing-updates>
- `torso/aprons/suspenders` — ElizaWy, JaidynReiman. OGA-BY 3.0.
  original by ElizaWy; spellcast/thrust/shoot/hurt/combat adapted from original by JaidynReiman
  <https://github.com/ElizaWy/LPC/tree/main/Characters/Clothing>
  <https://opengameart.org/content/lpc-expanded-sit-run-jump-more>
- `torso/clothes/longsleeve/longsleeve/female` — bluecarrot16, ElizaWy, JaidynReiman, Stephen Challener (Redshrike). OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  original by ElizaWy, edited to v3 bases by bluecarrot16; cleanup and climb/jump/run/sit/emote/revised combat adapted from LPC Revised by JaidynReiman
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-7-womens-shirts>
  <http://opengameart.org/content/lpc-clothing-updates>
  <https://opengameart.org/content/lpc-revised-character-basics>
  <https://github.com/ElizaWy/LPC/tree/main/Characters/Clothing>
  <https://opengameart.org/content/lpc-expanded-sit-run-jump-more>
  <https://opengameart.org/content/lpc-expanded-simple-shirts>
- `torso/clothes/longsleeve/longsleeve/male` — JaidynReiman, Johannes Sjölund (wulax). OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  original by wulax; tweaks and further recolors by bluecarrot16; cleanup and climb/jump/run/sit/emote/revised combat adapted from LPC Revised by JaidynReiman
  <https://opengameart.org/content/lpc-medieval-fantasy-character-sprites>
  <http://opengameart.org/content/lpc-clothing-updates>
  <https://opengameart.org/content/lpc-revised-character-basics>
  <https://github.com/ElizaWy/LPC/tree/main/Characters/Clothing>
  <https://opengameart.org/content/lpc-expanded-sit-run-jump-more>
  <https://opengameart.org/content/lpc-expanded-simple-shirts>
- `torso/clothes/shirt/child` — Nila122. OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  <https://opengameart.org/content/lpc-clothes-for-children>
- `torso/clothes/shortsleeve/shortsleeve/female` — bluecarrot16, ElizaWy, JaidynReiman, Stephen Challener (Redshrike). OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0.
  original by ElizaWy walkcycle only; extended to all animations by adapting from longsleeve, edited to v3 bases by bluecarrot16; cleanup and climb/jump/run/sit/emote/revised combat adapted from LPC Revised by JaidynReiman
  <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  <https://opengameart.org/content/lpc-7-womens-shirts>
  <http://opengameart.org/content/lpc-revised-character-basics>
  <http://opengameart.org/content/lpc-clothing-updates>
  <https://github.com/ElizaWy/LPC/tree/main/Characters/Clothing>
  <https://opengameart.org/content/lpc-expanded-sit-run-jump-more>
  <https://opengameart.org/content/lpc-expanded-simple-shirts>
- `torso/clothes/vest` — bluecarrot16, Thane Brimhall (pennomi), laetissima, Stephen Challener (Redshrike), Johannes Sjölund (wulax). CC-BY-SA 3.0 / GPL 3.0.
  <https://opengameart.org/content/lpc-2-characters>
  <https://opengameart.org/content/lpc-gentleman>
  <https://opengameart.org/content/lpc-pirates>

## 64x64 Portrait (OGA-BY 3.0 / CC-BY-SA 3.0)

Applies to: `portrait-rowan`, `portrait-maeve`, `portrait-tobias`,
`portrait-juniper`, `portrait-ash` and `portrait-bram` — the faces in the
dialogue box.

> "64x64 Portrait" by **Nila122**. OGA-BY 3.0 / CC-BY-SA 3.0.
> https://opengameart.org/content/64x64-portrait

The pack is a kit of 64x64 layers — a head, then a nose, a mouth, brows, hair,
facial hair and headwear drawn to stack over it. Each villager is one stack,
recorded layer by layer in `art/sources.json`, and each file is four of those
side by side: **neutral, happy, sad, angry**. The expressions are the kit's own
parts: the smiling mouth, the sad eyes, and the three brow shapes.

Picked under OGA-BY 3.0, which asks for attribution and nothing else. The skin
tones and hair colours were chosen for how they survive `palette:apply`, not
for how they look in the kit: two of its seven skins land on the same shade of
the game palette and a third lands on green.

## [LPC] Monsters (CC-BY-SA 3.0 / GPL 3.0)

- Source: <https://opengameart.org/content/lpc-monsters>
- By Charles Sanchez (CharlesGabriel), bagzie and bluecarrot16. The bat is
  bagzie's; the rest build on CharlesGabriel's Liberated Pixel Cup monsters,
  with attack animations by bluecarrot16.
- Licence: CC-BY-SA 3.0 or GPL 3.0, at your choice.

Used for the mine's monsters: `monster-slime-*` and `monster-blue-slime-*`
(the green slime, and the same slime recoloured to the water ramp), `monster-bat-*`,
`monster-ghost-*` and `monster-worm-*` (the big worm, standing in for the rock
bug). Each sheet is eight columns picked out of the original's direction rows,
so frames repeat where the original has fewer than eight; nothing is redrawn.

## Emberfield art (supplied by the project owner — not CC0, not LPC)

Supplied by the Moonberry project owner as `emberfield-art.zip`, who confirmed
on 2026-09-17 that this project may use all of it. It is **not** under this
repository's MIT licence and **not** under CC-BY-SA: do not reuse, relicense or
redistribute it outside Moonberry without asking the owner.

A note for whoever audits this: the tileset files in that archive carry the
names of Cainos' "Pixel Art Top Down – Basic" pack on itch.io (`TX Tileset
Stone Ground.png`, `TX Tileset Wall.png`, `TX Struct.png`, `TX Props.png`).
The owner confirmed the rights; the names are recorded here so the provenance
question can be answered later without guessing.

The archive is not downloadable, so `art/sources.json` pins every file by
sha256 and expects it in `art/sources/emberfield/` (not committed). What this
game takes from it:

- `mine-floor-*`, `mine-wall-*` — a studded stone slab and a brick course, one
  look per depth band (copper browns, the original grey, deep violets).
- `mine-entrance` — the stone arch, with a slab of stone floor behind it.
- `monster-skeleton-walk-sheet`, `-attack-sheet`, `-death-sheet` — the hammer
  skeleton, eight frames per direction.
- `player-sheet`, `attack-player-sheet` — the red-cloaked swordsman's run and
  sword swing.
- `item-*` — the sword, torch, chests, wood, stone, coal, fibre, sap, bait, eel,
  strawberry, tomato, gem, quartz, the three ores and the copper bar (ores and
  bar recoloured from one drawing each).
- `market-stall` — the merchant cart. `icon-coin` — the coin.
- `item-basket`, `item-copper-basket`, `item-steel-basket`, `item-gold-basket` —
  the wicker basket; the higher rungs take their tier's metal across the weave.
- `item-*-seeds` — the twelve coloured seed piles, one per crop; cranberry,
  pumpkin and đậu xanh are recoloured from the red, yellow and green piles.

Not used, and why: the two fonts have no Vietnamese tone marks; the blacksmith
sheet and the fire frames are painted at high resolution on an opaque
background rather than drawn on a pixel grid; the shop UI frames, the merchant,
the shadows, the soldier's and skeleton's idle strips, the skeleton's diagonal
directions, and the plants, grass and remaining props have nothing in this game
they fit without rescaling.

## Farm Tool Icon 24x24 (CC-BY-SA 4.0)

- **Farm Tool Icon 24x24** by Sandesu (vayasandesu), CC-BY-SA 4.0
  https://vayasandesu.itch.io/farm-tool-icon-24x24

The free `Spritesheet.png` from that page is committed, unmodified, at
`art/vendor/sandesu-farm-tools/farm-tools.png`, which CC-BY-SA 4.0 allows with
this attribution. It is the one pack kept in the repo rather than downloaded:
itch.io serves it through an expiring signed link a script cannot follow, so
`npm run art:sync` copies it into the cache from there (the table's `vendored`
field) and checks it against the same sha256 pin. Each icon is
trimmed to its drawing, scaled 1.4x through Scale3x (`"smooth": 1.4`) so it
fills a 32px slot like the rest of the satchel, and centred in a 32px box. Its
pixels are therefore not 1:1 with the source. What this game takes from it:

- `item-hoe`, `item-watering-can`, `item-axe`, `item-pickaxe` and their
  `copper-`, `steel-` and `gold-` rungs — the sheet's iron, copper, silver and
  gold columns, in that order.
- `item-scythe`, `item-gold-scythe` — the iron and gold scythes.
- `item-fishing-rod` — the rod without a float; `item-copper-fishing-rod`,
  `-steel-` and `-gold-` — the rod with its float, the reel recoloured to the
  tier's metal.

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

`crop-seeded` is the pack's own mound of turned soil — row 9, the plant after
harvest — at band 1 column 10. The set has no dedicated "just sown" frame, and
this was once passed over as reading like a hole. It was replaced by
generated specks, which on brown soil read as pale pebbles; a freshly dug
planting hole is the more honest picture of a sown bed, and it is real art.
The generated drawing stays behind only as the fallback.

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
- **The building site** (`building-scaffold`, what every farm building is
  while it goes up): one drawing function in `createPixelArtTextures.ts`. The
  four buildings themselves have drawings now — see [LPC] Farm above — and
  the generated versions are only what is drawn if those PNGs are missing.
- **The blacksmith's forge** in the village was drawn the same way, and so
  were the well and the market ribbon. All three have drawings now; see
  [LPC] Blacksmith and [LPC] Medieval Village Decorations above.

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
- **The gift heart** is generated the same way, from the same file. The
  cottages were too, and are drawn now — see [LPC] Thatched-roof Cottage above.

Spec 09 adds the herd and spec 10 adds everything standing on the ground, both
on the same terms and from the same file:

- **The four animals** (`animal-chicken/duck/cow/goat`) and the marker over a
  hungry one (the stock pen has a drawing now, from [LPC] Farm): one drawing function and a table of four palettes.
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
