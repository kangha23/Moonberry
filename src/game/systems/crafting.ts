import { addItem, countItem, removeItem, type Inventory } from './inventory';
import { itemDef, type ItemId } from './items';
import type { NpcId } from '../npcs/definitions';

/**
 * A recipe is data, the same way an item and a villager are.
 *
 * Adding one is a row in the table below. It is not a type, not a branch in
 * the reducer, and not a case in the panel — which is the whole reason the
 * catalogue can be twenty rows long without twenty places to make a mistake.
 */
export interface Recipe {
  /** Also the `ItemId` of the thing it makes. */
  id: ItemId;
  /** What it eats, and how many of each. */
  needs: Partial<Record<ItemId, number>>;
  /** How many it makes. Usually one. */
  yields: number;
  /** How it is come by. See below. */
  unlock: RecipeUnlock;
}

/**
 * The four ways a recipe arrives.
 *
 * `hearts` is the one that matters, and it is this spec paying spec 07's debt.
 * Friendship currently buys dialogue and nothing else, so a player who works
 * out that gifts are optional is right. Maeve handing over the keg at four
 * hearts and Juniper the preserving jar at three makes the gift table a
 * mechanical system rather than a text one — and it costs nothing here but a
 * variant in this union.
 */
export type RecipeUnlock =
  | { by: 'start' }
  | { by: 'buy'; cost: number }
  | { by: 'hearts'; npc: NpcId; hearts: number }
  | { by: 'day'; day: number }
  /**
   * Spec 16: the farm's deepest floor. The farm's rather than the player's,
   * unlike hearts: "somebody has been down there" is news for the whole group.
   */
  | { by: 'depth'; depth: number };

/**
 * The catalogue.
 *
 * Four groups, and each one answers a different complaint. The field group
 * deletes a chore. The storage group gives the shed a use. The machines give
 * produce a second price. The odds and ends are what a farm looks like once
 * somebody has lived on it for a season.
 *
 * Costed against spec 10's yields rather than against gold, because none of
 * this is bought: a mature tree is about eight planks and a rock is two
 * stones, so a chest at fifty planks is six trees and an afternoon, and a keg
 * is most of a copse. That is the intended shape — the first chest is day
 * three, the first keg is week two.
 */
