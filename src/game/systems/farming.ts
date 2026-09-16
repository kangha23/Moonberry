import {
  addItem,
  clearItem,
  slotAt,
  spendCharge,
  takeFromSlot,
  type Inventory,
} from './inventory';
import { ITEMS, itemDef, seedIdFor, type CropId, type ItemId, type Tool } from './items';
import { daysLeftInSeason, nextSeason, seasonForDay, seasonLabel, type Season } from './time';

export type PlotStage = 'wild' | 'tilled' | 'seeded' | 'sprout' | 'mature';
export type FarmAction = 'till' | 'plant' | 'water' | 'harvest';

/**
 * What a crop is, minus everything the item table already says.
 *
 * Labels and prices live on the items, so a crop here is only the two rows
 * that connect them — the seed you plant and the produce you lift — plus how
 * long it takes and when it will tolerate being alive.
 */
export interface CropDefinition {
  id: CropId;
  /**
   * When it may be planted, and the only seasons it will live through.
   *
   * This is the whole of spec 04: a planting has a deadline, and the judgement
   * every spring afternoon is whether there is time for another cycle before
   * the season turns. A crop listing two seasons survives the boundary between
   * them, which is what makes wheat worth its price.
   */
  seasons: readonly Season[];
  growDays: number;
  /**
   * Days to produce again after a harvest; null means one and done.
   *
   * A regrowing crop is the reason to commit a plot for a whole season rather
   * than replanting the fastest thing in it. It costs more up front and pays
   * nothing at all if the season runs out first.
   */
  regrowDays: number | null;
  seed: ItemId;
  produce: ItemId;
}

/**
 * The catalogue.
 *
 * Three or four crops a season, chosen so none is strictly better than
 * another. Each season has a cheap fast one, a slow expensive one, one that
 * regrows, and one that earns badly on purpose because a later spec — animals,
 * cooking, gifts — will want something to be made of.
 *
 * Priced against the energy budget rather than against gold per day, because
 * since spec 01 watering is what a day is actually spent on: a plot costs 2
 * energy to till and 2 more for every day it is watered, so a seven-day melon
 * costs sixteen energy a cycle and a two-day turnip four. Gold per energy in
 * steady state runs from about 1 for the fodder crops to 10 for cranberries,
 * and later seasons pay better than earlier ones because by then you can
 * afford the seed.
 */
const CROPS: ReadonlyArray<Omit<CropDefinition, 'seed' | 'produce'>> = [
  // Spring. Everything here is affordable on a starting wallet of 24g.
  { id: 'turnip', seasons: ['Spring'], growDays: 2, regrowDays: null },
  { id: 'clover', seasons: ['Spring'], growDays: 3, regrowDays: null },
  { id: 'strawberry', seasons: ['Spring'], growDays: 5, regrowDays: 3 },
  { id: 'rhubarb', seasons: ['Spring'], growDays: 6, regrowDays: null },

  // Summer. Wheat is the one crop that does not care about the turn into
  // autumn, so a field of it is the safe thing to do in the last week.
  { id: 'wheat', seasons: ['Summer', 'Autumn'], growDays: 3, regrowDays: null },
  { id: 'sunflower', seasons: ['Summer'], growDays: 5, regrowDays: null },
  { id: 'tomato', seasons: ['Summer'], growDays: 6, regrowDays: 2 },
  { id: 'melon', seasons: ['Summer'], growDays: 7, regrowDays: null },
  // Spec 15's pair, which grow for the phố rather than for the stall: sold
  // raw they are a strawberry's worth, and their real price is in a dish.
  { id: 'nep', seasons: ['Summer'], growDays: 5, regrowDays: 3 },
  { id: 'dau-xanh', seasons: ['Summer'], growDays: 4, regrowDays: 2 },

  // Autumn. The richest season, and the one with the least room for error:
  // a pumpkin planted after the twentieth never ripens.
  { id: 'barley', seasons: ['Autumn'], growDays: 4, regrowDays: null },
  { id: 'cranberry', seasons: ['Autumn'], growDays: 7, regrowDays: 2 },
  { id: 'pumpkin', seasons: ['Autumn'], growDays: 8, regrowDays: null },

  // Winter, and a stopgap rather than a design.
  //
  // Stardew grows nothing in winter because winter is for the mine, the
  // river and the town, and that shape is what gives the year its rhythm. We
  // have none of those three yet, so an empty winter would be four weeks of
  // walking around a farm with nothing to do. Two hardy crops keep it
  // playable, priced below autumn so the season still reads as lean. When
  // spec 07 gives the village something to be worth visiting for, the right
  // move is to take these two out again.
  { id: 'frostcap', seasons: ['Winter'], growDays: 5, regrowDays: null },
  { id: 'winterberry', seasons: ['Winter'], growDays: 8, regrowDays: 4 },
];

