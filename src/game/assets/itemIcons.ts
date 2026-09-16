import {
  ANIMAL_PRODUCE_IDS,
  ARTISAN_INPUTS,
  ARTISAN_MACHINES,
  artisanOutputFor,
  CROP_ORDER,
  FISH_DEFS,
  FORAGE_DEFS,
  PRODUCE_GRADES,
  TOOL_ROWS,
  gradedIdFor,
  seedIdFor,
  type CropId,
  type ItemId,
  type ProduceGrade,
  type ToolTier,
} from '../systems/items';
import { PALETTE } from './palette.generated';

/**
 * Item icons as data: one row per rectangle on a 16x16 grid.
 *
 * Written this way because two very different renderers need the same picture.
 * The hotbar is Phaser, which fills rectangles onto a canvas texture; the
 * inventory grid is React, which emits `<rect>` into an SVG. Drawing each icon
 * twice would let them drift, and a turnip that is two different turnips
 * depending on which panel you are looking at is a bug nobody thinks to file.
 */
export type IconRect = readonly [color: string, x: number, y: number, w: number, h: number];

/** The grid every icon is drawn on. */
export const ICON_SIZE = 16;

/**
 * The metal a tool is made of, which is the whole of what a tier looks like.
 *
 * Three shades rather than one so the icons keep the shading the hand-drawn
 * originals had: a flat recolour reads as a palette swap, which is exactly
 * what it would be.
 */
interface MetalPalette {
  dark: string;
  mid: string;
  light: string;
}

const TOOL_METALS: Record<ToolTier, MetalPalette> = {
  // The iron the farm came with. These are the originals' own colours, so a
  // basic hoe is pixel for pixel the hoe that has always been in slot one.
  basic: { dark: PALETTE['building.2'], mid: PALETTE['light.6'], light: PALETTE['light.7'] },
  copper: { dark: PALETTE['clothWarm.3'], mid: PALETTE['light.3'], light: PALETTE['light.5'] },
  // Bluer and colder than the iron above, or the two would be the same icon.
  steel: { dark: PALETTE['foliage.4'], mid: PALETTE['water.3'], light: PALETTE['light.7'] },
  gold: { dark: PALETTE['soil.5'], mid: PALETTE['light.5'], light: PALETTE['light.7'] },
};

function hoeIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    // Handle, corner to corner, with the blade turned out at the top.
    [PALETTE['soil.4'], 3, 11, 2, 4],
    [PALETTE['soil.6'], 4, 9, 2, 3],
    [PALETTE['soil.6'], 5, 7, 2, 3],
    [PALETTE['light.2'], 6, 5, 2, 3],
    [PALETTE['light.2'], 7, 3, 2, 3],
    [metal.dark, 9, 4, 5, 2],
    [metal.mid, 9, 2, 5, 2],
    [metal.light, 10, 2, 2, 1],
  ];
}

function canIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    [metal.dark, 5, 3, 5, 2],
    [metal.dark, 4, 4, 2, 2],
    [metal.mid, 3, 6, 8, 8],
    [metal.light, 4, 7, 6, 4],
    [PALETTE['light.7'], 4, 7, 6, 1],
    [metal.mid, 11, 8, 3, 2],
    [metal.dark, 13, 5, 2, 4],
  ];
}

/** Wicker, so only the rim, the bands and the handle take the metal. */
function basketIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    [metal.dark, 4, 3, 8, 2],
    [PALETTE['soil.0'], 5, 3, 1, 2],
    [PALETTE['soil.0'], 10, 3, 1, 2],
    [PALETTE['soil.6'], 2, 6, 12, 8],
    [PALETTE['light.5'], 3, 7, 10, 1],
    [metal.mid, 2, 9, 12, 1],
    [metal.dark, 5, 6, 1, 8],
    [metal.dark, 10, 6, 1, 8],
  ];
}

/** A wedge of blade on a short haft, angled so it reads at 16px. */
function axeIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    [PALETTE['soil.4'], 6, 6, 2, 9],
    [PALETTE['soil.6'], 7, 4, 2, 3],
    [PALETTE['light.2'], 7, 13, 2, 2],
    // The head: a broad bit flaring away from the handle, with the edge
    // catching the light along its outer curve.
    [metal.dark, 8, 2, 5, 7],
    [metal.mid, 9, 3, 4, 5],
    [metal.light, 11, 3, 2, 4],
    [metal.dark, 6, 2, 3, 3],
  ];
}

/** Two points and a haft. The silhouette nobody mistakes for anything else. */
function pickaxeIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    [PALETTE['soil.4'], 7, 5, 2, 10],
    [PALETTE['soil.6'], 7, 13, 2, 2],
    [metal.dark, 2, 3, 12, 2],
    [metal.mid, 3, 2, 10, 2],
    [metal.light, 5, 2, 6, 1],
    // The two tips, turned down, which is what makes it a pick and not a hammer.
    [metal.dark, 1, 4, 2, 2],
    [metal.dark, 13, 4, 2, 2],
  ];
}

/** A long curved blade below a slanted handle: nothing else in the bar leans. */
function scytheIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    [PALETTE['soil.4'], 10, 2, 2, 5],
    [PALETTE['soil.6'], 9, 7, 2, 4],
    [PALETTE['light.2'], 8, 11, 2, 4],
    // The blade, stepped into a curve, because the grid only draws rectangles.
    [metal.dark, 3, 5, 6, 2],
    [metal.dark, 2, 7, 3, 2],
    [metal.dark, 1, 9, 2, 3],
    [metal.mid, 3, 4, 6, 1],
    [metal.mid, 2, 6, 2, 1],
    [metal.light, 4, 4, 4, 1],
  ];
}

/**
 * The rod: a pole corner to corner with a line falling off the tip.
 *
 * The one tool whose metal is not the working end — a rod is wood and string,
 * and the tier is in the reel and the guides. That is little enough to read
 * at sixteen pixels, so the line and the float take the tier's colour too.
 * Without that a golden rod and a plain one are the same icon.
 */
function rodIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    // The pole, thickening towards the butt.
    [PALETTE['soil.4'], 2, 12, 3, 2],
    [PALETTE['soil.6'], 4, 10, 3, 2],
    [PALETTE['light.2'], 6, 8, 3, 2],
    [PALETTE['light.2'], 8, 6, 2, 2],
    [PALETTE['light.2'], 10, 4, 2, 2],
    [PALETTE['light.5'], 12, 2, 2, 2],
    // The reel, which is the one place the metal shows at size.
    [metal.dark, 4, 12, 3, 3],
    [metal.mid, 5, 13, 2, 1],
    // The line off the tip, and the float on the end of it.
    [metal.light, 14, 3, 1, 6],
    [metal.mid, 13, 9, 3, 1],
    [PALETTE['building.3'], 13, 10, 3, 2],
  ];
}

const TOOL_SHAPES: Record<string, (metal: MetalPalette) => readonly IconRect[]> = {
  hoe: hoeIcon,
  'watering-can': canIcon,
  basket: basketIcon,
  axe: axeIcon,
  pickaxe: pickaxeIcon,
  scythe: scytheIcon,
  'fishing-rod': rodIcon,
};

export const ITEM_ICONS: Record<ItemId, readonly IconRect[]> = {
  // The three dishes of spec 15. Placeholders on the same footing as every
  // generated icon here, until somebody draws them by hand: see the table at
  // the end of `docs/specs/15-vietnamese-street.md` for the tool and the
  // import command, and a PNG under that name wins over these rectangles.
  //
  // Bánh chưng: a square parcel of lá dong, tied twice with lạt.
  'banh-chung': [
    [PALETTE['leaf.0'], 2, 3, 12, 11],
    [PALETTE['leaf.1'], 3, 4, 10, 9],
    [PALETTE['leaf.2'], 4, 5, 3, 2],
    [PALETTE['light.2'], 7, 3, 2, 11],
    [PALETTE['light.2'], 2, 8, 12, 2],
    [PALETTE['foliage.0'], 2, 13, 12, 1],
  ],
  // Xôi đậu: a white mound flecked with yellow beans, on a leaf.
  'xoi-dau': [
    [PALETTE['leaf.1'], 2, 10, 12, 3],
    [PALETTE['leaf.0'], 3, 13, 10, 1],
    [PALETTE['light.7'], 5, 4, 6, 1],
    [PALETTE['light.7'], 3, 5, 10, 5],
    [PALETTE['light.6'], 3, 9, 10, 1],
    [PALETTE['light.5'], 5, 6, 2, 1],
    [PALETTE['light.5'], 9, 7, 2, 1],
    [PALETTE['light.5'], 6, 8, 2, 1],
  ],
  // Chè đậu: a glass of bean paste with a strawberry on top.
  'che-dau': [
    [PALETTE['light.6'], 4, 3, 8, 11],
    [PALETTE['light.7'], 4, 3, 8, 1],
    [PALETTE['gold.0'], 5, 8, 6, 5],
    [PALETTE['building.3'], 6, 5, 4, 3],
    [PALETTE['clothWarm.2'], 8, 6, 2, 2],
    [PALETTE['building.2'], 5, 14, 6, 1],
  ],
  turnip: [
    [PALETTE['leaf.2'], 6, 1, 2, 3],
    [PALETTE['light.0'], 8, 2, 3, 2],
    [PALETTE['light.0'], 4, 2, 2, 2],
    [PALETTE['building.2'], 4, 5, 8, 3],
    [PALETTE['light.7'], 4, 8, 8, 5],
    [PALETTE['light.7'], 5, 9, 3, 2],
    [PALETTE['light.6'], 5, 13, 6, 1],
  ],
  strawberry: [
    [PALETTE['light.0'], 7, 1, 2, 2],
    [PALETTE['leaf.2'], 5, 2, 6, 2],
    [PALETTE['building.1'], 4, 4, 8, 5],
    [PALETTE['building.3'], 5, 4, 5, 3],
    [PALETTE['building.1'], 5, 9, 6, 3],
    [PALETTE['clothWarm.2'], 6, 12, 4, 1],
    [PALETTE['light.7'], 6, 6, 1, 1],
    [PALETTE['light.7'], 9, 8, 1, 1],
    [PALETTE['light.7'], 7, 10, 1, 1],
  ],
  wood: [
    [PALETTE['soil.4'], 2, 4, 12, 4],
    [PALETTE['soil.6'], 2, 4, 12, 2],
    [PALETTE['soil.2'], 2, 7, 12, 1],
    [PALETTE['soil.4'], 2, 9, 12, 4],
    [PALETTE['soil.6'], 2, 9, 12, 2],
    [PALETTE['light.2'], 4, 5, 1, 1],
    [PALETTE['light.2'], 10, 10, 1, 1],
  ],
};

/** A paper envelope with the crop's colour showing through the window. */
function seedPacket(accent: string): readonly IconRect[] {
  return [
    [PALETTE['light.5'], 3, 2, 10, 12],
    [PALETTE['light.7'], 4, 3, 8, 10],
    [PALETTE['light.2'], 3, 2, 10, 1],
    [accent, 6, 6, 4, 4],
    [PALETTE['light.7'], 7, 7, 1, 1],
    [PALETTE['soil.5'], 5, 12, 1, 1],
    [PALETTE['soil.5'], 10, 12, 1, 1],
  ];
}

/**
 * The shape a crop is, for the crops that are not hand-drawn.
 *
 * Thirteen crops is thirteen icons and thirteen field sprites, and hand-placing
 * rectangles for all of them would be a day's work for art nobody has chosen
 * yet. So each crop names a form and three colours, and the form draws it:
 * a root is a root whatever colour it is, and a gourd reads as a gourd.
 *
 * These are placeholders and are credited as such — see
 * `public/assets/lpc/CREDITS.md`. Replacing one is adding a hand-drawn entry
 * to `ITEM_ICONS` above, which wins over anything generated here.
 */
export type CropForm = 'root' | 'berry' | 'fruit' | 'gourd' | 'grain' | 'bloom' | 'cap';

export interface CropPalette {
  form: CropForm;
  /** Body, highlight, shadow. The leaves are the form's business. */
  body: string;
  light: string;
  dark: string;
  /** What the seed packet's window shows. Defaults to the body colour. */
  seed?: string;
}

