/**
 * Everything the game can hold, in one table.
 *
 * Items are data, not types: a crop, a seed packet, a tool and a plank are all
 * `ItemDef`s, and what separates them is which fields they fill in. Adding a
 * crop is adding two rows here — the seed and the produce — rather than
 * editing a type, four call sites and the HUD.
 */

import { SEASONS, type Season, type Weather } from './time';
// Type-only, and deliberately from the generated map list rather than from
// `world/areas`: the fish table has to name the waters a species lives in, and
// importing the area module for real would have every item lookup drag the
// whole of Tiled map parsing in behind it. Areas know nothing about items, so
// there is no cycle either way — only a cost, and this is how it is avoided.
import type { AreaId } from '../world/maps.generated';

export type ItemId = string;

/**
 * Every crop, in the order the year grows them.
 *
 * A union rather than a string so a typo in a seed row is a compile error.
 * What each one *is* — which seasons, how long, whether it regrows — lives in
 * `CROP_DEFINITIONS`; this is only the set of names.
 */
export type CropId =
  | 'turnip'
  | 'clover'
  | 'strawberry'
  | 'rhubarb'
  | 'wheat'
  | 'sunflower'
  | 'tomato'
  | 'melon'
  | 'barley'
  | 'cranberry'
  | 'pumpkin'
  | 'nep'
  | 'dau-xanh';

/**
 * What a tool *is*, not what it does.
 *
 * Kept separate from `FarmAction` because tools have tiers: a copper hoe and a
 * steel hoe are two items with the same `tool`, and only the reducer cares
 * that both of them till.
 */
export type Tool = 'hoe' | 'can' | 'basket' | 'axe' | 'pickaxe' | 'scythe' | 'rod' | 'sword';

/**
 * How far up the blacksmith's ladder a tool is.
 *
 * An upgrade is a different item rather than a number on the player, so what
 * a swing does is decided entirely by what is in the slot — which is what
 * lets a tool be handed over for two days and genuinely be gone.
 */
export type ToolTier = 'basic' | 'copper' | 'steel' | 'gold';

export const TOOL_TIERS: readonly ToolTier[] = ['basic', 'copper', 'steel', 'gold'];

export interface ItemDef {
  id: ItemId;
  label: string;
  /** Sprite key. */
  texture: string;
  /** How many fit in one slot. Tools are 1. */
  stackSize: number;
  /** What acting with it does, if anything. */
  tool?: Tool;
  /** Which rung of the blacksmith's ladder, for an item that is a tool. */
  tier?: ToolTier;
  /**
   * Tiles one swing works, as a rectangle centred on the target tile.
   *
   * The dramatic half of an upgrade: tilling nine tiles in a swing changes
   * how a morning feels. Not rotated by facing — the rectangle is centred on
   * whatever tile was aimed at, so a click means the same nine tiles however
   * the farmhand happens to be standing.
   */
  areaOfEffect?: { width: number; height: number };
  /**
   * Multiplier on what the swing costs in energy.
   *
   * The quiet half: it buys back minutes rather than reach, and it is applied
   * to the whole sweep rather than per tile, so the saving is real at the
   * scale the area is worth using at.
   */
  energyFactor?: number;
  /** What the blacksmith turns this into, and what he charges for the work. */
  upgradesTo?: ItemId;
  upgradeCost?: number;
  /** The bars the blacksmith also wants for that work (spec 16). */
  upgradeBars?: { item: ItemId; count: number };
  /** What planting it grows, if anything. */
  plants?: CropId;
  /**
   * Full capacity, for an item that holds something rather than stacks: the
   * watering can's pours, which is what a better can mostly buys.
   */
  charges?: number;
  /**
   * How much of the fishing bar the player's square covers, from 0 to 1.
   *
   * The rod's tier axis, and the only rung on the blacksmith's ladder that
   * buys neither reach nor energy. A wider square makes a hard fish possible
   * rather than an easy one quicker, which is the right shape for a minigame:
   * an upgrade opens the table up instead of shortening what is already won.
   */
  barWidth?: number;
  /**
   * What one swing takes off a monster, for a weapon. Spec 13: before the
   * monster's defence, which `strikeDamage` never lets fall below 1.
   */
  damage?: number;
  /** What the market pays for one. Zero for anything it will not take. */
  sellPrice: number;
  /**
   * What the market charges for one, for the seeds it stocks.
   *
   * Separate from `sellPrice` because the stall is not a mirror: it sells seed
   * packets and buys none, and it buys produce and sells none. An item with no
   * `buyPrice` is not for sale at any price.
   */
  buyPrice?: number;
  /** True for what a crop yields, which is what the market stall buys. */
  produce?: boolean;
  /** A one-line description for the inventory tooltip. */
  blurb: string;
}

/**
 * How good a thing an animal gave you.
 *
 * A suffix on the id rather than a field on `ItemStack`, and that is a
 * decision worth stating because it looks like the wrong one. A quality field
 * would spread into `addItem`, `moveStack`, `splitStack`, `removeItem`, every
 * sale and the whole gift table — six places that currently compare two
 * strings and would have to start comparing two pairs. Three extra rows in
 * this table cost one function and nothing else.
 *
 * The consequence, written down so nobody has to guess later: if crops are
 * ever graded too, they follow this same convention or both get redone.
 */
export type ProduceGrade = 'normal' | 'good' | 'fine';

export const PRODUCE_GRADES: readonly ProduceGrade[] = ['normal', 'good', 'fine'];

const GRADE_SUFFIX: Record<ProduceGrade, string> = { normal: '', good: '-good', fine: '-fine' };

/** Vietnamese puts the qualifier after the noun, as the tool tiers do. */
const GRADE_LABEL: Record<ProduceGrade, string> = {
  normal: '',
  good: 'loại tốt',
  fine: 'thượng hạng',
};

/** What a grade is worth, against the ordinary article. */
export const GRADE_MULTIPLIER: Record<ProduceGrade, number> = { normal: 1, good: 1.25, fine: 1.5 };

/** The id of a graded thing. A convention, so the rows below stay one row each. */
export function gradedIdFor(base: ItemId, grade: ProduceGrade): ItemId {
  return `${base}${GRADE_SUFFIX[grade]}`;
}

/**
 * What the four animals give, before the grade is applied.
 *
 * Here rather than in `animals.ts` so that nothing in the item table has to
 * import the animal table: the animals name these ids, and the ids know
 * nothing about the animals. `price` is the ordinary grade's price, and the
 * better two are derived from it.
 */
const ANIMAL_PRODUCE: ReadonlyArray<{ id: ItemId; label: string; price: number; blurb: string }> = [
  { id: 'egg', label: 'Trứng', price: 55, blurb: 'Còn ấm. Gà đẻ mỗi ngày, kể cả tháng Chạp.' },
  {
    id: 'duck-egg',
    label: 'Trứng vịt',
    price: 130,
    blurb: 'To hơn, xanh hơn, và hai ngày mới có một quả.',
  },
  { id: 'milk', label: 'Sữa', price: 140, blurb: 'Vắt lúc sáng sớm, còn nguyên hơi ấm của chuồng.' },
  {
    id: 'goat-milk',
    label: 'Sữa dê',
    price: 250,
    blurb: 'Đặc và béo. Thứ đắt nhất một con vật cho không.',
  },
];

/** Every base produce id, for the icon generator and for tests. */
export const ANIMAL_PRODUCE_IDS: readonly ItemId[] = ANIMAL_PRODUCE.map((row) => row.id);

/**
 * Twelve rows from four, built the way the tool ladder is.
 *
 * The grade rides in the label as well as the price, because the satchel is
 * where a player finds out that looking after the herd paid: three stacks of
 * eggs that sell for three different amounts is the whole mechanic, visible.
 */
function produceRows(): Record<ItemId, ItemDef> {
  const rows: Record<ItemId, ItemDef> = {};
  for (const base of ANIMAL_PRODUCE) {
    for (const grade of PRODUCE_GRADES) {
      const id = gradedIdFor(base.id, grade);
      rows[id] = {
        id,
        label: grade === 'normal' ? base.label : `${base.label} ${GRADE_LABEL[grade]}`,
        texture: `item-${id}`,
        stackSize: DEFAULT_STACK_SIZE,
        sellPrice: Math.round(base.price * GRADE_MULTIPLIER[grade]),
        produce: true,
        blurb: base.blurb,
      };
    }
  }
  return rows;
}

/** How many pours a full basic can holds. Better cans hold more. */
export const WATERING_CAN_CHARGES = 12;