export const CROP_DEFINITIONS: Record<CropId, CropDefinition> = Object.fromEntries(
  CROPS.map((crop) => [crop.id, { ...crop, seed: seedIdFor(crop.id), produce: crop.id }]),
) as Record<CropId, CropDefinition>;

export function cropDef(crop: CropId): CropDefinition {
  return CROP_DEFINITIONS[crop];
}

/** Whether a crop may be planted in, and will live through, a season. */
export function growsIn(crop: CropId, season: Season): boolean {
  return CROP_DEFINITIONS[crop].seasons.includes(season);
}

/** Every crop the given season will grow, in catalogue order. */
export function cropsForSeason(season: Season): CropDefinition[] {
  return CROPS.map((crop) => CROP_DEFINITIONS[crop.id]).filter((crop) => crop.seasons.includes(season));
}

/**
 * How many days of warning a doomed crop gets before the season kills it.
 *
 * Stardew gives none, and losing a field to a rule you had not internalised
 * reads as unfair rather than demanding. Three days is enough to harvest what
 * is ripe and stop watering what is not.
 */
export const WITHER_WARNING_DAYS = 3;

/**
 * True when this crop is in ground the turning season is about to kill, and
 * close enough to the turn to be worth showing.
 *
 * The renderer tints it, and the morning summary names it. Both ask this, so
 * the wilted sprite and the sentence can never disagree.
 */
export function isWithering(crop: CropId, day: number): boolean {
  if (daysLeftInSeason(day) > WITHER_WARNING_DAYS) return false;
  return !growsIn(crop, nextSeason(seasonForDay(day)));
}

export function cropLabel(crop: CropId): string {
  return itemDef(CROP_DEFINITIONS[crop].produce).label;
}

/** "Xuân", or "Hạ và Thu" — for telling a player why they cannot plant. */
export function listSeasons(crop: CropId): string {
  const seasons = CROP_DEFINITIONS[crop].seasons.map(seasonLabel);
  if (seasons.length === 1) return seasons[0];
  return `${seasons.slice(0, -1).join(', ')} và ${seasons[seasons.length - 1]}`;
}

/**
 * What holding each kind of tool means when you swing it at a plot.
 *
 * Partial, and the gap is the interesting half: the axe, the pickaxe and the
 * scythe are tools that do nothing whatsoever to soil. They work on what is
 * *standing* on the ground, which is `resources.ts`, and the reducer asks that
 * question before it asks this one. Leaving them out here is what makes
 * "swinging an axe at a tilled bed does nothing" a fact about the table rather
 * than a branch somebody has to remember to write.
 */
const TOOL_ACTIONS: Partial<Record<Tool, FarmAction>> = {
  hoe: 'till',
  can: 'water',
  basket: 'harvest',
};

/**
 * What a slot does to a plot, or null for a slot that does nothing to one.
 *
 * Seeds get there through `plants` rather than `tool`: planting is not an
 * implement you swing, it is what the thing in your hand happens to grow.
 */
export function actionForSlot(inventory: Inventory, slot: number): FarmAction | null {
  const stack = slotAt(inventory, slot);
  if (!stack) return null;
  const def = ITEMS[stack.item];
  if (!def) return null;
  if (def.tool) return TOOL_ACTIONS[def.tool] ?? null;
  return def.plants ? 'plant' : null;
}

export interface PlotState {
  x: number;
  y: number;
  stage: PlotStage;
  crop: CropId | null;
  daysWatered: number;
  wateredToday: boolean;
}

/**
 * What each action takes out of the player, in energy.
 *
 * Preparing and maintaining the field is what a day is spent on; picking what
 * grew is free, so a harvest day is the reward for the days of work behind it.
 * The table sits here with the crops because it is tuning, not rules.
 */
export const ACTION_ENERGY_COST: Record<FarmAction, number> = {
  till: 2,
  plant: 0,
  water: 2,
  harvest: 0,
};

export interface FarmActionResult {
  plot: PlotState;
  inventory: Inventory;
  message: string;
  changed: boolean;
  /** What the swing cost. Always 0 for an action the plot refused. */
  energyCost: number;
  /** Which action the held item turned out to be, for the renderer. */
  action?: FarmAction;
  harvestedCrop?: CropId;
}

export interface SellResult {
  inventory: Inventory;
  /** Credit this to the farm's shared wallet; the inventory holds no coins. */
  coinsEarned: number;
  soldCount: number;
  changed: boolean;
  message: string;
}