export const CROP_PALETTES: Record<CropId, CropPalette> = {
  // Was light: light.7 — identical to body, the same flatness Task 12 found
  // and fixed in 'wild-daisy' and 'snow-yam' below: produceIcon's 'root' form
  // draws `light` as a small highlight strip on top of the `body` fill, and
  // when the two names the same colour that strip disappears into the fill
  // it sits on, leaving a flat root with no highlight at all. light.6 is
  // already this turnip's own `seed` colour, so the highlight now reads as a
  // second, cooler tone against the cream body rather than a repeat of it —
  // and, being a small accent rect rather than the dominant fill, it stays a
  // shading detail on a turnip rather than becoming a second body colour.
  turnip: { form: 'root', body: PALETTE['light.7'], light: PALETTE['light.6'], dark: PALETTE['building.2'], seed: PALETTE['light.6'] },
  clover: { form: 'bloom', body: PALETTE['light.0'], light: PALETTE['light.1'], dark: PALETTE['leaf.1'], seed: PALETTE['light.0'] },
  strawberry: { form: 'berry', body: PALETTE['building.1'], light: PALETTE['building.3'], dark: PALETTE['clothWarm.2'], seed: PALETTE['building.3'] },
  rhubarb: { form: 'grain', body: PALETTE['building.1'], light: PALETTE['building.3'], dark: PALETTE['clothWarm.2'], seed: PALETTE['building.1'] },
  wheat: { form: 'grain', body: PALETTE['light.5'], light: PALETTE['light.7'], dark: PALETTE['light.2'], seed: PALETTE['light.5'] },
  sunflower: { form: 'bloom', body: PALETTE['light.5'], light: PALETTE['light.7'], dark: PALETTE['light.2'], seed: PALETTE['soil.4'] },
  // Seed was building.3, identical to strawberry's seed below (both fill the
  // same envelope-window rect in `seedPacket`, so the two packets were
  // pixel-for-pixel the same icon). clothWarm.0 is a darker red the tomato
  // does not otherwise use, keeping the packet in the tomato's own colour
  // family without borrowing the strawberry's.
  tomato: { form: 'fruit', body: PALETTE['building.3'], light: PALETTE['light.4'], dark: PALETTE['clothWarm.2'], seed: PALETTE['clothWarm.0'] },
  // Seed was light.0, identical to clover's seed below (same collision as
  // tomato/strawberry above). leaf.0 is the melon's own `dark` shade, so the
  // packet still reads as "melon-coloured" without duplicating clover's.
  melon: { form: 'gourd', body: PALETTE['light.0'], light: PALETTE['light.1'], dark: PALETTE['leaf.0'], seed: PALETTE['leaf.0'] },
  barley: { form: 'grain', body: PALETTE['light.5'], light: PALETTE['light.7'], dark: PALETTE['soil.6'], seed: PALETTE['soil.5'] },
  cranberry: { form: 'berry', body: PALETTE['clothWarm.2'], light: PALETTE['building.3'], dark: PALETTE['clothWarm.0'], seed: PALETTE['clothWarm.2'] },
  pumpkin: { form: 'gourd', body: PALETTE['light.3'], light: PALETTE['light.5'], dark: PALETTE['soil.5'], seed: PALETTE['light.3'] },
  frostcap: { form: 'cap', body: PALETTE['light.6'], light: PALETTE['light.7'], dark: PALETTE['building.2'], seed: PALETTE['building.2'] },
  winterberry: { form: 'berry', body: PALETTE['water.2'], light: PALETTE['water.3'], dark: PALETTE['water.0'], seed: PALETTE['water.2'] },
  // Spec 15's pair. Nếp is a pale ear rather than wheat's gold, and its packet
  // window is the husk; đậu xanh is a green pod-bunch in the berry shape.
  nep: { form: 'grain', body: PALETTE['light.6'], light: PALETTE['light.7'], dark: PALETTE['leaf.3'], seed: PALETTE['gold.0'] },
  'dau-xanh': { form: 'berry', body: PALETTE['leaf.2'], light: PALETTE['light.1'], dark: PALETTE['leaf.0'], seed: PALETTE['light.1'] },
};

const LEAF = PALETTE['leaf.2'];
const LEAF_LIGHT = PALETTE['light.0'];
const LEAF_DARK = PALETTE['leaf.1'];

/** The 16x16 produce icon for a crop, from its form and its three colours. */
function produceIcon({ form, body, light, dark }: CropPalette): readonly IconRect[] {
  switch (form) {
    case 'root':
      return [
        [LEAF_DARK, 6, 1, 2, 3],
        [LEAF_LIGHT, 8, 2, 3, 2],
        [LEAF_LIGHT, 4, 2, 2, 2],
        [dark, 4, 5, 8, 3],
        [body, 4, 8, 8, 5],
        [light, 5, 9, 3, 2],
        [dark, 5, 13, 6, 1],
      ];
    case 'berry':
      return [
        [LEAF_LIGHT, 7, 1, 2, 2],
        [LEAF, 5, 2, 6, 2],
        [body, 4, 4, 8, 5],
        [light, 5, 4, 5, 3],
        [body, 5, 9, 6, 3],
        [dark, 6, 12, 4, 1],
        [PALETTE['light.7'], 6, 6, 1, 1],
        [PALETTE['light.7'], 9, 8, 1, 1],
      ];
    case 'fruit':
      return [
        [LEAF, 6, 1, 4, 2],
        [LEAF_DARK, 7, 3, 2, 1],
        [body, 3, 4, 10, 9],
        [light, 5, 5, 4, 4],
        [dark, 9, 9, 4, 4],
        [dark, 4, 12, 8, 1],
      ];
    case 'gourd':
      return [
        [LEAF_DARK, 7, 1, 2, 3],
        [LEAF, 9, 2, 3, 1],
        [body, 2, 5, 12, 9],
        [light, 4, 6, 3, 7],
        [dark, 10, 6, 3, 7],
        [dark, 2, 12, 12, 2],
        [light, 7, 5, 2, 9],
      ];
    case 'grain':
      return [
        [dark, 7, 9, 2, 6],
        [body, 5, 2, 6, 8],
        [light, 6, 3, 2, 5],
        [dark, 9, 4, 2, 5],
        [LEAF, 3, 9, 3, 2],
        [LEAF, 10, 8, 3, 2],
      ];
    case 'bloom':
      return [
        [LEAF_DARK, 7, 9, 2, 6],
        [LEAF, 3, 10, 4, 2],
        [body, 5, 2, 6, 6],
        [light, 6, 3, 2, 2],
        [dark, 4, 4, 2, 3],
        [dark, 10, 4, 2, 3],
        [body, 6, 1, 4, 2],
        [body, 6, 8, 4, 1],
      ];
    case 'cap':
      return [
        [body, 2, 4, 12, 5],
        [light, 4, 4, 5, 2],
        [dark, 2, 8, 12, 1],
        [PALETTE['light.7'], 6, 9, 4, 5],
        [PALETTE['light.6'], 9, 9, 1, 5],
        [dark, 5, 6, 1, 1],
        [dark, 11, 6, 1, 1],
      ];
  }
}