/** How many of an ordinary item fit in one slot. */
export const DEFAULT_STACK_SIZE = 99;

/**
 * What each rung of the ladder is worth.
 *
 * Two axes, and both matter. Area is what the player feels: a steel hoe turns
 * a morning of tilling into a few swings. Energy is what they only notice at
 * the end of the week, when the day reaches further than it used to.
 *
 * `cost` is what the blacksmith charges to reach this tier from the one below,
 * priced against a season's takings rather than against the starting wallet:
 * copper is an early autumn, gold is a year of them.
 */
interface TierDef {
  label: string;
  areaOfEffect: { width: number; height: number };
  energyFactor: number;
  cost: number;
  /**
   * The bars reaching this tier costs, on top of `cost` (spec 16). Three
   * rather than Stardew's five because tools are per player: six implements
   * a rung is eighteen bars each, and five would make a co-op of four grind.
   */
  bars: { item: ItemId; count: number } | null;
  /** Pours, for the tier's watering can. */
  charges: number;
  /**
   * How much of the fishing bar this tier's rod covers, from 0 to 1.
   *
   * A third axis on the same table, here rather than in `fishing.ts` for the
   * reason the charges are here: what a rung is worth belongs beside the two
   * other things a rung is worth, so pricing the ladder is reading one table.
   * Only the rod reads it, exactly as only the can reads `charges`.
   */
  barWidth: number;
}

const TIERS: Record<ToolTier, TierDef> = {
  basic: { label: '', areaOfEffect: { width: 1, height: 1 }, energyFactor: 1, cost: 0, bars: null, charges: WATERING_CAN_CHARGES, barWidth: 0.2 },
  copper: { label: 'Đồng', areaOfEffect: { width: 1, height: 3 }, energyFactor: 0.9, cost: 250, bars: { item: 'copper-bar', count: 3 }, charges: 36, barWidth: 0.26 },
  steel: { label: 'Thép', areaOfEffect: { width: 3, height: 3 }, energyFactor: 0.8, cost: 1000, bars: { item: 'iron-bar', count: 3 }, charges: 72, barWidth: 0.32 },
  gold: { label: 'Vàng', areaOfEffect: { width: 3, height: 5 }, energyFactor: 0.7, cost: 2500, bars: { item: 'gold-bar', count: 3 }, charges: 120, barWidth: 0.4 },
};

/**
 * One implement, and which rungs of the ladder it has.
 *
 * `tiers` and `forged` are both here for the scythe, and the scythe is the
 * reason this stopped being a flat list. See the table below.
 */
interface ToolBase {
  id: ItemId;
  tool: Tool;
  label: string;
  blurb: string;
  /** Which rungs exist. The whole ladder unless a tool says otherwise. */
  tiers?: readonly ToolTier[];
  /**
   * Whether the blacksmith works it up the ladder.
   *
   * False means the better version is bought rather than forged, and the rows
   * carry no `upgradesTo` at all — so the anvil never offers it and the
   * `pendingUpgrade` machinery never has to know it is special.
   */
  forged?: boolean;
  /** What the stall charges for a tier, for a tool that is bought. */
  price?: Partial<Record<ToolTier, number>>;
}

/**
 * The six implements, before any of them has been to the blacksmith.
 *
 * The first three are spec 06's; the last three are what makes the world
 * outside the field reachable. All three new ones go up the very same ladder,
 * through the very same blacksmith, with no new rule anywhere — which is the
 * entire reason this part of the spec is cheap.
 *
 * The scythe is the one exception, and it is worth saying why rather than
 * leaving it to be discovered. A tier on this ladder buys reach and *energy*,
 * and cutting grass costs no energy at all — so copper and steel scythes would
 * sell a saving of nought. It gets two rungs instead: the one you start with,
 * and a golden one over the counter at the market for anybody who would rather
 * clear a field in four swings than forty.
 */
const TOOL_BASES: readonly ToolBase[] = [
  { id: 'hoe', tool: 'hoe', label: 'Cuốc', blurb: 'Vỡ đất hoang thành luống đất trồng được.' },
  {
    id: 'watering-can',
    tool: 'can',
    label: 'Bình tưới',
    blurb: 'Chứa được một tá gáo nước. Tự đầy lại qua đêm.',
  },
  { id: 'basket', tool: 'basket', label: 'Giỏ thu hoạch', blurb: 'Để nhấc thứ đã chín lên mà không làm giập.' },
  { id: 'axe', tool: 'axe', label: 'Rìu', blurb: 'Hạ cây, cành khô và — từ bậc đồng trở lên — cả gốc cây.' },
  {
    id: 'pickaxe',
    tool: 'pickaxe',
    label: 'Cuốc chim',
    blurb: 'Đập đá thành đá xây. Bậc thép mới vỡ nổi tảng lớn.',
  },
  {
    id: 'scythe',
    tool: 'scythe',
    label: 'Liềm',
    blurb: 'Cắt cỏ dại và cỏ. Không tốn một chút sức nào.',
    tiers: ['basic', 'gold'],
    forged: false,
    price: { gold: 4000 },
  },
  // The one tool a farmhand does not wake up with, and the only row that is
  // both bought and forged. It is bought once at the stall, because fishing
  // should be a thing the player goes and decides to take up rather than a
  // sixth icon in the bar on the first morning; from there it goes up the
  // ordinary ladder at the ordinary anvil. What the rungs buy is neither
  // reach nor energy — see `barWidth` on `TierDef`.
  {
    id: 'fishing-rod',
    tool: 'rod',
    label: 'Cần câu',
    blurb: 'Ném xuống nước và đợi. Việc duy nhất trên nông trại không tốn sức kéo.',
    price: { basic: 500 },
  },
];

/** The rungs a tool actually has. The whole ladder unless it says otherwise. */
function tiersOf(base: ToolBase): readonly ToolTier[] {
  return base.tiers ?? TOOL_TIERS;
}

/**
 * The id of a tool at a tier. A convention rather than a table, so the twelve
 * tool rows below are twelve rows and not twelve places to make a typo.
 */
export function toolIdFor(base: ItemId, tier: ToolTier): ItemId {
  return tier === 'basic' ? base : `${tier}-${base}`;
}

/** What each tier's blurb says about the swing it buys. */
function tierBlurb(tier: ToolTier, base: ToolBase): string {
  if (tier === 'basic') return base.blurb;
  const { width, height } = TIERS[tier].areaOfEffect;
  const reach = `${width}x${height} ô mỗi nhát`;
  const saving = `đỡ tốn ${Math.round((1 - TIERS[tier].energyFactor) * 100)}% sức`;
  if (base.tool === 'can') return `${reach}, ${TIERS[tier].charges} gáo nước, ${saving}.`;
  // The scythe never cost energy, so a discount on nought is nothing to sell.
  // What the golden one buys is the field in one pass.
  if (base.tool === 'scythe') return `${reach}. Vẫn không tốn một chút sức nào.`;
  // A rod swings at nothing, so neither half of the sentence above means
  // anything for it. What it buys is the square on the bar, said as a width
  // rather than a number because a width is what the player looks at.
  if (base.tool === 'rod') {
    return `Ô vuông rộng hơn ${Math.round((TIERS[tier].barWidth / TIERS.basic.barWidth - 1) * 100)}%, nên cá khó hơn mới giữ nổi.`;
  }
  return `${reach}, và ${saving}.`;
}

/**
 * Every tool, at every tier, built from the two tables above.
 *
 * Written into `ITEMS` below rather than kept beside it, so there stays
 * exactly one place an item is looked up from.
 */