/** Every item the market stall buys, which is everything a plot yields. */
function produceIds(): ItemId[] {
  return Object.keys(ITEMS).filter((id) => ITEMS[id].produce);
}

/**
 * Empties the basket onto a counter.
 *
 * `accepts` is which of the produce this counter takes, and everything by
 * default: Tobias buys whatever grows. Bà Xoan's cart only buys the three
 * dishes, and says so — see `sellAtStall` in `shop.ts`.
 */
export function sellAllCrops(inventory: Inventory, accepts: (item: ItemId) => boolean = () => true): SellResult {
  let next = inventory;
  let coinsEarned = 0;
  let soldCount = 0;

  for (const id of produceIds()) {
    if (!accepts(id)) continue;
    const cleared = clearItem(next, id);
    if (cleared.removed === 0) continue;
    next = cleared.inventory;
    coinsEarned += cleared.removed * itemDef(id).sellPrice;
    soldCount += cleared.removed;
  }

  if (soldCount === 0) {
    return {
      inventory,
      coinsEarned: 0,
      soldCount: 0,
      changed: false,
      message: 'Sạp chợ đang mở, nhưng giỏ của bạn trống không.',
    };
  }

  return {
    inventory: next,
    coinsEarned,
    soldCount,
    changed: true,
    message: `Đã bán ${soldCount} nông sản ngoài chợ, được ${coinsEarned}g.`,
  };
}

export function createPlot(x: number, y: number): PlotState {
  return { x, y, stage: 'wild', crop: null, daysWatered: 0, wateredToday: false };
}

export function tillPlot(plot: PlotState): PlotState {
  if (plot.stage !== 'wild') return plot;
  return { ...plot, stage: 'tilled' };
}

/**
 * Puts seed in the ground, or refuses.
 *
 * The season is a parameter rather than something read from a clock, because
 * the reducer is pure and this is the rule that gives the calendar teeth: a
 * crop that will not live in this season is never planted, and — since the
 * caller only spends the seed once the plot has agreed — costs nothing.
 */
export function plantCrop(plot: PlotState, crop: CropId, season: Season): PlotState | null {
  if (plot.stage !== 'tilled' || plot.crop) return null;
  if (!growsIn(crop, season)) return null;
  return { ...plot, stage: 'seeded', crop, daysWatered: 0, wateredToday: false };
}

export function waterPlot(plot: PlotState): PlotState {
  if (!plot.crop || plot.stage === 'mature' || plot.wateredToday) return plot;
  return { ...plot, wateredToday: true };
}

/**
 * How grown a crop looks after so many days of water.
 *
 * One function rather than a branch per caller, because two things now set a
 * plot's stage: the overnight roll-over, and a regrowing crop dropping back
 * down the ladder when it is picked.
 */
function stageFor(crop: CropId, daysWatered: number): PlotStage {
  const { growDays } = CROP_DEFINITIONS[crop];
  if (daysWatered >= growDays) return 'mature';
  return daysWatered >= Math.ceil(growDays / 2) ? 'sprout' : 'seeded';
}

export function advancePlotDay(plot: PlotState, wasRainy: boolean): PlotState {
  if (!plot.crop) return { ...plot, wateredToday: false };

  const watered = plot.wateredToday || wasRainy;
  const daysWatered = watered ? plot.daysWatered + 1 : plot.daysWatered;

  return { ...plot, daysWatered, wateredToday: false, stage: stageFor(plot.crop, daysWatered) };
}

/**
 * Lifts what is ripe.
 *
 * A one-and-done crop comes out of the ground and leaves a tilled plot behind.
 * A regrowing one stays where it is and drops back to `growDays - regrowDays`
 * days of water, so it is that many waterings from being ripe again — which is
 * the whole bargain: a plot committed for the season instead of replanted.
 */
export function harvestPlot(plot: PlotState): { plot: PlotState; crop: CropId } | null {
  if (!plot.crop || plot.stage !== 'mature') return null;
  const crop = plot.crop;
  const { regrowDays } = CROP_DEFINITIONS[crop];

  if (regrowDays === null) {
    return {
      crop,
      plot: { ...plot, stage: 'tilled', crop: null, daysWatered: 0, wateredToday: false },
    };
  }

  const daysWatered = Math.max(0, CROP_DEFINITIONS[crop].growDays - regrowDays);
  return {
    crop,
    // Watered again today rather than not at all: the plant was ripe all day
    // and refused the can, so charging for a pour it would not accept would
    // make picking fruit cost energy through the back door.
    plot: { ...plot, stage: stageFor(crop, daysWatered), daysWatered, wateredToday: true },
  };
}