/**
 * Fills in a seed packet and a produce icon for every crop without one.
 *
 * Written in rather than looked up at call time so `ITEM_ICONS` stays the one
 * place an icon comes from, and so a hand-drawn turnip already in the table is
 * never overwritten by a generated one.
 */
for (const crop of CROP_ORDER) {
  const palette = CROP_PALETTES[crop];
  const seed = seedIdFor(crop);
  ITEM_ICONS[seed] ??= seedPacket(palette.seed ?? palette.body);
  ITEM_ICONS[crop] ??= produceIcon(palette);
}

/**
 * The same six shapes, once per tier the tool actually has, in that tier's
 * metal.
 *
 * A better hoe is recognisably the hoe you already know how to read at a
 * glance in a twelve-cell bar — the only thing that changes is what it is
 * made of, which is also the only thing that changed at the blacksmith.
 *
 * Walked off `TOOL_ROWS` rather than over the four tiers, because not every
 * tool has four: the scythe has two, and drawing a copper one would invent an
 * icon for an item nobody can ever hold.
 */
for (const row of TOOL_ROWS) {
  const shape = TOOL_SHAPES[row.base];
  if (shape) ITEM_ICONS[row.id] ??= shape(TOOL_METALS[row.tier]);
}

/** An egg, in whatever shell the bird lays. */
function eggIcon(shell: string, shade: string, gloss: string): readonly IconRect[] {
  return [
    [shell, 6, 2, 4, 1],
    [shell, 5, 3, 6, 2],
    [shell, 4, 5, 8, 6],
    [shell, 5, 11, 6, 2],
    [shell, 6, 13, 4, 1],
    [shade, 9, 6, 3, 6],
    [shade, 6, 12, 5, 1],
    [gloss, 6, 4, 2, 3],
  ];
}

/** A bottle of milk, corked, because a puddle is not an icon. */
function bottleIcon(body: string, shade: string, cap: string): readonly IconRect[] {
  return [
    [cap, 6, 1, 4, 2],
    [PALETTE['light.7'], 6, 3, 4, 2],
    [PALETTE['light.7'], 4, 5, 8, 1],
    [body, 4, 6, 8, 8],
    [shade, 9, 7, 2, 7],
    [PALETTE['light.7'], 5, 7, 2, 4],
    [PALETTE['light.7'], 4, 14, 8, 1],
  ];
}

/**
 * What tells a fine egg from an ordinary one at a glance in a twelve-cell bar.
 *
 * A mark in the top-left corner rather than a different shape or a different
 * colour: the item is the same item, and a player scanning the hotbar for eggs
 * should find all three stacks in the same read. Nothing at all for the
 * ordinary grade, which is the point — a mark means better.
 */
const GRADE_MARKS: Record<ProduceGrade, readonly IconRect[]> = {
  normal: [],
  good: [
    [PALETTE['light.7'], 1, 1, 3, 1],
    [PALETTE['light.7'], 2, 0, 1, 3],
  ],
  fine: [
    [PALETTE['light.5'], 1, 1, 3, 1],
    [PALETTE['light.5'], 2, 0, 1, 3],
    [PALETTE['light.7'], 0, 0, 1, 1],
    [PALETTE['light.7'], 4, 2, 1, 1],
  ],
};

/**
 * Four base pictures, twelve icons.
 *
 * The grades share a drawing and differ by a corner mark, for the same reason
 * the tools share a shape and differ by their metal: the thing in the slot has
 * not become a different thing, it has become a better one.
 */
const PRODUCE_SHAPES: Record<ItemId, readonly IconRect[]> = {
  egg: eggIcon(PALETTE['light.7'], PALETTE['light.6'], PALETTE['light.7']),
  'duck-egg': eggIcon(PALETTE['light.7'], PALETTE['light.6'], PALETTE['light.7']),
  milk: bottleIcon(PALETTE['light.7'], PALETTE['light.6'], PALETTE['soil.6']),
  'goat-milk': bottleIcon(PALETTE['light.7'], PALETTE['light.6'], PALETTE['soil.6']),
};

for (const base of ANIMAL_PRODUCE_IDS) {
  for (const grade of PRODUCE_GRADES) {
    ITEM_ICONS[gradedIdFor(base, grade)] ??= [
      ...(PRODUCE_SHAPES[base] ?? []),
      ...GRADE_MARKS[grade],
    ];
  }
}

/**
 * The five things the ground gives up, beside the timber already in the table.
 *
 * Drawn by hand rather than generated, unlike the crops and the forage below:
 * there are only five, they share no family resemblance, and being able to
 * tell stone from coal in a crowded bar is worth ten rectangles each.
 */
const MATERIAL_ICONS: Record<ItemId, readonly IconRect[]> = {
  hardwood: [
    // Darker and shorter than the planks, with the grain showing on the end.
    [PALETTE['soil.1'], 3, 4, 10, 8],
    [PALETTE['soil.3'], 3, 4, 10, 2],
    [PALETTE['soil.0'], 3, 11, 10, 1],
    [PALETTE['soil.5'], 4, 6, 1, 4],
    [PALETTE['soil.5'], 8, 5, 1, 6],
    [PALETTE['shadow.0'], 2, 4, 1, 8],
    [PALETTE['shadow.0'], 13, 4, 1, 8],
  ],
  stone: [
    [PALETTE['building.2'], 3, 5, 10, 8],
    [PALETTE['light.6'], 4, 6, 6, 4],
    [PALETTE['light.7'], 5, 6, 3, 2],
    [PALETTE['building.0'], 3, 11, 10, 2],
    [PALETTE['building.0'], 10, 7, 3, 4],
    [PALETTE['light.6'], 6, 3, 4, 2],
  ],
  coal: [
    [PALETTE['shadow.2'], 3, 5, 10, 8],
    [PALETTE['foliage.4'], 4, 6, 5, 4],
    [PALETTE['building.0'], 5, 6, 2, 2],
    [PALETTE['outline.2'], 3, 11, 10, 2],
    [PALETTE['foliage.4'], 9, 3, 3, 3],
  ],
  fiber: [
    // Three stalks tied at the waist, which is what a bundle of dried weed is.
    [PALETTE['light.1'], 4, 2, 2, 11],
    [PALETTE['light.0'], 7, 1, 2, 12],
    [PALETTE['leaf.2'], 10, 3, 2, 10],
    [PALETTE['light.7'], 7, 2, 1, 4],
    [PALETTE['leaf.1'], 3, 7, 10, 2],
    [PALETTE['soil.5'], 3, 7, 10, 1],
  ],
  sap: [
    // A bead running down with the light through it: nothing else is glossy.
    [PALETTE['soil.6'], 6, 2, 4, 3],
    [PALETTE['light.2'], 5, 5, 6, 6],
    [PALETTE['light.5'], 6, 11, 4, 2],
    [PALETTE['light.7'], 6, 5, 2, 4],
    [PALETTE['soil.4'], 9, 8, 2, 4],
  ],
};