function toolRows(): Record<ItemId, ItemDef> {
  const rows: Record<ItemId, ItemDef> = {};
  for (const base of TOOL_BASES) {
    const tiers = tiersOf(base);
    tiers.forEach((tier, index) => {
      const id = toolIdFor(base.id, tier);
      const next = tiers[index + 1];
      const def: ItemDef = {
        id,
        // Vietnamese puts the qualifier after the noun: "Cuốc đồng", not "Đồng cuốc".
        label: tier === 'basic' ? base.label : `${base.label} ${TIERS[tier].label.toLowerCase()}`,
        texture: `item-${id}`,
        stackSize: 1,
        tool: base.tool,
        tier,
        areaOfEffect: TIERS[tier].areaOfEffect,
        energyFactor: TIERS[tier].energyFactor,
        // Tools are never sold: handing a hoe to the stallholder for 0g is a
        // way to lose it by accident, and there is no way to get another.
        sellPrice: 0,
        blurb: tierBlurb(tier, base),
      };
      if (base.tool === 'can') def.charges = TIERS[tier].charges;
      // The rod sits out both of the axes above. A tier of rod tills nothing
      // and lifts nothing, so inheriting a 3x5 rectangle and a 30% discount
      // from the table would be two numbers that describe a swing it never
      // makes — and `areaOfEffectOf` is asked about whatever is in hand, not
      // only about things that till.
      if (base.tool === 'rod') {
        def.areaOfEffect = TIERS.basic.areaOfEffect;
        def.energyFactor = TIERS.basic.energyFactor;
        def.barWidth = TIERS[tier].barWidth;
      }
      // A bought tool carries a price and no rung above it; a forged one
      // carries the rung and no price — with one deliberate exception. The
      // rod is bought at the counter at its first rung and forged from there,
      // because taking fishing up is a purchase and getting better at it is
      // not. Nothing else is ever both.
      const price = base.price?.[tier];
      if (price !== undefined) def.buyPrice = price;
      if (next && base.forged !== false) {
        def.upgradesTo = toolIdFor(base.id, next);
        def.upgradeCost = TIERS[next].cost;
        const bars = TIERS[next].bars;
        if (bars) def.upgradeBars = bars;
      }
      rows[id] = def;
    });
  }
  return rows;
}

/**
 * Every tool row, as a base and a tier.
 *
 * Exported because the icon table has to draw exactly the tools that exist:
 * walking the four tiers blindly would invent a copper scythe nobody can hold.
 */
export const TOOL_ROWS: ReadonlyArray<{ id: ItemId; base: ItemId; tier: ToolTier }> =
  TOOL_BASES.flatMap((base) =>
    tiersOf(base).map((tier) => ({ id: toolIdFor(base.id, tier), base: base.id, tier })),
  );

/**
 * What the ground gives up, which is the half of the economy the field never
 * touched.
 *
 * Note what these rows do **not** carry: `produce`. That flag is what the
 * market's one-press sale sweeps out of the satchel, and a trip to the stall
 * that quietly sold the twenty planks you were saving for a coop is the worst
 * kind of bug — the kind that looks like a feature until somebody notices.
 * They keep a `sellPrice` because they are worth something and spec 11 will
 * want the number; nothing collects it yet, and that is deliberate.
 */
const MATERIALS: ReadonlyArray<{ id: ItemId; label: string; price: number; blurb: string }> = [
  { id: 'wood', label: 'Gỗ', price: 4, blurb: 'Thứ dựng nên nhà kho, rồi sau đó là hàng rào.' },
  {
    id: 'hardwood',
    label: 'Gỗ cứng',
    price: 30,
    blurb: 'Thớ chặt như đá. Chỉ gốc cây già mới cho thứ này.',
  },
  { id: 'stone', label: 'Đá', price: 3, blurb: 'Móng nhà, lối đi, và mọi thứ phải đứng lâu.' },
  {
    id: 'coal',
    label: 'Than',
    price: 50,
    blurb: 'Thứ làm lò rèn nóng lên. Đôi khi rơi ra từ một tảng đá vỡ.',
  },
  { id: 'fiber', label: 'Sợi', price: 2, blurb: 'Cỏ dại phơi khô. Rẻ, và có mặt trong nửa số công thức.' },
  {
    id: 'sap',
    label: 'Nhựa cây',
    price: 12,
    blurb: 'Dính, hăng, và hữu dụng hơn vẻ ngoài của nó.',
  },
  // What the mine gives up, band by band (spec 13). The ore is sold raw for
  // little because the bar it smelts into is where the value is.
  { id: 'copper-ore', label: 'Quặng đồng', price: 5, blurb: 'Đào ở những tầng mỏ nông. Nấu thành đồng thỏi.' },
  { id: 'iron-ore', label: 'Quặng sắt', price: 10, blurb: 'Từ tầng 10 trở xuống. Nặng tay và lạnh.' },
  { id: 'gold-ore', label: 'Quặng vàng', price: 25, blurb: 'Từ tầng 20 trở xuống, lấp lánh trong đá tối.' },
  { id: 'gem', label: 'Ngọc thô', price: 120, blurb: 'Chỉ đáy mỏ mới có. Chưa mài mà đã sáng.' },
  // Spec 16: what the furnace makes and the anvil wants. Priced a little above
  // five ore and a lump of coal, so smelting to sell is worth a trip and never
  // a mint: 25g of copper ore and 50g of coal come out at 90g.
  {
    id: 'copper-bar',
    label: 'Đồng thỏi',
    price: 90,
    blurb: 'Năm cục quặng đồng và một hòn than, qua một đêm trong lò nấu.',
  },
  { id: 'iron-bar', label: 'Sắt thỏi', price: 150, blurb: 'Nấu từ quặng sắt. Thứ làm nên mọi đồ thép.' },
  { id: 'gold-bar', label: 'Vàng thỏi', price: 300, blurb: 'Nấu từ quặng vàng. Nặng tay hơn vẻ ngoài của nó.' },
];

function materialRows(): Record<ItemId, ItemDef> {
  const rows: Record<ItemId, ItemDef> = {};
  for (const material of MATERIALS) {
    rows[material.id] = {
      id: material.id,
      label: material.label,
      texture: `item-${material.id}`,
      stackSize: DEFAULT_STACK_SIZE,
      sellPrice: material.price,
      blurb: material.blurb,
    };
  }
  return rows;
}

/**
 * The twelve things the year puts out, three to a season.
 *
 * Here rather than in `resources.ts` for the same reason the animals' produce
 * is here: the item table must not depend on the systems that name its rows.
 * `resources.ts` reads this and decides where they grow; this decides what
 * they are and what they are worth.
 *
 * They carry `produce`, unlike the materials above — a basket of mushrooms is
 * exactly what the market counter is for, and every one of them is giftable
 * without a line being added to anybody's gift table.
 */
export interface ForageDef {
  id: ItemId;
  label: string;
  season: Season;
  price: number;
  blurb: string;
}

export const FORAGE_DEFS: readonly ForageDef[] = [
  {
    id: 'wild-leek',
    label: 'Hành rừng',
    season: 'Spring',
    price: 60,
    blurb: 'Mọc ở bờ giậu trước khi bất cứ thứ gì được gieo.',
  },
  {
    id: 'daffodil',
    label: 'Thuỷ tiên',
    season: 'Spring',
    price: 40,
    blurb: 'Dấu hiệu đầu tiên của mùa xuân, và món quà rẻ nhất mà vẫn được lòng.',
  },
  {
    id: 'wild-greens',
    label: 'Rau dại',
    season: 'Spring',
    price: 50,
    blurb: 'Đắng và xanh. Juniper sống qua cả mùa xuân bằng thứ này.',
  },
  {
    id: 'poppy',
    label: 'Anh túc',
    season: 'Summer',
    price: 100,
    blurb: 'Đỏ đến chói mắt giữa một cánh đồng cháy nắng.',
  },
  {
    id: 'wild-grape',
    label: 'Nho rừng',
    season: 'Summer',
    price: 80,
    blurb: 'Nhỏ, chua, và mọc ở nơi không ai trồng được gì.',
  },
  {
    id: 'buttercup',
    label: 'Mao lương',
    season: 'Summer',
    price: 70,
    blurb: 'Vàng óng. Trẻ con trong làng soi nó dưới cằm nhau.',
  },
  {
    id: 'purple-mushroom',
    label: 'Nấm tím',
    season: 'Autumn',
    price: 160,
    blurb: 'Thứ đắt nhất một buổi đi bộ có thể mang về.',
  },
  {
    id: 'wild-daisy',
    label: 'Cúc dại',
    season: 'Autumn',
    price: 55,
    blurb: 'Nở muộn và bướng bỉnh, ngay trước đợt sương đầu.',
  },
  {
    id: 'chestnut',
    label: 'Hạt dẻ',
    season: 'Autumn',
    price: 90,
    blurb: 'Rụng dưới gốc cây. Nhặt thì dễ, tìm mới khó.',
  },
  {
    id: 'winter-root',
    label: 'Rễ đông',
    season: 'Winter',
    price: 70,
    blurb: 'Nằm dưới tuyết, chờ ai đủ kiên nhẫn để bới.',
  },
  {
    id: 'snow-yam',
    label: 'Cải tuyết',
    season: 'Winter',
    price: 100,
    blurb: 'Ngọt hơn sau một đêm buốt giá. Không ai biết tại sao.',
  },
  {
    id: 'quartz',
    label: 'Thạch anh',
    season: 'Winter',
    price: 120,
    blurb: 'Mọc lên từ đất cứng như một thứ gì đó đang lớn.',
  },
];

