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
  basic: { dark: '#8f9aa4', mid: '#c9d4dc', light: '#e6eef4' },
  copper: { dark: '#8c4a22', mid: '#c9793c', light: '#f0b072' },
  // Bluer and colder than the iron above, or the two would be the same icon.
  steel: { dark: '#4a5a68', mid: '#8ba3b8', light: '#d6e6f2' },
  gold: { dark: '#8a6414', mid: '#d8b23c', light: '#ffe89a' },
};

function hoeIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    // Handle, corner to corner, with the blade turned out at the top.
    ['#8a5a30', 3, 11, 2, 4],
    ['#a06d3c', 4, 9, 2, 3],
    ['#a06d3c', 5, 7, 2, 3],
    ['#b87c44', 6, 5, 2, 3],
    ['#b87c44', 7, 3, 2, 3],
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
    ['#f4fbff', 4, 7, 6, 1],
    [metal.mid, 11, 8, 3, 2],
    [metal.dark, 13, 5, 2, 4],
  ];
}

/** Wicker, so only the rim, the bands and the handle take the metal. */
function basketIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    [metal.dark, 4, 3, 8, 2],
    ['#3a2b28', 5, 3, 1, 2],
    ['#3a2b28', 10, 3, 1, 2],
    ['#b07a3c', 2, 6, 12, 8],
    ['#d0a05c', 3, 7, 10, 1],
    [metal.mid, 2, 9, 12, 1],
    [metal.dark, 5, 6, 1, 8],
    [metal.dark, 10, 6, 1, 8],
  ];
}

/** A wedge of blade on a short haft, angled so it reads at 16px. */
function axeIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    ['#8a5a30', 6, 6, 2, 9],
    ['#a06d3c', 7, 4, 2, 3],
    ['#b87c44', 7, 13, 2, 2],
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
    ['#8a5a30', 7, 5, 2, 10],
    ['#a06d3c', 7, 13, 2, 2],
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
    ['#8a5a30', 10, 2, 2, 5],
    ['#a06d3c', 9, 7, 2, 4],
    ['#b87c44', 8, 11, 2, 4],
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
    ['#8a5a30', 2, 12, 3, 2],
    ['#a06d3c', 4, 10, 3, 2],
    ['#b87c44', 6, 8, 3, 2],
    ['#c98f52', 8, 6, 2, 2],
    ['#c98f52', 10, 4, 2, 2],
    ['#d9a066', 12, 2, 2, 2],
    // The reel, which is the one place the metal shows at size.
    [metal.dark, 4, 12, 3, 3],
    [metal.mid, 5, 13, 2, 1],
    // The line off the tip, and the float on the end of it.
    [metal.light, 14, 3, 1, 6],
    [metal.mid, 13, 9, 3, 1],
    ['#d9534f', 13, 10, 3, 2],
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
  turnip: [
    ['#4e9c3e', 6, 1, 2, 3],
    ['#6bbd55', 8, 2, 3, 2],
    ['#6bbd55', 4, 2, 2, 2],
    ['#a07bb8', 4, 5, 8, 3],
    ['#f2ecf4', 4, 8, 8, 5],
    ['#ffffff', 5, 9, 3, 2],
    ['#d6c9db', 5, 13, 6, 1],
  ],
  strawberry: [
    ['#6bbd55', 7, 1, 2, 2],
    ['#4e9c3e', 5, 2, 6, 2],
    ['#d63b57', 4, 4, 8, 5],
    ['#e2536a', 5, 4, 5, 3],
    ['#d63b57', 5, 9, 6, 3],
    ['#b52c46', 6, 12, 4, 1],
    ['#ffe6a8', 6, 6, 1, 1],
    ['#ffe6a8', 9, 8, 1, 1],
    ['#ffe6a8', 7, 10, 1, 1],
  ],
  wood: [
    ['#7a5230', 2, 4, 12, 4],
    ['#9c6a3e', 2, 4, 12, 2],
    ['#5e3d24', 2, 7, 12, 1],
    ['#7a5230', 2, 9, 12, 4],
    ['#9c6a3e', 2, 9, 12, 2],
    ['#c08a52', 4, 5, 1, 1],
    ['#c08a52', 10, 10, 1, 1],
  ],
};