for (const [id, shapes] of Object.entries(MATERIAL_ICONS)) ITEM_ICONS[id] ??= shapes;

/**
 * What each piece of forage looks like.
 *
 * The same trick the crops use, and for the same reason: twelve hand-placed
 * icons is a day's work for art nobody has chosen yet, so each one names a
 * form and three colours and the form draws it. A hand-drawn one added to
 * `ITEM_ICONS` above still wins.
 */
const FORAGE_PALETTES: Record<ItemId, CropPalette> = {
  'wild-leek': { form: 'grain', body: PALETTE['light.0'], light: PALETTE['light.1'], dark: PALETTE['leaf.1'] },
  daffodil: { form: 'bloom', body: PALETTE['light.5'], light: PALETTE['light.7'], dark: PALETTE['light.2'] },
  'wild-greens': { form: 'bloom', body: PALETTE['leaf.2'], light: PALETTE['light.0'], dark: PALETTE['leaf.0'] },
  poppy: { form: 'bloom', body: PALETTE['building.3'], light: PALETTE['light.4'], dark: PALETTE['clothWarm.0'] },
  'wild-grape': { form: 'berry', body: PALETTE['water.1'], light: PALETTE['building.2'], dark: PALETTE['shadow.3'] },
  buttercup: { form: 'bloom', body: PALETTE['light.5'], light: PALETTE['light.7'], dark: PALETTE['light.2'] },
  'purple-mushroom': { form: 'cap', body: PALETTE['water.1'], light: PALETTE['building.2'], dark: PALETTE['shadow.3'] },
  // Was body: light.7, light: light.7 — the highlight rect `produceIcon`
  // draws for every 'bloom' is filled in the same colour as the body it
  // sits on, so it never shows: the flower rendered flat. light.5 gives the
  // petals a warm centre instead of a second layer of the same cream.
  'wild-daisy': { form: 'bloom', body: PALETTE['light.7'], light: PALETTE['light.5'], dark: PALETTE['light.6'] },
  chestnut: { form: 'fruit', body: PALETTE['soil.4'], light: PALETTE['light.2'], dark: PALETTE['soil.1'] },
  'winter-root': { form: 'root', body: PALETTE['light.6'], light: PALETTE['light.7'], dark: PALETTE['light.2'] },
  // Was body: light.7, light: light.7, dark: light.6 — identical to
  // 'wild-daisy' above but for the form, so a snow-yam and a wild-daisy read
  // as the same three colours with a different silhouette rather than as
  // two different things. Body and dark swap (a root grown underground
  // reads darker than a flower in bloom) and dark moves to building.2, a
  // cool grey that stands in for frost — distinct from wild-daisy's warm
  // light.6 shadow, and from its own body and light.
  'snow-yam': { form: 'root', body: PALETTE['light.6'], light: PALETTE['light.7'], dark: PALETTE['building.2'] },
  quartz: { form: 'grain', body: PALETTE['light.6'], light: PALETTE['light.7'], dark: PALETTE['leaf.3'] },
};

for (const forage of FORAGE_DEFS) {
  ITEM_ICONS[forage.id] ??= produceIcon(FORAGE_PALETTES[forage.id]);
}

/** What a piece of forage is shaped like, for the sprite it gets in the field. */
export function foragePalette(item: ItemId): CropPalette | null {
  return FORAGE_PALETTES[item] ?? null;
}

// --- spec 11: what a player builds, and what the machines make ---------------

/**
 * The fifteen crafted things.
 *
 * Hand-placed rather than generated, unlike the crops and the forage below,
 * because there is no family resemblance to generate from: a chest, a keg and
 * a length of fence have nothing in common but being sixteen pixels square.
 * Fifteen little drawings is an evening, and the alternative — one generic
 * "crafted thing" box in fifteen colours — is a hotbar you cannot read.
 */