function forageRows(): Record<ItemId, ItemDef> {
  const rows: Record<ItemId, ItemDef> = {};
  for (const forage of FORAGE_DEFS) {
    rows[forage.id] = {
      id: forage.id,
      label: forage.label,
      texture: `item-${forage.id}`,
      stackSize: DEFAULT_STACK_SIZE,
      sellPrice: forage.price,
      produce: true,
      blurb: forage.blurb,
    };
  }
  return rows;
}

/** Which three things a season puts out, read off the table above. */
export const FORAGE_BY_SEASON: Record<Season, readonly ItemId[]> = {
  Spring: FORAGE_DEFS.filter((row) => row.season === 'Spring').map((row) => row.id),
  Summer: FORAGE_DEFS.filter((row) => row.season === 'Summer').map((row) => row.id),
  Autumn: FORAGE_DEFS.filter((row) => row.season === 'Autumn').map((row) => row.id),
  Winter: FORAGE_DEFS.filter((row) => row.season === 'Winter').map((row) => row.id),
};

export const FORAGE_IDS: readonly ItemId[] = FORAGE_DEFS.map((row) => row.id);

export function isForageItem(item: ItemId): boolean {
  return FORAGE_IDS.includes(item);
}

/**
 * How a fish moves on the bar, which is the whole of what makes one species
 * feel unlike another once it is on the line.
 *
 * Four rather than a speed number, because speed alone makes every fish the
 * same fish at a different tempo. A darter and a sinker at the same difficulty
 * ask two different things of the player: one wants anticipation, the other
 * wants a steady hand held low.
 */
export type FishMotion = 'smooth' | 'darter' | 'sinker' | 'floater';

/**
 * One species, and everything about it that is not already an `ItemDef`.
 *
 * The same shape `CROP_DEFINITIONS` and `FORAGE_DEFS` take, and here for the
 * same reason they are: the item table must not import the system that names
 * its rows. This decides what a fish *is*; `fishing.ts` decides what happens
 * when one is on the line.
 *
 * The rule this table exists to enforce is that **conditions are not shared
 * out evenly**. A species that only shows up in the rain, in winter, after
 * eight at night is one a player remembers catching. Eighteen species that
 * bite whenever you cast is one species printed eighteen times.
 */
export interface FishDef {
  id: ItemId;
  label: string;
  /** Which seasons it is in the water at all. */
  seasons: readonly Season[];
  /** The skies it bites under, or null for any of them. */
  weather: readonly Weather[] | null;
  /**
   * The window it bites in, as hours since midnight of the day that began.
   *
   * The day runs from 6 to 26 — see `DAY_END` in `time.ts` — so an evening
   * fish is `fromHour: 20, toHour: 26` and never has to wrap around midnight.
   * That is what keeps the comparison in `biteWindow` two `<=` and no cases.
   */
  fromHour: number;
  toHour: number;
  /** Which waters. A species is usually in one of them. */
  areas: readonly AreaId[];
  /** 1-10. How fast and how erratically it runs once hooked. */
  difficulty: number;
  motion: FishMotion;
  /** Centimetres, for the card the catch is shown on. Flavour, and only that. */
  minSize: number;
  maxSize: number;
  sellPrice: number;
  blurb: string;
}

/** All four, read off the year rather than listed again beside it. */
const ALL_SEASONS: readonly Season[] = SEASONS;

/** The skies that count as wet, for the rows that want a rainy day. */
const RAINY: readonly Weather[] = ['Drizzle', 'Firefly Shower'];

/**
 * The eighteen, plus the three the pond gives you instead.
 *
 * Read down the `seasons`, `weather` and hour columns rather than the prices:
 * that is where the design is. Every season has something cheap that is always
 * there and something dear that is not, each of the three waters has fish the
 * other two do not, and four rows want weather. The moonfish is the one at the
 * bottom of it all — one water, one sky, four hours a night — and it is worth
 * more than a day of anything else on purpose.
 */
export const FISH_DEFS: readonly FishDef[] = [
  // --- the ones that are always there --------------------------------------
  {
    id: 'carp',
    label: 'Cá chép',
    seasons: ALL_SEASONS,
    weather: null,
    fromHour: 6,
    toHour: 26,
    areas: ['forest'],
    difficulty: 1,
    motion: 'sinker',
    minSize: 22,
    maxSize: 58,
    sellPrice: 35,
    blurb: 'Lì lợm và có mặt quanh năm. Con cá đầu tiên của tất cả mọi người.',
  },
  {
    id: 'chub',
    label: 'Cá chày',
    seasons: ALL_SEASONS,
    weather: null,
    fromHour: 6,
    toHour: 26,
    areas: ['forest', 'farm'],
    difficulty: 2,
    motion: 'smooth',
    minSize: 18,
    maxSize: 44,
    sellPrice: 45,
    blurb: 'Bơi thành đàn ngay dưới mặt nước. Dễ thấy, dễ bắt.',
  },
  {
    id: 'bream',
    label: 'Cá vền',
    seasons: ALL_SEASONS,
    weather: null,
    fromHour: 18,
    toHour: 26,
    areas: ['village'],
    difficulty: 3,
    motion: 'floater',
    minSize: 20,
    maxSize: 50,
    sellPrice: 75,
    blurb: 'Lên ăn lúc chạng vạng. Trước sáu giờ tối thì đừng mất công.',
  },

  // --- spring ---------------------------------------------------------------
  {
    id: 'sunfish',
    label: 'Cá mặt trời',
    seasons: ['Spring', 'Summer'],
    weather: null,
    fromHour: 6,
    toHour: 19,
    areas: ['village'],
    difficulty: 2,
    motion: 'smooth',
    minSize: 12,
    maxSize: 30,
    sellPrice: 60,
    blurb: 'Vàng rực và tròn như đồng xu. Chỉ ra mặt khi trời còn sáng.',
  },
  {
    id: 'smallmouth-bass',
    label: 'Cá vược miệng nhỏ',
    seasons: ['Spring', 'Autumn'],
    weather: RAINY,
    fromHour: 6,
    toHour: 26,
    areas: ['farm'],
    difficulty: 3,
    motion: 'smooth',
    minSize: 24,
    maxSize: 55,
    sellPrice: 90,
    blurb: 'Ao nông trại chỉ có cá vào những ngày mưa. Đó là toàn bộ bí mật.',
  },
  {
    id: 'catfish',
    label: 'Cá trê',
    seasons: ['Spring', 'Autumn'],
    weather: RAINY,
    fromHour: 6,
    toHour: 24,
    areas: ['village'],
    difficulty: 7,
    motion: 'darter',
    minSize: 40,
    maxSize: 95,
    sellPrice: 220,
    blurb: 'Nước đục thì nó dạn. Kéo một cái là chạy, và chạy rất khoẻ.',
  },

  // --- summer ---------------------------------------------------------------
  {
    id: 'rainbow-trout',
    label: 'Cá hồi vân',
    seasons: ['Summer'],
    weather: ['Sunny', 'Breezy'],
    fromHour: 6,
    toHour: 19,
    areas: ['village'],
    difficulty: 5,
    motion: 'darter',
    minSize: 25,
    maxSize: 60,
    sellPrice: 120,
    blurb: 'Nắng lên mới thấy sườn nó ánh lên bảy màu. Mưa thì trốn biệt.',
  },
  {
    id: 'red-mullet',
    label: 'Cá phèn',
    seasons: ['Summer', 'Winter'],
    weather: null,
    fromHour: 6,
    toHour: 19,
    areas: ['village'],
    difficulty: 4,
    motion: 'smooth',
    minSize: 20,
    maxSize: 42,
    sellPrice: 110,
    blurb: 'Hai sợi râu dưới cằm, sục bùn tìm ăn suốt ngày.',
  },
  {
    id: 'pike',
    label: 'Cá măng',
    seasons: ['Summer', 'Winter'],
    weather: null,
    fromHour: 6,
    toHour: 26,
    areas: ['forest'],
    difficulty: 6,
    motion: 'darter',
    minSize: 45,
    maxSize: 110,
    sellPrice: 180,
    blurb: 'Nằm im trong đám rong rồi lao ra. Trên dây câu cũng y như vậy.',
  },
  {
    id: 'sturgeon',
    label: 'Cá tầm',
    seasons: ['Summer', 'Winter'],
    weather: null,
    fromHour: 6,
    toHour: 19,
    areas: ['farm'],
    difficulty: 8,
    motion: 'sinker',
    minSize: 60,
    maxSize: 180,
    sellPrice: 300,
    blurb: 'Nặng, chậm, và luôn tìm đường xuống đáy. Giữ ô vuông thấp.',
  },

  // --- autumn ---------------------------------------------------------------
  {
    id: 'salmon',
    label: 'Cá hồi',
    seasons: ['Autumn'],
    weather: null,
    fromHour: 6,
    toHour: 19,
    areas: ['village'],
    difficulty: 5,
    motion: 'smooth',
    minSize: 50,
    maxSize: 120,
    sellPrice: 150,
    blurb: 'Ngược dòng về thượng nguồn mỗi mùa thu, đúng một lần trong đời.',
  },
  {
    id: 'tilapia',
    label: 'Cá rô phi',
    seasons: ['Autumn'],
    weather: null,
    fromHour: 6,
    toHour: 14,
    areas: ['farm'],
    difficulty: 4,
    motion: 'floater',
    minSize: 20,
    maxSize: 48,
    sellPrice: 95,
    blurb: 'Ăn vào buổi sáng rồi thôi. Qua hai giờ chiều là ao lặng như tờ.',
  },
  {
    id: 'walleye',
    label: 'Cá vược vàng',
    seasons: ['Autumn', 'Winter'],
    weather: RAINY,
    fromHour: 12,
    toHour: 26,
    areas: ['forest'],
    difficulty: 6,
    motion: 'sinker',
    minSize: 35,
    maxSize: 80,
    sellPrice: 180,
    blurb: 'Mắt nó ăn đèn. Trời càng xấu, nó càng lên gần bờ.',
  },
  {
    id: 'eel',
    label: 'Cá chình',
    seasons: ['Autumn'],
    weather: RAINY,
    fromHour: 16,
    toHour: 26,
    areas: ['village'],
    difficulty: 7,
    motion: 'darter',
    minSize: 55,
    maxSize: 130,
    sellPrice: 200,
    blurb: 'Dài, trơn, và không chịu đi thẳng lấy một giây.',
  },

  // --- winter ---------------------------------------------------------------
  {
    id: 'perch',
    label: 'Cá rô',
    seasons: ['Winter'],
    weather: null,
    fromHour: 6,
    toHour: 26,
    areas: ['farm', 'village'],
    difficulty: 3,
    motion: 'smooth',
    minSize: 15,
    maxSize: 38,
    sellPrice: 65,
    blurb: 'Tháng Chạp mặt ao vắng tanh, trừ đám này. Vạch sọc, bướng bỉnh.',
  },
  {
    id: 'lingcod',
    label: 'Cá tuyết xanh',
    seasons: ['Winter'],
    weather: null,
    fromHour: 6,
    toHour: 19,
    areas: ['forest'],
    difficulty: 8,
    motion: 'darter',
    minSize: 50,
    maxSize: 140,
    sellPrice: 260,
    blurb: 'Thịt xanh lơ đến khó tin. Mùa đông trong rừng chỉ có nó đáng giá.',
  },
  {
    id: 'midnight-carp',
    label: 'Cá chép đêm',
    seasons: ['Autumn', 'Winter'],
    weather: null,
    fromHour: 22,
    toHour: 26,
    areas: ['forest', 'farm'],
    difficulty: 6,
    motion: 'sinker',
    minSize: 30,
    maxSize: 70,
    sellPrice: 210,
    blurb: 'Đen như mặt nước lúc không trăng. Chỉ nổi sau mười giờ đêm.',
  },
  {
    id: 'moonfish',
    label: 'Cá trăng',
    seasons: ALL_SEASONS,
    weather: ['Firefly Shower'],
    fromHour: 20,
    toHour: 26,
    areas: ['farm'],
    difficulty: 9,
    motion: 'floater',
    minSize: 28,
    maxSize: 66,
    sellPrice: 400,
    blurb: 'Chỉ có trong đêm mưa đom đóm, và chỉ ở ao nhà. Cả năm được vài lần.',
  },
];