const RECIPES: readonly Recipe[] = [
  // --- the field ------------------------------------------------------------
  //
  // The sprinkler is the most important row in the table, so it is the one
  // that was weighed hardest. Spec 11 asks for a copper bar in the ordinary
  // one; it does not get one, and that is a deliberate departure worth
  // stating. Copper is dug, and digging is spec 13, which is scheduled *after*
  // this — so a copper-barred sprinkler would ship the headline feature of
  // this spec in an uncraftable state for however long spec 13 takes. The
  // ordinary sprinkler is therefore stone, fibre and sap, all of which spec 10
  // already puts on the ground, and the copper moves up one rung to the
  // quality sprinkler, where it belongs anyway: the eight-tile one is the
  // genuine second ratchet, and gating it behind the mine is exactly the
  // shape spec 13 wants to arrive into.
  {
    id: 'sprinkler',
    needs: { stone: 6, fiber: 8, sap: 3 },
    yields: 1,
    unlock: { by: 'day', day: 4 },
  },
  {
    id: 'quality-sprinkler',
    needs: { sprinkler: 1, 'copper-bar': 2, sap: 5 },
    yields: 1,
    unlock: { by: 'hearts', npc: 'maeve', hearts: 6 },
  },

  // --- storage --------------------------------------------------------------
  { id: 'chest', needs: { wood: 50 }, yields: 1, unlock: { by: 'start' } },
  {
    id: 'big-chest',
    needs: { wood: 120, hardwood: 6 },
    yields: 1,
    unlock: { by: 'day', day: 14 },
  },

  // --- the machines ---------------------------------------------------------
  //
  // The kiln is first and cheapest because it is the one that feeds the
  // others: coal is in half the recipes below it and there is nowhere else to
  // get any until the mine exists.
  { id: 'kiln', needs: { wood: 20, stone: 12 }, yields: 1, unlock: { by: 'start' } },
  {
    id: 'jar',
    needs: { wood: 30, stone: 15, sap: 6 },
    yields: 1,
    unlock: { by: 'hearts', npc: 'juniper', hearts: 3 },
  },
  {
    id: 'keg',
    needs: { wood: 45, hardwood: 3, fiber: 12, coal: 1 },
    yields: 1,
    unlock: { by: 'hearts', npc: 'maeve', hearts: 4 },
  },
  {
    id: 'churn',
    needs: { wood: 25, stone: 20, coal: 2 },
    yields: 1,
    unlock: { by: 'hearts', npc: 'tobias', hearts: 4 },
  },
  // Spec 16. Known from the start because copper ore is its own gate: nobody
  // has ten of it without having been down the mine.
  { id: 'furnace', needs: { stone: 25, 'copper-ore': 10 }, yields: 1, unlock: { by: 'start' } },

  // --- odds and ends --------------------------------------------------------
  //
  // The paths are not decoration, whatever they look like. Nothing grows
  // overnight on a tile something is standing on, so a laid path is a route
  // that stays a route — which on a farm that goes back to scrub every week is
  // the cheapest quality-of-life row in the table.
  // Spec 12's one dependency on this file, and it is deliberately small. Bait
  // halves the wait and does nothing else — it never improves the catch and
  // never biases the draw, because either of those would make fishing without
  // it feel like playing wrong. Five to a batch so that an evening is one
  // craft rather than a trip back to the satchel every third cast, and fibre
  // because fibre is what the first week produces far too much of.
  { id: 'bait', needs: { fiber: 2 }, yields: 5, unlock: { by: 'start' } },
  { id: 'torch', needs: { wood: 2, sap: 1 }, yields: 2, unlock: { by: 'start' } },
  { id: 'wood-path', needs: { wood: 1 }, yields: 4, unlock: { by: 'start' } },
  { id: 'gravel-path', needs: { stone: 1, fiber: 1 }, yields: 6, unlock: { by: 'start' } },
  { id: 'stone-path', needs: { stone: 1 }, yields: 4, unlock: { by: 'day', day: 3 } },
  { id: 'wood-fence', needs: { wood: 4 }, yields: 6, unlock: { by: 'start' } },
  {
    id: 'stone-fence',
    needs: { stone: 5 },
    yields: 6,
    unlock: { by: 'hearts', npc: 'bram', hearts: 2 },
  },
  {
    id: 'hardwood-fence',
    needs: { hardwood: 2 },
    yields: 6,
    unlock: { by: 'day', day: 25 },
  },

  // --- the phố ---------------------------------------------------------------
  //
  // Spec 15's three dishes, known from the first morning like the torch: the
  // gate is the summer that grows the nếp and the đậu, and a second gate on
  // top of that would only be a wait. The fibre in the bánh chưng is the lá
  // dong and the lạt, which is what a week of scything already makes too much
  // of. Two bowls of chè to a pot, because nobody cooks one bowl of chè.
  { id: 'banh-chung', needs: { nep: 4, fiber: 2 }, yields: 1, unlock: { by: 'start' } },
  { id: 'xoi-dau', needs: { nep: 3, 'dau-xanh': 2 }, yields: 1, unlock: { by: 'start' } },
  { id: 'che-dau', needs: { 'dau-xanh': 3, strawberry: 2 }, yields: 2, unlock: { by: 'start' } },

  // --- the mine --------------------------------------------------------------
  //
  // Spec 16. A sword for each band, opened by reaching the band rather than
  // bought: the copper one is what makes floors ten to nineteen comfortable,
  // and it arrives the moment somebody first stands on floor ten. Wood for the
  // hilt of the first and hardwood for the two that have to take a real hit.
  { id: 'copper-sword', needs: { 'copper-bar': 3, wood: 5 }, yields: 1, unlock: { by: 'depth', depth: 10 } },
  { id: 'steel-sword', needs: { 'iron-bar': 3, hardwood: 5 }, yields: 1, unlock: { by: 'depth', depth: 20 } },
  { id: 'gold-sword', needs: { 'gold-bar': 3, hardwood: 5 }, yields: 1, unlock: { by: 'depth', depth: 30 } },
];

/**
 * The most that may be asked for in one press.
 *
 * A bound for the parser rather than a rule of the game: the satchel runs out
 * long before this, but `count` arrives off the wire and `1e9` is a number.
 */
export const MAX_CRAFT = 99;

export const RECIPE_BOOK: Record<ItemId, Recipe> = Object.fromEntries(
  RECIPES.map((recipe) => [recipe.id, recipe]),
);

/** Every recipe, in catalogue order. The order the crafting tab shows them in. */
export const ALL_RECIPES: readonly Recipe[] = RECIPES;

export function recipeFor(id: ItemId): Recipe | null {
  return RECIPE_BOOK[id] ?? null;
}

export function isRecipeId(value: unknown): value is ItemId {
  return typeof value === 'string' && Object.hasOwn(RECIPE_BOOK, value);
}

/**
 * The recipes a new farmhand already knows.
 *
 * Everything else is learned, and a learned recipe belongs to the **player**
 * rather than to the farm — which is the one decision in this file that looks
 * arbitrary and is not. Hearts are per player, because a friendship is between
 * two people; a recipe Maeve gave *you* for being her friend cannot be
 * something your farmhand also has. The consequence is deliberate and is
 * tested: two people on one farm can know different things.
 */