const PLACEABLE_ICONS: Record<ItemId, readonly IconRect[]> = {
  chest: [
    [PALETTE['soil.4'], 2, 5, 12, 8],
    [PALETTE['soil.5'], 2, 5, 12, 2],
    [PALETTE['soil.2'], 2, 12, 12, 1],
    [PALETTE['light.2'], 7, 7, 2, 4],
    [PALETTE['light.5'], 7, 8, 2, 1],
    [PALETTE['soil.2'], 2, 3, 12, 2],
    [PALETTE['soil.5'], 3, 3, 10, 1],
  ],
  'big-chest': [
    [PALETTE['foliage.4'], 1, 4, 14, 9],
    [PALETTE['building.0'], 1, 4, 14, 2],
    [PALETTE['shadow.3'], 1, 12, 14, 1],
    [PALETTE['light.5'], 7, 6, 2, 5],
    [PALETTE['light.7'], 7, 7, 2, 1],
    [PALETTE['shadow.3'], 1, 2, 14, 2],
    [PALETTE['building.0'], 2, 2, 12, 1],
  ],
  keg: [
    // Staves and two hoops. Wider in the middle, which is what says barrel.
    [PALETTE['soil.4'], 4, 2, 8, 12],
    [PALETTE['soil.6'], 3, 4, 10, 8],
    [PALETTE['soil.3'], 5, 2, 1, 12],
    [PALETTE['soil.3'], 10, 2, 1, 12],
    [PALETTE['building.2'], 3, 5, 10, 1],
    [PALETTE['building.2'], 3, 10, 10, 1],
    [PALETTE['light.6'], 4, 3, 2, 2],
  ],
  jar: [
    [PALETTE['light.6'], 5, 1, 6, 2],
    [PALETTE['light.6'], 4, 3, 8, 2],
    [PALETTE['soil.6'], 4, 5, 8, 8],
    [PALETTE['light.3'], 5, 6, 2, 5],
    [PALETTE['clothWarm.3'], 10, 6, 2, 7],
    [PALETTE['light.6'], 4, 13, 8, 1],
  ],
  churn: [
    // A pail with a plunger handle standing out of it.
    [PALETTE['building.2'], 4, 5, 8, 9],
    [PALETTE['light.6'], 5, 6, 3, 7],
    [PALETTE['building.0'], 4, 5, 8, 1],
    [PALETTE['building.0'], 4, 13, 8, 1],
    [PALETTE['soil.4'], 7, 0, 2, 6],
    [PALETTE['soil.6'], 7, 1, 1, 4],
  ],
  kiln: [
    // A squat stone dome with a mouth, and a flame in the mouth.
    [PALETTE['building.0'], 2, 5, 12, 9],
    [PALETTE['building.2'], 3, 4, 10, 2],
    [PALETTE['soil.2'], 2, 13, 12, 1],
    [PALETTE['shadow.0'], 6, 8, 4, 5],
    [PALETTE['light.3'], 6, 10, 4, 3],
    [PALETTE['light.7'], 7, 11, 2, 2],
  ],
  furnace: [
    // A tall brick stack with a glowing mouth, taller and hotter than the kiln.
    [PALETTE['building.2'], 3, 2, 10, 12],
    [PALETTE['building.0'], 3, 2, 10, 2],
    [PALETTE['soil.2'], 2, 13, 12, 1],
    [PALETTE['shadow.3'], 5, 8, 6, 4],
    [PALETTE['light.5'], 6, 9, 4, 2],
    [PALETTE['light.7'], 7, 9, 2, 1],
  ],
  sprinkler: [
    // Four spouts, which is exactly the shape it waters.
    [PALETTE['building.2'], 6, 6, 4, 4],
    [PALETTE['light.6'], 7, 7, 2, 2],
    [PALETTE['water.3'], 7, 2, 2, 3],
    [PALETTE['water.3'], 7, 11, 2, 3],
    [PALETTE['water.3'], 2, 7, 3, 2],
    [PALETTE['water.3'], 11, 7, 3, 2],
  ],
  'quality-sprinkler': [
    // The same body in copper, and the corners filled in: eight, not four.
    [PALETTE['soil.6'], 6, 6, 4, 4],
    [PALETTE['light.5'], 7, 7, 2, 2],
    [PALETTE['water.3'], 7, 2, 2, 3],
    [PALETTE['water.3'], 7, 11, 2, 3],
    [PALETTE['water.3'], 2, 7, 3, 2],
    [PALETTE['water.3'], 11, 7, 3, 2],
    [PALETTE['light.6'], 3, 3, 2, 2],
    [PALETTE['light.6'], 11, 3, 2, 2],
    [PALETTE['light.6'], 3, 11, 2, 2],
    [PALETTE['light.6'], 11, 11, 2, 2],
  ],
  torch: [
    [PALETTE['soil.3'], 7, 7, 2, 8],
    [PALETTE['soil.4'], 7, 8, 1, 6],
    [PALETTE['light.3'], 5, 3, 6, 5],
    // The flame's middle step, hand-moved off the mechanical light.7 (source
    // #f6cf72): that collides with the tip highlight below, which is also
    // light.7 and is the better fit for it. Sap's own bead (a few tables
    // down) uses the same source hex for a single-step glint with nothing
    // to collide with, so it keeps the mechanical light.7 unchanged.
    [PALETTE['light.5'], 6, 4, 4, 3],
    [PALETTE['light.7'], 7, 5, 2, 2],
  ],
  'wood-fence': [
    [PALETTE['soil.4'], 3, 4, 2, 10],
    [PALETTE['soil.4'], 11, 4, 2, 10],
    [PALETTE['soil.6'], 1, 6, 14, 2],
    [PALETTE['soil.6'], 1, 10, 14, 2],
    [PALETTE['soil.3'], 1, 11, 14, 1],
  ],
  'stone-fence': [
    [PALETTE['building.2'], 2, 5, 3, 9],
    [PALETTE['building.2'], 11, 5, 3, 9],
    [PALETTE['light.2'], 1, 7, 14, 2],
    [PALETTE['light.2'], 1, 11, 14, 2],
    [PALETTE['building.0'], 1, 12, 14, 1],
  ],
  'hardwood-fence': [
    [PALETTE['soil.1'], 3, 4, 2, 10],
    [PALETTE['soil.1'], 11, 4, 2, 10],
    [PALETTE['soil.3'], 1, 6, 14, 2],
    [PALETTE['soil.3'], 1, 10, 14, 2],
    [PALETTE['soil.0'], 1, 11, 14, 1],
  ],
  'wood-path': [
    [PALETTE['soil.6'], 1, 3, 14, 3],
    [PALETTE['soil.4'], 1, 7, 14, 3],
    [PALETTE['soil.6'], 1, 11, 14, 3],
    [PALETTE['soil.3'], 1, 5, 14, 1],
    [PALETTE['soil.3'], 1, 13, 14, 1],
  ],
  'stone-path': [
    [PALETTE['light.2'], 1, 1, 6, 6],
    [PALETTE['building.2'], 9, 1, 6, 6],
    [PALETTE['building.2'], 1, 9, 6, 6],
    [PALETTE['light.2'], 9, 9, 6, 6],
    [PALETTE['building.0'], 7, 0, 2, 16],
    [PALETTE['building.0'], 0, 7, 16, 2],
  ],
  'gravel-path': [
    [PALETTE['building.2'], 1, 2, 3, 3],
    [PALETTE['light.2'], 6, 1, 4, 3],
    [PALETTE['building.2'], 11, 3, 4, 3],
    [PALETTE['light.2'], 2, 7, 4, 3],
    [PALETTE['building.2'], 8, 8, 3, 3],
    [PALETTE['light.2'], 12, 9, 3, 3],
    [PALETTE['building.2'], 3, 12, 4, 3],
    [PALETTE['light.2'], 9, 12, 4, 3],
  ],
};

for (const [id, shapes] of Object.entries(PLACEABLE_ICONS)) ITEM_ICONS[id] ??= shapes;