/**
 * What the water gives you when it is not giving you a fish.
 *
 * Difficulty 1 and nought gold, which is the whole point of the rows existing:
 * without something to fail into, every cast is a win and the bar is a
 * formality. They are in the same table and go through the same draw, so
 * nothing in `fishing.ts` has to know they are different.
 */
export const TRASH_DEFS: readonly FishDef[] = [
  {
    id: 'seaweed',
    label: 'Rong',
    seasons: ALL_SEASONS,
    weather: null,
    fromHour: 6,
    toHour: 26,
    areas: ['farm', 'village', 'forest'],
    difficulty: 1,
    motion: 'floater',
    minSize: 10,
    maxSize: 40,
    sellPrice: 0,
    blurb: 'Một nắm rong ướt. Không ai mua, và cũng chẳng vứt đi được.',
  },
  {
    id: 'rusty-can',
    label: 'Lon rỉ',
    seasons: ALL_SEASONS,
    weather: null,
    fromHour: 6,
    toHour: 26,
    areas: ['farm', 'village', 'forest'],
    difficulty: 1,
    motion: 'sinker',
    minSize: 8,
    maxSize: 12,
    sellPrice: 0,
    blurb: 'Ai đó đã ném nó xuống đây từ lâu lắm rồi.',
  },
  {
    id: 'old-boot',
    label: 'Giày cũ',
    seasons: ALL_SEASONS,
    weather: null,
    fromHour: 6,
    toHour: 26,
    areas: ['farm', 'village', 'forest'],
    difficulty: 1,
    motion: 'sinker',
    minSize: 24,
    maxSize: 30,
    sellPrice: 0,
    blurb: 'Một chiếc. Chiếc còn lại chắc vẫn ở dưới đó.',
  },
];

/** Every row the water can produce, fish and rubbish alike, in one list. */
export const ALL_FISH_DEFS: readonly FishDef[] = [...FISH_DEFS, ...TRASH_DEFS];

export const FISH_BOOK: Record<ItemId, FishDef> = Object.fromEntries(
  ALL_FISH_DEFS.map((row) => [row.id, row]),
);

export const FISH_IDS: readonly ItemId[] = ALL_FISH_DEFS.map((row) => row.id);

export function isFishItem(item: ItemId): boolean {
  return Object.hasOwn(FISH_BOOK, item);
}

export function fishDef(item: ItemId): FishDef | null {
  return FISH_BOOK[item] ?? null;
}

/**
 * A fish as a thing in the satchel.
 *
 * They carry `produce`, like the forage and unlike the timber: a basket of
 * trout is exactly what the market counter is for, and one press at the stall
 * emptying the day's catch is the trip the evening was for. The rubbish
 * carries it too, at nought gold — which is the counter quietly tidying the
 * satchel rather than a sale, and is better than making the player find the
 * boot and work out how to be rid of it.
 */
function fishRows(): Record<ItemId, ItemDef> {
  const rows: Record<ItemId, ItemDef> = {};
  for (const fish of ALL_FISH_DEFS) {
    rows[fish.id] = {
      id: fish.id,
      label: fish.label,
      texture: `item-${fish.id}`,
      stackSize: DEFAULT_STACK_SIZE,
      sellPrice: fish.sellPrice,
      produce: true,
      blurb: fish.blurb,
    };
  }
  return rows;
}

/**
 * Every crop, in a fixed order.
 *
 * Fixed because migrations pack an old save's produce into slots by walking
 * this list: reordering it would move a returning player's turnips. Adding to
 * the end is safe; inserting in the middle is not. Removing spec 17's two
 * winter crops from the middle was safe only because no migration older than
 * v12 ever packed a winter crop into slots — the v2 satchel migration
 * predates both.
 */
export const CROP_ORDER: readonly CropId[] = [
  'turnip',
  'clover',
  'strawberry',
  'rhubarb',
  'wheat',
  'sunflower',
  'tomato',
  'melon',
  'barley',
  'cranberry',
  'pumpkin',
  // Spec 15's. At the end, for the reason above.
  'nep',
  'dau-xanh',
];

/**
 * The things spec 11 lets a player build and put down on the ground.
 *
 * These ids are *both* an item and a kind of placeable, deliberately: the
 * thing in the satchel and the thing standing in the field are the same noun,
 * so `placeItem` takes an item id and `pickUpItem` gives the same one back.
 * `placeables.ts` decides how each behaves; this decides what it is, which is
 * the same split `animals.ts` and `resources.ts` already take with their rows.
 */
export type ChestKind = 'chest' | 'big-chest';

/** The five machines. A kind here is a row in `MACHINE_DEFS` over there. */
export type MachineKind = 'keg' | 'jar' | 'churn' | 'kiln' | 'furnace';