/** A paper envelope with the crop's colour showing through the window. */
function seedPacket(accent: string): readonly IconRect[] {
  return [
    ['#c8ab7d', 3, 2, 10, 12],
    ['#e3cfa6', 4, 3, 8, 10],
    ['#a88c5e', 3, 2, 10, 1],
    [accent, 6, 6, 4, 4],
    ['#ffffff', 7, 7, 1, 1],
    ['#8a7048', 5, 12, 1, 1],
    ['#8a7048', 10, 12, 1, 1],
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
  turnip: { form: 'root', body: '#f2ecf4', light: '#ffffff', dark: '#a07bb8', seed: '#f0ece2' },
  clover: { form: 'bloom', body: '#6fc26a', light: '#a6e59c', dark: '#3f8a45', seed: '#5fae55' },
  strawberry: { form: 'berry', body: '#d63b57', light: '#e2536a', dark: '#b52c46', seed: '#e2536a' },
  rhubarb: { form: 'grain', body: '#c2385a', light: '#e0698a', dark: '#8d2340', seed: '#c2385a' },
  wheat: { form: 'grain', body: '#e0be62', light: '#f6dd94', dark: '#a98a36', seed: '#e6cf8e' },
  sunflower: { form: 'bloom', body: '#f2c53d', light: '#ffe27a', dark: '#b8892a', seed: '#6b5a2c' },
  tomato: { form: 'fruit', body: '#e0452f', light: '#f57a5e', dark: '#a52a1c', seed: '#e0452f' },
  melon: { form: 'gourd', body: '#5fa84c', light: '#8ed06e', dark: '#356b2e', seed: '#88c46a' },
  barley: { form: 'grain', body: '#cdb079', light: '#eddaa8', dark: '#95794a', seed: '#8a6a33' },
  cranberry: { form: 'berry', body: '#b1213c', light: '#d8425c', dark: '#7a132a', seed: '#b1213c' },
  pumpkin: { form: 'gourd', body: '#e08b28', light: '#f6b355', dark: '#a05c14', seed: '#e08b28' },
  frostcap: { form: 'cap', body: '#b9c4cc', light: '#e2ebf0', dark: '#7d8b96', seed: '#8fa0ad' },
  winterberry: { form: 'berry', body: '#6a63c4', light: '#948ce0', dark: '#433d8c', seed: '#6a63c4' },
};

const LEAF = '#3f9c46';
const LEAF_LIGHT = '#6bbd55';
const LEAF_DARK = '#2f7d37';

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
        ['#ffe6a8', 6, 6, 1, 1],
        ['#ffe6a8', 9, 8, 1, 1],
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
        ['#efe6d6', 6, 9, 4, 5],
        ['#cdbfa8', 9, 9, 1, 5],
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
    ['#d8d2c4', 6, 3, 4, 2],
    ['#d8d2c4', 4, 5, 8, 1],
    [body, 4, 6, 8, 8],
    [shade, 9, 7, 2, 7],
    ['#ffffff', 5, 7, 2, 4],
    ['#d8d2c4', 4, 14, 8, 1],
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
    ['#cfe6f2', 1, 1, 3, 1],
    ['#cfe6f2', 2, 0, 1, 3],
  ],
  fine: [
    ['#ffd76a', 1, 1, 3, 1],
    ['#ffd76a', 2, 0, 1, 3],
    ['#fff3c4', 0, 0, 1, 1],
    ['#fff3c4', 4, 2, 1, 1],
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
  egg: eggIcon('#f6ecd8', '#ddcba9', '#fffdf6'),
  'duck-egg': eggIcon('#cfe2d6', '#a7c2b2', '#eef7f1'),
  milk: bottleIcon('#f4f1e8', '#d6d1c2', '#a3623a'),
  'goat-milk': bottleIcon('#fbf7ef', '#dedac9', '#6f7f5a'),
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
    ['#4a3120', 3, 4, 10, 8],
    ['#6b4629', 3, 4, 10, 2],
    ['#38251a', 3, 11, 10, 1],
    ['#8a5f3a', 4, 6, 1, 4],
    ['#8a5f3a', 8, 5, 1, 6],
    ['#2b1c13', 2, 4, 1, 8],
    ['#2b1c13', 13, 4, 1, 8],
  ],
  stone: [
    ['#7d8b96', 3, 5, 10, 8],
    ['#9aa8b2', 4, 6, 6, 4],
    ['#c2ced6', 5, 6, 3, 2],
    ['#5c6872', 3, 11, 10, 2],
    ['#5c6872', 10, 7, 3, 4],
    ['#9aa8b2', 6, 3, 4, 2],
  ],
  coal: [
    ['#2a2a30', 3, 5, 10, 8],
    ['#3f3f49', 4, 6, 5, 4],
    ['#5a5a66', 5, 6, 2, 2],
    ['#17171c', 3, 11, 10, 2],
    ['#3f3f49', 9, 3, 3, 3],
  ],
  fiber: [
    // Three stalks tied at the waist, which is what a bundle of dried weed is.
    ['#8fa84c', 4, 2, 2, 11],
    ['#a3bd5e', 7, 1, 2, 12],
    ['#7a9140', 10, 3, 2, 10],
    ['#c8d98a', 7, 2, 1, 4],
    ['#5f7030', 3, 7, 10, 2],
    ['#8a6a46', 3, 7, 10, 1],
  ],
  sap: [
    // A bead running down with the light through it: nothing else is glossy.
    ['#a8721c', 6, 2, 4, 3],
    ['#c98b26', 5, 5, 6, 6],
    ['#e0a83c', 6, 11, 4, 2],
    ['#f6cf72', 6, 5, 2, 4],
    ['#7d5210', 9, 8, 2, 4],
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
  'wild-leek': { form: 'grain', body: '#7fae4e', light: '#a8d178', dark: '#4f7a2e' },
  daffodil: { form: 'bloom', body: '#f5d54a', light: '#ffeb96', dark: '#c29a1e' },
  'wild-greens': { form: 'bloom', body: '#4f9c46', light: '#7ec86a', dark: '#2f6b30' },
  poppy: { form: 'bloom', body: '#d63b3b', light: '#f07070', dark: '#8f2020' },
  'wild-grape': { form: 'berry', body: '#7a5bbd', light: '#a68ee0', dark: '#4e3780' },
  buttercup: { form: 'bloom', body: '#f2b53d', light: '#ffd87a', dark: '#b8801a' },
  'purple-mushroom': { form: 'cap', body: '#8a5bbd', light: '#b68ee0', dark: '#573780' },
  'wild-daisy': { form: 'bloom', body: '#f4efe2', light: '#ffffff', dark: '#c9c0aa' },
  chestnut: { form: 'fruit', body: '#8a5326', light: '#b57a44', dark: '#54300f' },
  'winter-root': { form: 'root', body: '#d9c8a6', light: '#f0e3c6', dark: '#9c8760' },
  'snow-yam': { form: 'root', body: '#eef2f6', light: '#ffffff', dark: '#adbcc9' },
  quartz: { form: 'grain', body: '#bfe3ef', light: '#f0fbff', dark: '#7aa8bb' },
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
    ['#7a4f24', 2, 5, 12, 8],
    ['#96622d', 2, 5, 12, 2],
    ['#5c3a19', 2, 12, 12, 1],
    ['#c8a24a', 7, 7, 2, 4],
    ['#e2c06a', 7, 8, 2, 1],
    ['#5c3a19', 2, 3, 12, 2],
    ['#96622d', 3, 3, 10, 1],
  ],
  'big-chest': [
    ['#5d4a7a', 1, 4, 14, 9],
    ['#7b6299', 1, 4, 14, 2],
    ['#40325a', 1, 12, 14, 1],
    ['#e2c06a', 7, 6, 2, 5],
    ['#fff0b0', 7, 7, 2, 1],
    ['#40325a', 1, 2, 14, 2],
    ['#7b6299', 2, 2, 12, 1],
  ],
  keg: [
    // Staves and two hoops. Wider in the middle, which is what says barrel.
    ['#8a5a2a', 4, 2, 8, 12],
    ['#a06c33', 3, 4, 10, 8],
    ['#6b4420', 5, 2, 1, 12],
    ['#6b4420', 10, 2, 1, 12],
    ['#8d8d96', 3, 5, 10, 1],
    ['#8d8d96', 3, 10, 10, 1],
    ['#c2accd', 4, 3, 2, 2],
  ],
  jar: [
    ['#b0c8d6', 5, 1, 6, 2],
    ['#8fa9b8', 4, 3, 8, 2],
    ['#c86a3a', 4, 5, 8, 8],
    ['#e08a52', 5, 6, 2, 5],
    ['#9c4a22', 10, 6, 2, 7],
    ['#8fa9b8', 4, 13, 8, 1],
  ],
  churn: [
    // A pail with a plunger handle standing out of it.
    ['#9aa4ad', 4, 5, 8, 9],
    ['#c2ccd4', 5, 6, 3, 7],
    ['#6f7a84', 4, 5, 8, 1],
    ['#6f7a84', 4, 13, 8, 1],
    ['#8a5a2a', 7, 0, 2, 6],
    ['#a06c33', 7, 1, 1, 4],
  ],
  kiln: [
    // A squat stone dome with a mouth, and a flame in the mouth.
    ['#6f6a62', 2, 5, 12, 9],
    ['#857f75', 3, 4, 10, 2],
    ['#4c4841', 2, 13, 12, 1],
    ['#241f1c', 6, 8, 4, 5],
    ['#e08a28', 6, 10, 4, 3],
    ['#f6cf72', 7, 11, 2, 2],
  ],
  sprinkler: [
    // Four spouts, which is exactly the shape it waters.
    ['#8d95a0', 6, 6, 4, 4],
    ['#b5bdc7', 7, 7, 2, 2],
    ['#5f95c4', 7, 2, 2, 3],
    ['#5f95c4', 7, 11, 2, 3],
    ['#5f95c4', 2, 7, 3, 2],
    ['#5f95c4', 11, 7, 3, 2],
  ],
  'quality-sprinkler': [
    // The same body in copper, and the corners filled in: eight, not four.
    ['#b5793a', 6, 6, 4, 4],
    ['#e0a55c', 7, 7, 2, 2],
    ['#5f95c4', 7, 2, 2, 3],
    ['#5f95c4', 7, 11, 2, 3],
    ['#5f95c4', 2, 7, 3, 2],
    ['#5f95c4', 11, 7, 3, 2],
    ['#7fb5dd', 3, 3, 2, 2],
    ['#7fb5dd', 11, 3, 2, 2],
    ['#7fb5dd', 3, 11, 2, 2],
    ['#7fb5dd', 11, 11, 2, 2],
  ],
  torch: [
    ['#6b4420', 7, 7, 2, 8],
    ['#8a5a2a', 7, 8, 1, 6],
    ['#e08a28', 5, 3, 6, 5],
    ['#f6cf72', 6, 4, 4, 3],
    ['#fff3c4', 7, 5, 2, 2],
  ],
  'wood-fence': [
    ['#8a5a2a', 3, 4, 2, 10],
    ['#8a5a2a', 11, 4, 2, 10],
    ['#a06c33', 1, 6, 14, 2],
    ['#a06c33', 1, 10, 14, 2],
    ['#6b4420', 1, 11, 14, 1],
  ],
  'stone-fence': [
    ['#8b8680', 2, 5, 3, 9],
    ['#8b8680', 11, 5, 3, 9],
    ['#a39d95', 1, 7, 14, 2],
    ['#a39d95', 1, 11, 14, 2],
    ['#66625c', 1, 12, 14, 1],
  ],
  'hardwood-fence': [
    ['#4e3220', 3, 4, 2, 10],
    ['#4e3220', 11, 4, 2, 10],
    ['#6b4a2c', 1, 6, 14, 2],
    ['#6b4a2c', 1, 10, 14, 2],
    ['#2f1d10', 1, 11, 14, 1],
  ],
  'wood-path': [
    ['#a06c33', 1, 3, 14, 3],
    ['#8a5a2a', 1, 7, 14, 3],
    ['#a06c33', 1, 11, 14, 3],
    ['#6b4420', 1, 5, 14, 1],
    ['#6b4420', 1, 13, 14, 1],
  ],
  'stone-path': [
    ['#a39d95', 1, 1, 6, 6],
    ['#8b8680', 9, 1, 6, 6],
    ['#8b8680', 1, 9, 6, 6],
    ['#a39d95', 9, 9, 6, 6],
    ['#66625c', 7, 0, 2, 16],
    ['#66625c', 0, 7, 16, 2],
  ],
  'gravel-path': [
    ['#8b8680', 1, 2, 3, 3],
    ['#a39d95', 6, 1, 4, 3],
    ['#8b8680', 11, 3, 4, 3],
    ['#a39d95', 2, 7, 4, 3],
    ['#8b8680', 8, 8, 3, 3],
    ['#a39d95', 12, 9, 3, 3],
    ['#8b8680', 3, 12, 4, 3],
    ['#a39d95', 9, 12, 4, 3],
  ],
};