/** The one metal spec 11 names and spec 13 will dig. A stubby ingot. */
/** Spec 16's bars: one stubby ingot, in the metal's own colours. */
function barIcon(body: string, light: string, shade: string, shine: string): readonly IconRect[] {
  return [
    [body, 2, 6, 12, 5],
    [light, 3, 6, 10, 2],
    [shade, 2, 10, 12, 2],
    [shine, 4, 7, 3, 1],
  ];
}

ITEM_ICONS['copper-bar'] ??= barIcon(PALETTE['soil.6'], PALETTE['light.5'], PALETTE['soil.4'], PALETTE['light.7']);
ITEM_ICONS['iron-bar'] ??= barIcon(PALETTE['light.2'], PALETTE['light.6'], PALETTE['building.2'], PALETTE['light.7']);
ITEM_ICONS['gold-bar'] ??= barIcon(PALETTE['light.5'], PALETTE['light.7'], PALETTE['soil.5'], PALETTE['light.7']);

/** Spec 13's ores: one lump of rock, flecked with the metal's colour. */
function oreIcon(fleck: string, shine: string): readonly IconRect[] {
  return [
    [PALETTE['building.2'], 3, 5, 10, 8],
    [PALETTE['building.2'], 5, 3, 6, 2],
    [PALETTE['building.0'], 3, 11, 10, 2],
    [fleck, 5, 6, 3, 2],
    [fleck, 9, 8, 2, 3],
    [shine, 5, 6, 1, 1],
  ];
}

ITEM_ICONS['copper-ore'] ??= oreIcon(PALETTE['soil.6'], PALETTE['light.5']);
ITEM_ICONS['iron-ore'] ??= oreIcon(PALETTE['light.2'], PALETTE['light.7']);
ITEM_ICONS['gold-ore'] ??= oreIcon(PALETTE['light.5'], PALETTE['light.7']);
ITEM_ICONS.gem ??= [
  [PALETTE['building.0'], 4, 4, 8, 9],
  [PALETTE['light.2'], 5, 5, 6, 7],
  [PALETTE['light.7'], 6, 6, 2, 2],
];
/** A blade on the diagonal, which is all a 16x16 sword can be. */
ITEM_ICONS['rusty-sword'] ??= [
  [PALETTE['light.2'], 9, 2, 3, 3],
  [PALETTE['light.2'], 7, 4, 3, 3],
  [PALETTE['light.2'], 5, 6, 3, 3],
  [PALETTE['soil.4'], 3, 9, 5, 2],
  [PALETTE['soil.0'], 2, 11, 3, 3],
];

/** The same blade, in the metal of the band it was made for. */
function swordIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    [metal.mid, 9, 2, 3, 3],
    [metal.mid, 7, 4, 3, 3],
    [metal.mid, 5, 6, 3, 3],
    [metal.light, 10, 2, 1, 1],
    [metal.dark, 3, 9, 5, 2],
    [PALETTE['soil.0'], 2, 11, 3, 3],
  ];
}

ITEM_ICONS['copper-sword'] ??= swordIcon(TOOL_METALS.copper);
ITEM_ICONS['steel-sword'] ??= swordIcon(TOOL_METALS.steel);
ITEM_ICONS['gold-sword'] ??= swordIcon(TOOL_METALS.gold);

/**
 * A jar of something, coloured by what went into it.
 *
 * The same trick the crops take and for the same reason: thirty-two artisan
 * goods is thirty-two icons nobody has drawn, so each one borrows the colour
 * of its input and the shape of its machine. A player sees at a glance that
 * the red bottle came from the strawberries.
 */
function preserveIcon(body: string, light: string, dark: string): readonly IconRect[] {
  return [
    [PALETTE['light.6'], 5, 1, 6, 2],
    [PALETTE['light.6'], 4, 3, 8, 1],
    [body, 4, 4, 8, 9],
    [light, 5, 5, 2, 6],
    [dark, 10, 5, 2, 8],
    [PALETTE['light.6'], 4, 13, 8, 1],
  ];
}

/** A wedge, for the churn. Nothing else in the set is a triangle. */
function wedgeIcon(body: string, light: string, dark: string): readonly IconRect[] {
  return [
    [body, 2, 10, 12, 4],
    [body, 4, 7, 10, 3],
    [body, 7, 4, 7, 3],
    [light, 4, 8, 4, 2],
    [dark, 2, 13, 12, 1],
    [PALETTE['light.7'], 9, 6, 2, 2],
    [PALETTE['light.7'], 5, 11, 2, 2],
  ];
}

/**
 * Every artisan good, drawn from its input's palette and its machine's shape.
 *
 * Walked off the very same two lists that generated the rows in `items.ts`, so
 * a bottle can never exist without a picture or a picture without a bottle.
 */
const MILK_ICON_PALETTE: CropPalette = {
  form: 'root',
  body: PALETTE['light.7'],
  light: PALETTE['light.7'],
  dark: PALETTE['light.6'],
};

function artisanPalette(input: ItemId): CropPalette {
  const crop = CROP_PALETTES[input as CropId];
  if (crop) return crop;
  // The six milks, which are all one colour and differ only by grade.
  return MILK_ICON_PALETTE;
}

for (const machine of ARTISAN_MACHINES) {
  for (const input of ARTISAN_INPUTS) {
    const output = artisanOutputFor(input, machine);
    if (!output) continue;
    const palette = artisanPalette(input);
    const shapes =
      machine === 'churn'
        ? wedgeIcon(palette.body, palette.light, palette.dark)
        : machine === 'jar'
          ? preserveIcon(palette.body, palette.light, palette.dark)
          : bottleIcon(palette.body, palette.dark, PALETTE['soil.4']);
    ITEM_ICONS[output] ??= shapes;
  }
}


/**
 * A fish, from three colours and which way up it swims.
 *
 * The same trick the crops and the forage take, and for the same reason:
 * twenty-one hand-placed icons is a fortnight of art for a table that is
 * meant to grow by one row at a time. What varies is the palette and the
 * silhouette; what stays is that every one of them is a fish-shaped thing
 * pointing left, so a bar with six species in it reads as a catch.
 *
 * The belly is the one place the `deep` colour is used, and it is what stops a
 * pale fish looking like a leaf: real fish are dark on top and light
 * underneath, and sixteen pixels is enough to say so.
 */
interface FishPalette {
  body: string;
  light: string;
  deep: string;
  /** Slimmer for the ones that dart, deeper for the ones that do not. */
  build: 'slim' | 'round';
}