export type SprinklerKind = 'sprinkler' | 'quality-sprinkler';

/** Everything that can stand on a tile because somebody put it there. */
export type PlaceableKind =
  | ChestKind
  | MachineKind
  | SprinklerKind
  | 'torch'
  | 'wood-fence'
  | 'stone-fence'
  | 'hardwood-fence'
  | 'wood-path'
  | 'stone-path'
  | 'gravel-path';

interface PlaceableRow {
  id: PlaceableKind;
  label: string;
  blurb: string;
}

/**
 * One row each, and no prices.
 *
 * `sellPrice` is nought on every one of them on purpose. A keg is forty-five
 * planks and a morning; handing it to the stallholder for a handful of coin
 * because it happened to be in the satchel on a market run is a way to lose it
 * that no amount of confirmation makes feel deliberate. They are crafted, put
 * down, and picked back up — never sold.
 */
const PLACEABLE_ROWS: readonly PlaceableRow[] = [
  {
    id: 'chest',
    label: 'Rương',
    blurb: 'Ba mươi sáu ô, đứng yên một chỗ, và của chung cả nông trại.',
  },
  {
    id: 'big-chest',
    label: 'Rương lớn',
    blurb: 'Gấp đôi cái thường. Thứ bạn dựng khi nhà kho đã chật.',
  },
  {
    id: 'keg',
    label: 'Thùng ủ',
    blurb: 'Bảy ngày, và một quả bí thành một chai đáng ba lần nó.',
  },
  {
    id: 'jar',
    label: 'Lọ ngâm',
    blurb: 'Ba ngày. Lãi ít hơn thùng ủ, nhưng quay vòng nhanh gấp đôi.',
  },
  {
    id: 'churn',
    label: 'Máy vắt',
    blurb: 'Sữa vào, phô mai ra, hai ngày một mẻ.',
  },
  {
    id: 'kiln',
    label: 'Lò than',
    blurb: 'Mười khúc gỗ thành một hòn than, qua một đêm.',
  },
  {
    id: 'furnace',
    label: 'Lò nấu',
    blurb: 'Năm cục quặng và một hòn than, qua một đêm thành một thỏi.',
  },
  {
    id: 'sprinkler',
    label: 'Ống tưới',
    blurb: 'Tưới bốn ô kề nó mỗi sáng, trước khi cây kịp lớn. Không tốn sức.',
  },
  {
    id: 'quality-sprinkler',
    label: 'Ống tưới chất lượng',
    blurb: 'Tám ô quanh nó. Thứ biến một buổi sáng tưới thành một cú bấm.',
  },
  {
    id: 'torch',
    label: 'Đuốc',
    blurb: 'Không làm gì ngoài việc cháy. Đôi khi thế là đủ.',
  },
  {
    id: 'wood-fence',
    label: 'Hàng rào gỗ',
    blurb: 'Chắn đường đi. Dựng để chia ruộng, hoặc để giữ bò lại một chỗ.',
  },
  {
    id: 'stone-fence',
    label: 'Hàng rào đá',
    blurb: 'Như rào gỗ, và trông ra dáng lâu dài hơn.',
  },
  {
    id: 'hardwood-fence',
    label: 'Hàng rào gỗ cứng',
    blurb: 'Đắt nhất trong ba loại, và đẹp nhất.',
  },
  {
    id: 'wood-path',
    label: 'Đường ván',
    blurb: 'Đi được, và không thứ gì mọc lên trên nó qua đêm.',
  },
  {
    id: 'stone-path',
    label: 'Đường lát đá',
    blurb: 'Đi được, và giữ cho một lối đi mãi là lối đi.',
  },
  {
    id: 'gravel-path',
    label: 'Đường sỏi',
    blurb: 'Rẻ nhất, và làm đúng một việc như hai cái kia.',
  },
];

export const PLACEABLE_KINDS: readonly PlaceableKind[] = PLACEABLE_ROWS.map((row) => row.id);

export function isPlaceableItem(id: ItemId): id is PlaceableKind {
  return (PLACEABLE_KINDS as readonly string[]).includes(id);
}

function placeableRows(): Record<ItemId, ItemDef> {
  const rows: Record<ItemId, ItemDef> = {};
  for (const row of PLACEABLE_ROWS) {
    rows[row.id] = {
      id: row.id,
      label: row.label,
      texture: `item-${row.id}`,
      stackSize: DEFAULT_STACK_SIZE,
      sellPrice: 0,
      blurb: row.blurb,
    };
  }
  return rows;
}

// --- what the machines make --------------------------------------------------

/**
 * Which shelf of the cellar a crop belongs on.
 *
 * The one judgement call in the artisan table, and it is culinary rather than
 * botanical: a tomato goes in with the fruit here because the alternative is
 * explaining to a player why their tomato made juice and their melon made
 * wine. Grains ferment and do not preserve, which is why the jar turns down
 * wheat — the only refusal in the table that is about the input rather than
 * about the machine.
 */
type ArtisanClass = 'fruit' | 'vegetable' | 'grain';

const CROP_CLASS: Record<CropId, ArtisanClass> = {
  turnip: 'vegetable',
  clover: 'vegetable',
  strawberry: 'fruit',
  rhubarb: 'fruit',
  wheat: 'grain',
  sunflower: 'vegetable',
  tomato: 'fruit',
  melon: 'fruit',
  barley: 'grain',
  cranberry: 'fruit',
  pumpkin: 'vegetable',
  nep: 'grain',
  'dau-xanh': 'vegetable',
};

/** The word that goes in front, and what it multiplies the input price by. */
interface ArtisanProduct {
  prefix: string;
  label: string;
  factor: number;
}

/**
 * What each machine does to each class of input.
 *
 * An absent entry is a refusal, which is how the jar comes to turn down wheat
 * without a single `if` anywhere outside this table.
 */
const ARTISAN_PRODUCTS: Record<'keg' | 'jar', Partial<Record<ArtisanClass, ArtisanProduct>>> = {
  keg: {
    fruit: { prefix: 'wine', label: 'Rượu', factor: 3 },
    vegetable: { prefix: 'juice', label: 'Nước ép', factor: 3 },
    grain: { prefix: 'beer', label: 'Bia', factor: 3 },
  },
  jar: {
    fruit: { prefix: 'jam', label: 'Mứt', factor: 2.2 },
    vegetable: { prefix: 'pickle', label: 'Dưa muối', factor: 2.2 },
  },
};

const CHURN_PRODUCT: ArtisanProduct = { prefix: 'cheese', label: 'Phô mai', factor: 1.9 };

/** The two things a churn will take, at any grade. */
const MILK_BASES: readonly ItemId[] = ['milk', 'goat-milk'];

function isMilk(input: ItemId): boolean {
  return MILK_BASES.some((base) => input === base || input.startsWith(`${base}-`));
}

function artisanProduct(input: ItemId, machine: MachineKind): ArtisanProduct | null {
  if (machine === 'churn') return isMilk(input) ? CHURN_PRODUCT : null;
  // The kiln and the furnace make materials that already exist — coal, bars —
  // so there is no artisan row for either of them to generate.
  if (machine !== 'keg' && machine !== 'jar') return null;
  const crop = CROP_ORDER.find((id) => (id as ItemId) === input);
  return crop ? (ARTISAN_PRODUCTS[machine][CROP_CLASS[crop]] ?? null) : null;
}

/** The machine names, for the blurbs the rows below carry. */
const MACHINE_LABELS: Record<MachineKind, string> = {
  keg: 'Thùng ủ',
  jar: 'Lọ ngâm',
  churn: 'Máy vắt',
  kiln: 'Lò than',
  furnace: 'Lò nấu',
};

/** Every input any machine might be offered, which is what the rows walk. */
export const ARTISAN_INPUTS: readonly ItemId[] = [
  ...CROP_ORDER.map((crop) => crop as ItemId),
  ...MILK_BASES.flatMap((base) => PRODUCE_GRADES.map((grade) => gradedIdFor(base, grade))),
];

export const ARTISAN_MACHINES: readonly MachineKind[] = ['keg', 'jar', 'churn', 'kiln'];

/**
 * The `ItemDef` a machine would make out of an input, built on the spot.
 *
 * Thirteen crops times two machines plus six milks is thirty-two rows, and
 * thirty-two hand-typed rows is thirty-two chances to price something wrong.
 * The id is a convention — `wine-melon`, `jam-strawberry`, `cheese-milk-fine`
 * — and the price is the input's, multiplied. Null when the machine will not
 * take it, which is the same answer the player gets at the hopper.
 *
 * `source` is looked up in the partial table this is called from rather than
 * in `ITEMS`, because that is exactly what is being built when it runs.
 */