for (const [id, shapes] of Object.entries(PLACEABLE_ICONS)) ITEM_ICONS[id] ??= shapes;

/** The one metal spec 11 names and spec 13 will dig. A stubby ingot. */
ITEM_ICONS['copper-bar'] ??= [
  ['#b5793a', 2, 6, 12, 5],
  ['#e0a55c', 3, 6, 10, 2],
  ['#8a5426', 2, 10, 12, 2],
  ['#f2c68a', 4, 7, 3, 1],
];

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
    ['#b0c8d6', 5, 1, 6, 2],
    ['#8fa9b8', 4, 3, 8, 1],
    [body, 4, 4, 8, 9],
    [light, 5, 5, 2, 6],
    [dark, 10, 5, 2, 8],
    ['#8fa9b8', 4, 13, 8, 1],
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
    ['#fff8e0', 9, 6, 2, 2],
    ['#fff8e0', 5, 11, 2, 2],
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
  body: '#f4f0e4',
  light: '#ffffff',
  dark: '#c9c0aa',
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
          : bottleIcon(palette.body, palette.dark, '#8a5a2a');
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
    ['#1b1b22', 4, top + 2, 1, 1],
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
  carp: { body: '#8a8f5a', light: '#c4c68e', deep: '#575c34', build: 'round' },
  chub: { body: '#7d8c9a', light: '#b9c6d2', deep: '#4d5a66', build: 'slim' },
  bream: { body: '#c8b06a', light: '#efdca6', deep: '#8a7436', build: 'round' },
  sunfish: { body: '#e8b93c', light: '#ffe488', deep: '#a87a12', build: 'round' },
  'smallmouth-bass': { body: '#6f8f4e', light: '#a6c481', deep: '#415a2a', build: 'slim' },
  catfish: { body: '#5c5142', light: '#8f8270', deep: '#332c22', build: 'round' },
  'rainbow-trout': { body: '#cf6f7a', light: '#f3aeb4', deep: '#8a3c46', build: 'slim' },
  'red-mullet': { body: '#c4553f', light: '#e8907a', deep: '#7d2d1c', build: 'slim' },
  pike: { body: '#4f7a4a', light: '#84ad78', deep: '#2c4a28', build: 'slim' },
  sturgeon: { body: '#6a6f80', light: '#a0a6b8', deep: '#3d4150', build: 'round' },
  salmon: { body: '#e0805a', light: '#ffb794', deep: '#9c4a2c', build: 'slim' },
  tilapia: { body: '#9aa0a8', light: '#cfd5dc', deep: '#62686f', build: 'round' },
  walleye: { body: '#a88a46', light: '#d8bd80', deep: '#6b5620', build: 'slim' },
  eel: { body: '#41503f', light: '#74855f', deep: '#222c22', build: 'slim' },
  perch: { body: '#7f9a4e', light: '#b4cd86', deep: '#4c6428', build: 'round' },
  lingcod: { body: '#5a8090', light: '#94b6c4', deep: '#32505c', build: 'round' },
  'midnight-carp': { body: '#3b3a5c', light: '#6f6d96', deep: '#1d1c30', build: 'round' },
  moonfish: { body: '#cfd8f0', light: '#ffffff', deep: '#8b95c4', build: 'round' },
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
  ['#3f6b3a', 7, 2, 2, 12],
  ['#4f8347', 4, 4, 2, 9],
  ['#356030', 10, 5, 2, 8],
  ['#6fa062', 5, 3, 1, 4],
  ['#6fa062', 8, 6, 1, 5],
  ['#2a4a26', 6, 13, 5, 1],
];