function fishIcon(palette: FishPalette): readonly IconRect[] {
  const { body, light, deep, build } = palette;
  const top = build === 'round' ? 4 : 5;
  const height = build === 'round' ? 8 : 6;
  return [
    // The tail, forked, at the right.
    [deep, 13, top - 1, 2, 3],
    [deep, 13, top + height - 2, 2, 3],
    [body, 12, top + 1, 2, height - 2],
    // The body, tapering to the snout at the left.
    [body, 4, top, 9, height],
    [body, 2, top + 1, 2, height - 2],
    // The back, a shade down, and the belly, a shade up.
    [deep, 4, top, 9, 1],
    [light, 4, top + height - 1, 9, 1],
    [light, 5, top + 1, 4, 1],
    // The dorsal fin, and the eye, which is what makes it face left.
    [deep, 6, top - 1, 4, 1],
    [PALETTE['shadow.0'], 4, top + 2, 1, 1],
  ];
}

/**
 * What each species looks like.
 *
 * Read down the colours rather than the names: the three that share a water
 * are deliberately far apart in hue, because the moment that matters is
 * picking one stack out of a full satchel at a glance.
 */
const FISH_PALETTES: Record<ItemId, FishPalette> = {
  carp: { body: PALETTE['light.2'], light: PALETTE['light.6'], deep: PALETTE['soil.3'], build: 'round' },
  chub: { body: PALETTE['building.2'], light: PALETTE['light.6'], deep: PALETTE['foliage.4'], build: 'slim' },
  bream: { body: PALETTE['light.5'], light: PALETTE['light.7'], deep: PALETTE['soil.6'], build: 'round' },
  sunfish: { body: PALETTE['light.5'], light: PALETTE['light.7'], deep: PALETTE['soil.6'], build: 'round' },
  'smallmouth-bass': { body: PALETTE['leaf.2'], light: PALETTE['light.1'], deep: PALETTE['foliage.3'], build: 'slim' },
  catfish: { body: PALETTE['soil.3'], light: PALETTE['building.2'], deep: PALETTE['soil.0'], build: 'round' },
  'rainbow-trout': { body: PALETTE['light.3'], light: PALETTE['light.5'], deep: PALETTE['clothWarm.3'], build: 'slim' },
  'red-mullet': { body: PALETTE['building.1'], light: PALETTE['light.5'], deep: PALETTE['clothWarm.0'], build: 'slim' },
  pike: { body: PALETTE['leaf.1'], light: PALETTE['light.0'], deep: PALETTE['foliage.1'], build: 'slim' },
  sturgeon: { body: PALETTE['building.0'], light: PALETTE['light.6'], deep: PALETTE['foliage.4'], build: 'round' },
  salmon: { body: PALETTE['light.3'], light: PALETTE['light.5'], deep: PALETTE['clothWarm.3'], build: 'slim' },
  tilapia: { body: PALETTE['building.2'], light: PALETTE['light.7'], deep: PALETTE['building.0'], build: 'round' },
  walleye: { body: PALETTE['light.2'], light: PALETTE['light.5'], deep: PALETTE['soil.4'], build: 'slim' },
  eel: { body: PALETTE['soil.3'], light: PALETTE['soil.6'], deep: PALETTE['shadow.1'], build: 'slim' },
  perch: { body: PALETTE['light.0'], light: PALETTE['light.1'], deep: PALETTE['leaf.0'], build: 'round' },
  lingcod: { body: PALETTE['building.0'], light: PALETTE['light.6'], deep: PALETTE['foliage.4'], build: 'round' },
  'midnight-carp': { body: PALETTE['shadow.3'], light: PALETTE['building.0'], deep: PALETTE['shadow.0'], build: 'round' },
  moonfish: { body: PALETTE['light.6'], light: PALETTE['light.7'], deep: PALETTE['building.2'], build: 'round' },
};

for (const fish of FISH_DEFS) {
  const palette = FISH_PALETTES[fish.id];
  if (palette) ITEM_ICONS[fish.id] ??= fishIcon(palette);
}

/**
 * The three the water gives you instead, drawn by hand.
 *
 * Deliberately *not* fish-shaped. The whole job of these icons is that the
 * player knows at a glance, without reading, that this cast was the one that
 * did not work — so a boot has to be a boot.
 */
ITEM_ICONS.seaweed ??= [
  [PALETTE['leaf.0'], 7, 2, 2, 12],
  [PALETTE['leaf.1'], 4, 4, 2, 9],
  [PALETTE['foliage.3'], 10, 5, 2, 8],
  [PALETTE['light.0'], 5, 3, 1, 4],
  [PALETTE['light.0'], 8, 6, 1, 5],
  [PALETTE['foliage.1'], 6, 13, 5, 1],
];

ITEM_ICONS['rusty-can'] ??= [
  [PALETTE['soil.5'], 5, 3, 6, 10],
  [PALETTE['soil.6'], 6, 4, 3, 8],
  [PALETTE['soil.3'], 5, 12, 6, 2],
  [PALETTE['light.2'], 5, 2, 6, 2],
  // The dent, which is what stops it reading as a barrel.
  [PALETTE['soil.2'], 9, 6, 2, 3],
];

ITEM_ICONS['old-boot'] ??= [
  [PALETTE['soil.1'], 4, 3, 5, 8],
  [PALETTE['soil.3'], 5, 4, 3, 6],
  [PALETTE['soil.1'], 4, 10, 9, 3],
  [PALETTE['soil.0'], 3, 13, 11, 2],
  [PALETTE['soil.4'], 5, 3, 4, 1],
  [PALETTE['soil.0'], 9, 11, 4, 1],
];

/** Bait: fibre wound round a hook, which is exactly what the recipe says. */
ITEM_ICONS.bait ??= [
  [PALETTE['light.1'], 5, 3, 6, 7],
  [PALETTE['light.0'], 6, 4, 3, 5],
  [PALETTE['leaf.1'], 5, 9, 6, 1],
  // The hook below the bundle, bent left, in the same steel the tools use.
  [PALETTE['light.6'], 8, 10, 1, 3],
  [PALETTE['light.6'], 6, 12, 3, 1],
  [PALETTE['building.2'], 6, 11, 1, 1],
];

export function iconFor(item: ItemId): readonly IconRect[] {
  return ITEM_ICONS[item] ?? [];
}