export const STARTING_RECIPES: readonly ItemId[] = RECIPES.filter(
  (recipe) => recipe.unlock.by === 'start',
).map((recipe) => recipe.id);

/** What the world has to be like for a recipe to be learnable at all. */
export interface UnlockContext {
  day: number;
  /** Hearts with each villager, for this one player. */
  heartsFor: (npc: NpcId) => number;
  /** The farm's record depth. Absent reads as never having gone down. */
  deepestFloor?: number;
}

/**
 * Whether a player has now met a recipe's condition.
 *
 * Asked each morning and after each gift, not once: hearts go up mid-day and a
 * recipe that only arrived at dawn would have the player wondering whether the
 * gift worked. `buy` is never true here — a bought recipe is learned by paying
 * for it, which is an intent, not a condition that ripens.
 */
export function unlockMet(unlock: RecipeUnlock, context: UnlockContext): boolean {
  switch (unlock.by) {
    case 'start':
      return true;
    case 'day':
      return context.day >= unlock.day;
    case 'hearts':
      return context.heartsFor(unlock.npc) >= unlock.hearts;
    case 'buy':
      return false;
    case 'depth':
      return (context.deepestFloor ?? 0) >= unlock.depth;
  }
}

/**
 * Every recipe this player has just become eligible for and does not yet know.
 *
 * Returns the ids rather than the new list, so the caller can raise one event
 * per recipe learned — a recipe arriving silently is a recipe nobody notices.
 */
export function newlyUnlocked(
  known: readonly ItemId[],
  context: UnlockContext,
): Array<{ recipe: ItemId; from: RecipeUnlock }> {
  const learned: Array<{ recipe: ItemId; from: RecipeUnlock }> = [];
  for (const recipe of RECIPES) {
    if (known.includes(recipe.id)) continue;
    if (!unlockMet(recipe.unlock, context)) continue;
    learned.push({ recipe: recipe.id, from: recipe.unlock });
  }
  return learned;
}

/** What one ingredient wants and what the satchel actually has. */
export interface Ingredient {
  item: ItemId;
  needs: number;
  has: number;
}

export function ingredientsFor(recipe: Recipe, inventory: Inventory): Ingredient[] {
  return Object.entries(recipe.needs).map(([item, needs]) => ({
    item,
    needs: needs ?? 0,
    has: countItem(inventory, item),
  }));
}

/** What is short, as a sentence. Empty when nothing is. */
export function describeShortfall(recipe: Recipe, inventory: Inventory): string {
  const missing = ingredientsFor(recipe, inventory).filter(
    (ingredient) => ingredient.has < ingredient.needs,
  );
  if (missing.length === 0) return '';
  const parts = missing.map(
    (ingredient) =>
      `${ingredient.needs - ingredient.has} ${itemDef(ingredient.item).label.toLowerCase()}`,
  );
  return `Còn thiếu ${parts.join(', ')}.`;
}

export type CraftResult =
  | { ok: true; inventory: Inventory; made: number }
  | { ok: false; reason: string };

/**
 * Makes something.
 *
 * All or nothing, in both directions and for the same reason `addItem` is:
 * a craft that spent the planks and then found nowhere to put the chest would
 * be a bug that costs a player fifty pieces of wood, and the only safe moment
 * to find out there is no room is before anything has moved. So the ingredients
 * come out of a copy, the result goes into that copy, and the copy is thrown
 * away whole if either half fails.
 *
 * No workbench. Spec 11 is explicit and it is right: the satchel is open, the
 * tab is there, it is made. A bench would be one more walk in a game where
 * walking already costs real minutes, and it would buy nothing but ceremony.
 */
export function craft(
  inventory: Inventory,
  known: readonly ItemId[],
  id: ItemId,
  count = 1,
): CraftResult {
  const recipe = recipeFor(id);
  if (!recipe) return { ok: false, reason: 'Không có công thức nào như thế.' };
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, reason: 'Số lượng đó không làm được.' };
  }
  if (!known.includes(id)) {
    return { ok: false, reason: `Bạn chưa biết cách làm ${itemDef(id).label.toLowerCase()}.` };
  }

  let next = inventory;
  for (const [item, per] of Object.entries(recipe.needs)) {
    const taken = removeItem(next, item, (per ?? 0) * count);
    if (!taken) {
      return { ok: false, reason: describeShortfall(recipe, inventory) || 'Không đủ nguyên liệu.' };
    }
    next = taken;
  }

  const made = recipe.yields * count;
  const filled = addItem(next, id, made);
  // Checked after the ingredients come out, which is what makes the awkward
  // case work: fifty planks leaving the satchel frees the slot the chest needs.
  if (!filled) {
    return { ok: false, reason: 'Túi đồ không còn chỗ cho thứ vừa làm ra.' };
  }

  return { ok: true, inventory: filled, made };
}