/** A plot cleared of whatever was growing, back to bare worked soil. */
function clearPlot(plot: PlotState): PlotState {
  return { ...plot, stage: 'tilled', crop: null, daysWatered: 0, wateredToday: false };
}

export interface WitherResult {
  plots: Record<string, PlotState>;
  /** Which plots changed, so the renderer can be told about exactly those. */
  keys: string[];
  /** Which crops were lost, deduplicated, so the morning can name them. */
  crops: CropId[];
  /** How many plots were cleared. */
  count: number;
}

/**
 * Kills everything the incoming season will not carry, at the moment it turns.
 *
 * Called once a season rather than every morning, because a crop only ever
 * dies at a boundary — and because running it daily would mean every plot in
 * the world re-deriving the same answer for twenty-seven mornings that cannot
 * change it.
 *
 * A regrowing crop is no exception. Committing a plot to strawberries buys the
 * rest of spring, not a plant that outlives it.
 */
export function killOutOfSeasonCrops(
  plots: Record<string, PlotState>,
  season: Season,
): WitherResult {
  const next: Record<string, PlotState> = {};
  const keys: string[] = [];
  const crops = new Set<CropId>();

  for (const [key, plot] of Object.entries(plots)) {
    if (!plot.crop || growsIn(plot.crop, season)) {
      next[key] = plot;
      continue;
    }
    crops.add(plot.crop);
    keys.push(key);
    next[key] = clearPlot(plot);
  }

  // The same object back when nothing died, so the reducer's identity checks
  // keep telling the truth about whether the world changed.
  if (keys.length === 0) return { plots, keys, crops: [], count: 0 };
  return { plots: next, keys, crops: [...crops], count: keys.length };
}

/**
 * Works one plot with whatever is in the selected slot.
 *
 * The slot is the whole input: which action this is comes from the item's own
 * `tool` or `plants` field, so a hoe tills and a seed packet plants without
 * anything upstream having to decide which is which.
 *
 * Energy is stamped on afterwards rather than decided per branch, so a refused
 * action can never be made to cost something by a branch that forgot.
 */
export function applyFarmAction(
  plot: PlotState,
  inventory: Inventory,
  slot: number,
  season: Season,
): FarmActionResult {
  const action = actionForSlot(inventory, slot);
  if (!action) {
    return {
      plot,
      inventory,
      changed: false,
      energyCost: 0,
      message: slotAt(inventory, slot)
        ? 'Thứ này không dùng để làm đất được.'
        : 'Tay bạn đang trống. Hãy chọn một nông cụ hoặc ít hạt giống.',
    };
  }

  const result = resolveFarmAction(plot, inventory, slot, action, season);
  return { ...result, action, energyCost: result.changed ? ACTION_ENERGY_COST[action] : 0 };
}

export interface SweepResult {
  /** Only the plots that actually changed, keyed as they were passed in. */
  changed: Array<{ key: string; plot: PlotState }>;
  inventory: Inventory;
  /** What the held item turned out to do, or null for an item that does nothing. */
  action: FarmAction | null;
  /** The whole sweep's cost, with the tool's factor already applied. */
  energyCost: number;
  harvested: CropId[];
  message: string;
}

/** What a sweep that worked more than one plot says it did. */
function describeSweep(action: FarmAction, worked: number): string {
  switch (action) {
    case 'till':
      return `${worked} luống đất được lật lên chỉ trong một nhát.`;
    case 'water':
      return `Đã tưới ${worked} luống.`;
    case 'plant':
      return `${worked} hạt giống đã nằm yên dưới đất.`;
    case 'harvest':
      return `Đã thu ${worked} luống.`;
  }
}

/**
 * Works every plot a swing covers, with whatever is in the selected slot.
 *
 * One swing, several plots: a basic tool passes one key and this is the old
 * behaviour exactly, message and all. A tool from the blacksmith passes the
 * rectangle its tier covers.
 *
 * Two things this is careful about, both of which are what the upgrade is
 * *for* and so both of which have to be exactly right:
 *
 * - The inventory is threaded through, so a sweep spends one pour per tile
 *   watered and stops when the can runs dry part-way, rather than watering
 *   nine tiles on one charge.
 * - Energy is charged once per tile actually worked, and the tier's factor is
 *   applied to the total rather than to each tile. Applied per tile it would
 *   round away to nothing — 2 energy at ×0.9 is still 2 — and the quieter
 *   half of an upgrade would silently do nothing at all.
 */