ITEM_ICONS['rusty-can'] ??= [
  ['#8d5f3a', 5, 3, 6, 10],
  ['#a97a4e', 6, 4, 3, 8],
  ['#6b4526', 5, 12, 6, 2],
  ['#c49a6a', 5, 2, 6, 2],
  // The dent, which is what stops it reading as a barrel.
  ['#5a3a1f', 9, 6, 2, 3],
];

ITEM_ICONS['old-boot'] ??= [
  ['#4a3626', 4, 3, 5, 8],
  ['#5e452f', 5, 4, 3, 6],
  ['#4a3626', 4, 10, 9, 3],
  ['#2e2119', 3, 13, 11, 2],
  ['#7a5c3f', 5, 3, 4, 1],
  ['#2e2119', 9, 11, 4, 1],
];

/** Bait: fibre wound round a hook, which is exactly what the recipe says. */
ITEM_ICONS.bait ??= [
  ['#8fa84c', 5, 3, 6, 7],
  ['#a3bd5e', 6, 4, 3, 5],
  ['#5f7030', 5, 9, 6, 1],
  // The hook below the bundle, bent left, in the same steel the tools use.
  ['#c9d4dc', 8, 10, 1, 3],
  ['#c9d4dc', 6, 12, 3, 1],
  ['#8f9aa4', 6, 11, 1, 1],
];

export function iconFor(item: ItemId): readonly IconRect[] {
  return ITEM_ICONS[item] ?? [];
}