function artisanItemFor(
  source: ItemDef | undefined,
  input: ItemId,
  machine: MachineKind,
): ItemDef | null {
  const product = artisanProduct(input, machine);
  if (!product || !source) return null;
  const id = `${product.prefix}-${input}`;
  return {
    id,
    label: `${product.label} ${source.label.toLowerCase()}`,
    texture: `item-${product.prefix}`,
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: Math.round(source.sellPrice * product.factor),
    produce: true,
    blurb: `${source.label} sau một lượt qua ${MACHINE_LABELS[machine].toLowerCase()}.`,
  };
}

/**
 * Every artisan row, from the crop and produce rows already in the table.
 *
 * Handed the rows built so far rather than reading `ITEMS`, because `ITEMS` is
 * the object this is a spread inside: reaching for it here would find
 * `undefined` and price every bottle at nothing.
 */
function artisanRows(base: Record<ItemId, ItemDef>): Record<ItemId, ItemDef> {
  const rows: Record<ItemId, ItemDef> = {};
  for (const machine of ARTISAN_MACHINES) {
    for (const input of ARTISAN_INPUTS) {
      const def = artisanItemFor(base[input], input, machine);
      if (def) rows[def.id] = def;
    }
  }
  return rows;
}

/** What a machine would make of an input, once the table is built. */
export function artisanOutputFor(input: ItemId, machine: MachineKind): ItemId | null {
  const product = artisanProduct(input, machine);
  return product ? `${product.prefix}-${input}` : null;
}

/**
 * The one weapon, for now.
 *
 * Not a row in `TOOL_BASES`, because the blacksmith's ladder buys reach and
 * energy and a sword has neither: it hits a fan in front of you and costs
 * nothing to swing (spec 13, the same reason the scythe is free). Better
 * swords are a column of `damage`, not a tier.
 */
/**
 * The swords, one for each band of the mine.
 *
 * Not rows in `TOOL_BASES`, because the blacksmith's ladder buys reach and
 * energy and a sword has neither: it hits a fan in front of you and costs
 * nothing to swing (spec 13, the same reason the scythe is free). Better
 * swords are a column of `damage`, not a tier, and they are crafted from bars
 * rather than forged (spec 16).
 */
const WEAPON_ROWS: Record<ItemId, ItemDef> = Object.fromEntries(
  (
    [
      ['rusty-sword', 'Kiếm gỉ', 10, 'Cùn, nhưng vẫn đủ để một con sên nghĩ lại.'],
      ['copper-sword', 'Kiếm đồng', 20, 'Hai nhát cho một con dơi. Thứ làm tầng mười đi được.'],
      ['steel-sword', 'Kiếm thép', 35, 'Đủ nặng để một con ma phải tan sau ba nhát.'],
      ['gold-sword', 'Kiếm vàng', 60, 'Thứ duy nhất đáy mỏ phải nể.'],
    ] as const
  ).map(([id, label, damage, blurb]) => [
    id,
    { id, label, texture: `item-${id}`, stackSize: 1, tool: 'sword', damage, sellPrice: 0, blurb },
  ]),
);

const BASE_ITEMS: Record<ItemId, ItemDef> = {
  ...toolRows(),
  ...WEAPON_ROWS,
  ...produceRows(),
  'turnip-seeds': {
    id: 'turnip-seeds',
    label: 'Hạt củ cải',
    texture: 'item-turnip-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'turnip',
    sellPrice: 0,
    buyPrice: 6,
    blurb: 'Hai ngày tưới là có củ cải. Cách rẻ nhất để mở màn một mùa.',
  },
  turnip: {
    id: 'turnip',
    label: 'Củ cải',
    texture: 'item-turnip',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 18,
    produce: true,
    blurb: 'Cay nồng và thật thà. Rowan đang gom chúng.',
  },
  'clover-seeds': {
    id: 'clover-seeds',
    label: 'Hạt cỏ ba lá',
    texture: 'item-clover-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'clover',
    sellPrice: 0,
    buyPrice: 4,
    blurb: 'Bán chẳng được bao nhiêu. Vẫn đáng trồng, khi đã có gia súc để nuôi.',
  },
  clover: {
    id: 'clover',
    label: 'Cỏ ba lá',
    texture: 'item-clover',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 9,
    produce: true,
    blurb: 'Cỏ ngọt. Đáng giữ lại khi đã có chuồng để chứa.',
  },
  'strawberry-seeds': {
    id: 'strawberry-seeds',
    label: 'Hạt dâu tây',
    texture: 'item-strawberry-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'strawberry',
    sellPrice: 0,
    buyPrice: 34,
    blurb: 'Đắt, và lâu bén rễ. Rồi cứ ba ngày lại ra quả cho đến hết xuân.',
  },
  strawberry: {
    id: 'strawberry',
    label: 'Dâu tây',
    texture: 'item-strawberry',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 28,
    produce: true,
    blurb: 'Cả làng trả giá cao cho thứ này.',
  },
  'rhubarb-seeds': {
    id: 'rhubarb-seeds',
    label: 'Gốc đại hoàng',
    texture: 'item-rhubarb-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'rhubarb',
    sellPrice: 0,
    buyPrice: 24,
    blurb: 'Sáu ngày dưới đất, và là món hời nhất của mùa xuân.',
  },
  rhubarb: {
    id: 'rhubarb',
    label: 'Đại hoàng',
    texture: 'item-rhubarb',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 74,
    produce: true,
    blurb: 'Chua đến ê cả quai hàm. Quán trọ mua sạch từng cọng.',
  },
  'wheat-seeds': {
    id: 'wheat-seeds',
    label: 'Hạt lúa mì',
    texture: 'item-wheat-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'wheat',
    sellPrice: 0,
    buyPrice: 8,
    blurb: 'Lớn suốt hạ rồi sang thu, chẳng bận tâm lúc giao mùa.',
  },
  wheat: {
    id: 'wheat',
    label: 'Lúa mì',
    texture: 'item-wheat',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 20,
    produce: true,
    blurb: 'Ba ngày từ hạt thành bó. Làm bánh, nấu bia, hay lợp mái.',
  },
  'sunflower-seeds': {
    id: 'sunflower-seeds',
    label: 'Hạt hướng dương',
    texture: 'item-sunflower-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'sunflower',
    sellPrice: 0,
    buyPrice: 12,
    blurb: 'Lời lãi chẳng đáng, nhưng cao hai mét rưỡi và thơm mùi tháng Tám.',
  },
  sunflower: {
    id: 'sunflower',
    label: 'Hướng dương',
    texture: 'item-sunflower',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 22,
    produce: true,
    blurb: 'Ép lấy dầu, hoặc đem cho. Chẳng ai trồng thứ này vì tiền.',
  },
  'tomato-seeds': {
    id: 'tomato-seeds',
    label: 'Hạt cà chua',
    texture: 'item-tomato-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'tomato',
    sellPrice: 0,
    buyPrice: 36,
    blurb: 'Sáu ngày ra quả đầu, rồi cứ hai ngày một lứa cho đến khi hết nóng.',
  },
  tomato: {
    id: 'tomato',
    label: 'Cà chua',
    texture: 'item-tomato',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 26,
    produce: true,
    blurb: 'Còn ấm nắng trên giàn. Sạp hàng lúc nào cũng thiếu.',
  },
  'melon-seeds': {
    id: 'melon-seeds',
    label: 'Hạt dưa',
    texture: 'item-melon-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'melon',
    sellPrice: 0,
    buyPrice: 44,
    blurb: 'Tưới cả tuần để được một quả dưa. Tưới cả tuần để được một quả dưa.',
  },
  melon: {
    id: 'melon',
    label: 'Dưa',
    texture: 'item-melon',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 132,
    produce: true,
    blurb: 'Nặng hơn vẻ ngoài, và đáng giá hơn cả cân nặng.',
  },
  'barley-seeds': {
    id: 'barley-seeds',
    label: 'Hạt lúa mạch',
    texture: 'item-barley-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'barley',
    sellPrice: 0,
    buyPrice: 6,
    blurb: 'Rẻ, nhanh, và gần như không bõ công đi ra sạp.',
  },
  barley: {
    id: 'barley',
    label: 'Lúa mạch',
    texture: 'item-barley',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 14,
    produce: true,
    blurb: 'Thức ăn mùa đông, và khởi đầu của mọi thứ đáng uống.',
  },
  'cranberry-seeds': {
    id: 'cranberry-seeds',
    label: 'Hạt nam việt quất',
    texture: 'item-cranberry-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'cranberry',
    sellPrice: 0,
    buyPrice: 60,
    blurb: 'Gói hạt đắt nhất sạp, và cứ cách ngày lại ra quả.',
  },
  cranberry: {
    id: 'cranberry',
    label: 'Nam việt quất',
    texture: 'item-cranberry',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 42,
    produce: true,
    blurb: 'Những hạt đỏ chua gắt. Cả mùa thu trong một lọ.',
  },
  'pumpkin-seeds': {
    id: 'pumpkin-seeds',
    label: 'Hạt bí ngô',
    texture: 'item-pumpkin-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'pumpkin',
    sellPrice: 0,
    buyPrice: 60,
    blurb: 'Tám ngày. Trồng trong tuần đầu của thu, hoặc thôi hẳn.',
  },
  pumpkin: {
    id: 'pumpkin',
    label: 'Bí ngô',
    texture: 'item-pumpkin',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 200,
    produce: true,
    blurb: 'Cả làng kéo ra xem những quả to.',
  },
  // Spec 15's two. Priced to be cooked rather than sold: over a summer each
  // earns about what a strawberry earns over a spring, and turned into a dish
  // at the phố they are worth three times that. The dishes are what the crops
  // are for, the way clover is for the barn.
  'nep-seeds': {
    id: 'nep-seeds',
    label: 'Hạt nếp',
    texture: 'item-nep-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'nep',
    sellPrice: 0,
    buyPrice: 60,
    blurb: 'Năm ngày thì trổ bông, rồi cứ ba ngày lại một lứa cho đến hết hạ.',
  },
  nep: {
    id: 'nep',
    label: 'Nếp',
    texture: 'item-nep',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 26,
    produce: true,
    blurb: 'Hạt tròn, dẻo, thơm. Bán thì phí, gói bánh thì vừa.',
  },
  'dau-xanh-seeds': {
    id: 'dau-xanh-seeds',
    label: 'Hạt đậu xanh',
    texture: 'item-dau-xanh-seeds',
    stackSize: DEFAULT_STACK_SIZE,
    plants: 'dau-xanh',
    sellPrice: 0,
    buyPrice: 50,
    blurb: 'Bốn ngày ra quả, rồi cách ngày lại hái. Nắng càng gắt càng sai.',
  },
  'dau-xanh': {
    id: 'dau-xanh',
    label: 'Đậu xanh',
    texture: 'item-dau-xanh',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 16,
    produce: true,
    blurb: 'Một vốc hạt xanh. Chẳng đáng bao nhiêu cho tới khi vào nồi chè.',
  },
  /**
   * The three dishes of the phố.
   *
   * Ordinary produce rather than food: nothing in the game eats yet, and this
   * spec does not quietly start. They stack, sell and give like a melon does,
   * and the only thing that makes them dishes is the recipe that makes them.
   */
  'banh-chung': {
    id: 'banh-chung',
    label: 'Bánh chưng',
    texture: 'item-banh-chung',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 380,
    produce: true,
    blurb: 'Nếp, đậu, lá dong buộc lạt. Vuông như đất, và ai cũng quý.',
  },
  'xoi-dau': {
    id: 'xoi-dau',
    label: 'Xôi đậu',
    texture: 'item-xoi-dau',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 240,
    produce: true,
    blurb: 'Đồ hai lửa, rắc muối vừng. Bà Xoan nhìn là biết ai đồ.',
  },
  'che-dau': {
    id: 'che-dau',
    label: 'Chè đậu',
    texture: 'item-che-dau',
    stackSize: DEFAULT_STACK_SIZE,
    sellPrice: 200,
    produce: true,
    blurb: 'Đậu xanh đánh nhuyễn, dâu tây thả lên trên. Ngọt vừa, mát lâu.',
  },
  /**
   * Bait, which is the whole of what spec 12 takes from spec 11.
   *
   * One effect and no second one: it halves the wait, and that is all. The
   * temptation is to make it also improve the catch, or bias the draw towards
   * the dear fish — both of which would make fishing without it feel like
   * playing wrong, and turn a convenience into an obligation to keep a stack
   * topped up. Halving a wait is worth crafting and is never worth resenting.
   */
  bait: {
    id: 'bait',
    label: 'Mồi câu',
    texture: 'item-bait',
    stackSize: DEFAULT_STACK_SIZE,
    // Deliberately unsellable, and not because it is worthless. Bait is made
    // from fibre the player cut themselves, and a stack of it quietly leaving
    // the satchel at the market counter — where one press sells everything
    // flagged `produce` — is the bug spec 10 wrote a paragraph about.
    sellPrice: 0,
    blurb: 'Sợi tết chặt quanh lưỡi câu. Cá đến nhanh hơn một nửa thời gian.',
  },
  ...materialRows(),
  ...forageRows(),
  ...fishRows(),
};