export function applySweep(
  plots: Record<string, PlotState>,
  keys: readonly string[],
  inventory: Inventory,
  slot: number,
  season: Season,
  energyFactor = 1,
): SweepResult {
  const action = actionForSlot(inventory, slot);
  const changed: SweepResult['changed'] = [];
  const harvested: CropId[] = [];
  let carried = inventory;
  let rawEnergy = 0;
  // Kept so a sweep that worked nothing can explain itself with the reason
  // the tile it was aimed at gave, rather than a blank shrug.
  let firstMessage = '';

  for (const key of keys) {
    const plot = plots[key];
    if (!plot) continue;
    const result = applyFarmAction(plot, carried, slot, season);
    if (!firstMessage) firstMessage = result.message;
    if (!result.changed) continue;

    changed.push({ key, plot: result.plot });
    carried = result.inventory;
    rawEnergy += result.energyCost;
    if (result.harvestedCrop) harvested.push(result.harvestedCrop);
  }

  const worked = changed.length;
  const message =
    action && worked > 1 ? describeSweep(action, worked) : firstMessage || 'Chỗ đó chẳng có gì để làm.';

  return {
    changed,
    inventory: carried,
    action,
    energyCost: Math.round(rawEnergy * energyFactor),
    harvested,
    message,
  };
}

function resolveFarmAction(
  plot: PlotState,
  inventory: Inventory,
  slot: number,
  action: FarmAction,
  season: Season,
): Omit<FarmActionResult, 'energyCost' | 'action'> {
  if (action === 'till') {
    const nextPlot = tillPlot(plot);
    return nextPlot === plot
      ? { plot, inventory, changed: false, message: 'Mảnh đất này đã được làm sẵn rồi.' }
      : { plot: nextPlot, inventory, changed: true, message: 'Đất tơi ra, sẵn sàng cho hạt giống.' };
  }

  if (action === 'plant') {
    const crop = ITEMS[slotAt(inventory, slot)!.item].plants!;
    const nextPlot = plantCrop(plot, crop, season);
    if (!nextPlot) {
      // Two ways to be refused, and telling them apart matters: one is "try
      // the plot next door", the other is "not for another nine months".
      const message = growsIn(crop, season)
        ? 'Hạt giống cần một luống đất đã cày và còn trống.'
        : `${cropLabel(crop)} không mọc được vào mùa ${seasonLabel(season)}. Nó cần mùa ${listSeasons(crop)}.`;
      return { plot, inventory, changed: false, message };
    }
    // Taken only once the plot has agreed to hold them: a refused swing must
    // not cost a seed.
    const nextInventory = takeFromSlot(inventory, slot);
    if (!nextInventory) return { plot, inventory, changed: false, message: `Hết hạt ${cropLabel(crop)} rồi.` };
    return {
      plot: nextPlot,
      inventory: nextInventory,
      changed: true,
      message: `Hạt ${cropLabel(crop)} đã nằm yên dưới đất.`,
    };
  }

  if (action === 'water') {
    if (!plot.crop) return { plot, inventory, changed: false, message: 'Gieo hạt đã rồi hãy tưới luống này.' };
    if (plot.wateredToday) return { plot, inventory, changed: false, message: 'Cây này đã được tưới hôm nay rồi.' };
    if (plot.stage === 'mature') return { plot, inventory, changed: false, message: 'Cây này đã chín, thu hoạch được rồi.' };
    const nextInventory = spendCharge(inventory, slot);
    if (!nextInventory) {
      return { plot, inventory, changed: false, message: 'Bình tưới đã cạn. Mai nó sẽ đầy lại.' };
    }
    return {
      plot: waterPlot(plot),
      inventory: nextInventory,
      changed: true,
      message: 'Nước đọng thành giọt trên những chiếc lá non.',
    };
  }

  const harvest = harvestPlot(plot);
  if (!harvest) return { plot, inventory, changed: false, message: 'Ở đây chưa có gì chín cả.' };

  // Refused rather than dropped: a full basket leaves the crop in the ground,
  // where it is still yours, instead of on a floor nothing can pick it up from.
  const produce = CROP_DEFINITIONS[harvest.crop].produce;
  const nextInventory = addItem(inventory, produce);
  if (!nextInventory) {
    return {
      plot,
      inventory,
      changed: false,
      message: `Không còn chỗ cho ${cropLabel(harvest.crop)}. Nó nằm chờ dưới đất.`,
    };
  }

  return {
    plot: harvest.plot,
    inventory: nextInventory,
    changed: true,
    harvestedCrop: harvest.crop,
    message: `Đã thu hoạch ${cropLabel(harvest.crop)}!`,
  };
}