/**
 * Everything the game can hold.
 *
 * Two layers rather than one, because the artisan rows are a function of the
 * rows above them: a bottle of melon wine is priced at three times a melon,
 * and the melon has to already be on the table to be asked. `BASE_ITEMS` is
 * that table; nothing outside this file should ever want it.
 */
export const ITEMS: Record<ItemId, ItemDef> = {
  ...BASE_ITEMS,
  ...placeableRows(),
  ...artisanRows(BASE_ITEMS),
};

export function isItemId(value: unknown): value is ItemId {
  return typeof value === 'string' && Object.hasOwn(ITEMS, value);
}

/**
 * Looks an item up, or throws.
 *
 * Every id in play came from this table or from a save that `parseFarm`
 * checked against it, so a miss here is a bug rather than bad input, and
 * inventing a placeholder item would hide it.
 */
export function itemDef(id: ItemId): ItemDef {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item: ${id}`);
  return def;
}

export function stackSizeOf(id: ItemId): number {
  return itemDef(id).stackSize;
}

/** Every tool the game knows about, at every tier it has, in ladder order. */
export const TOOL_IDS: readonly ItemId[] = TOOL_ROWS.map((row) => row.id);

export function isTool(id: ItemId): boolean {
  return ITEMS[id]?.tool !== undefined;
}

/**
 * The rectangle one swing of this item works, in tiles.
 *
 * Answered for anything, not only tools: a seed packet plants one tile, and
 * having the single caller ask this rather than branch on "is it a tool" is
 * what keeps planting out of the area-of-effect rules by construction.
 */
export function areaOfEffectOf(id: ItemId): { width: number; height: number } {
  return ITEMS[id]?.areaOfEffect ?? { width: 1, height: 1 };
}

export function energyFactorOf(id: ItemId): number {
  return ITEMS[id]?.energyFactor ?? 1;
}

/**
 * How much of the fishing bar this item's square covers.
 *
 * Falls back to the first rung rather than to zero, so a cast that somehow
 * reaches the physics without a rod is merely a hard cast rather than one that
 * can never be won. Nothing should get there — `applyCast` checks the rod
 * first — and a bar of width nought would be an unloseable-looking minigame
 * that is in fact unwinnable, which is the worst of the two failures.
 */
export function barWidthOf(id: ItemId): number {
  return ITEMS[id]?.barWidth ?? BASIC_BAR_WIDTH;
}

/** The square the first rod on the ladder gives you. */
export const BASIC_BAR_WIDTH = 0.2;

/**
 * What the blacksmith would make of this item, or null for one he will not
 * take: anything that is not a tool, and a tool already at the top.
 */
export function upgradeFor(
  id: ItemId,
): { item: ItemId; cost: number; bars: { item: ItemId; count: number } | null } | null {
  const def = ITEMS[id];
  if (!def?.upgradesTo || def.upgradeCost === undefined) return null;
  return { item: def.upgradesTo, cost: def.upgradeCost, bars: def.upgradeBars ?? null };
}

/**
 * The tools a new farmhand is handed, in the order they sit in the hotbar.
 *
 * Six now rather than three, and that is the point: the axe and the pickaxe
 * are what every player of this genre reaches for in the first ten minutes,
 * and the farm they wake up on is overgrown. Handing them over on the first
 * morning rather than selling them is the difference between a farm to reclaim
 * and a shopping list.
 */
export const STARTING_TOOLS: readonly ItemId[] = [
  'hoe',
  'watering-can',
  'basket',
  'axe',
  'pickaxe',
  'scythe',
];

/** The packet that grows a crop. The naming is a convention, enforced here. */
export function seedIdFor(crop: CropId): ItemId {
  return `${crop}-seeds`;
}
