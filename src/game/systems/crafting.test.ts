import { describe, expect, it } from 'vitest';
import {
  ALL_RECIPES,
  STARTING_RECIPES,
  craft,
  describeShortfall,
  ingredientsFor,
  newlyUnlocked,
  recipeFor,
  unlockMet,
} from './crafting';
import {
  addItem,
  countItem,
  emptyInventory,
  newStack,
  type Inventory,
} from './inventory';
import { ITEMS, type ItemId } from './items';
import type { NpcId } from '../npcs/definitions';

/** A satchel holding exactly what is asked for and nothing else. */
function bag(contents: Partial<Record<ItemId, number>> = {}): Inventory {
  let inventory = emptyInventory();
  for (const [item, count] of Object.entries(contents)) {
    const filled = addItem(inventory, item, count ?? 0);
    if (!filled) throw new Error(`no room for ${count} ${item}`);
    inventory = filled;
  }
  return inventory;
}

/** Every slot taken, so nothing new can be added. */
function fullBag(item: ItemId = 'stone'): Inventory {
  return emptyInventory().map(() => newStack(item, ITEMS[item].stackSize));
}

const NO_HEARTS = { day: 1, heartsFor: () => 0 };

describe('the recipe catalogue', () => {
  it('names an item that exists for every recipe', () => {
    for (const recipe of ALL_RECIPES) {
      expect(ITEMS[recipe.id], `${recipe.id} has no item row`).toBeDefined();
      expect(recipe.yields).toBeGreaterThan(0);
    }
  });

  it('asks only for ingredients that exist, in whole positive amounts', () => {
    for (const recipe of ALL_RECIPES) {
      const needs = Object.entries(recipe.needs);
      expect(needs.length, `${recipe.id} costs nothing`).toBeGreaterThan(0);
      for (const [item, count] of needs) {
        expect(ITEMS[item], `${recipe.id} needs unknown ${item}`).toBeDefined();
        expect(Number.isInteger(count) && (count ?? 0) > 0).toBe(true);
      }
    }
  });

  it('starts a farmhand with exactly the unconditional recipes', () => {
    const unconditional = ALL_RECIPES.filter((recipe) => recipe.unlock.by === 'start');
    expect([...STARTING_RECIPES].sort()).toEqual(unconditional.map((r) => r.id).sort());
    // And one of them has to be the chest, or the shed stays empty for a
    // fortnight and the whole spec's opening move is unavailable.
    expect(STARTING_RECIPES).toContain('chest');
  });
});

describe('crafting', () => {
  it('takes exactly what the recipe asks for and hands back what it yields', () => {
    const recipe = recipeFor('torch')!;
    const before = bag({ wood: 10, sap: 4 });

    const result = craft(before, ['torch'], 'torch', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(countItem(result.inventory, 'wood')).toBe(10 - (recipe.needs.wood ?? 0));
    expect(countItem(result.inventory, 'sap')).toBe(4 - (recipe.needs.sap ?? 0));
    expect(countItem(result.inventory, 'torch')).toBe(recipe.yields);
    expect(result.made).toBe(recipe.yields);
  });

  it('multiplies both halves when more than one is asked for', () => {
    const recipe = recipeFor('torch')!;
    const result = craft(bag({ wood: 20, sap: 10 }), ['torch'], 'torch', 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(countItem(result.inventory, 'wood')).toBe(20 - (recipe.needs.wood ?? 0) * 3);
    expect(countItem(result.inventory, 'torch')).toBe(recipe.yields * 3);
  });

  it('refuses when an ingredient is short, and changes nothing', () => {
    const before = bag({ wood: 1, sap: 1 });
    const result = craft(before, ['torch'], 'torch', 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The sentence has to name what is missing rather than merely say no.
    expect(result.reason).toContain('thiếu');
  });

  it('takes nothing at all when the second ingredient is the short one', () => {
    // The dangerous shape: the wood comes out, and then the sap is not there.
    // A craft that half-succeeded would quietly eat the planks.
    const before = bag({ wood: 99, sap: 0 });
    const result = craft(before, ['torch'], 'torch', 1);
    expect(result.ok).toBe(false);
    expect(countItem(before, 'wood')).toBe(99);
  });

  it('refuses a recipe the player has not learned', () => {
    const result = craft(bag({ wood: 99, hardwood: 9 }), ['torch'], 'big-chest', 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('chưa biết');
  });

  it('refuses a recipe that does not exist', () => {
    expect(craft(bag(), ['torch'], 'not-a-thing', 1).ok).toBe(false);
  });

  it('refuses a count that is not a whole number above nought', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      expect(craft(bag({ wood: 99, sap: 9 }), ['torch'], 'torch', count).ok).toBe(false);
    }
  });

  it('refuses when there is nowhere to put the result', () => {
    // Every slot full of something the result cannot merge into, and the
    // ingredients held in stacks that do not empty a slot when spent.
    const full = fullBag('stone');
    const result = craft(full, ['torch'], 'torch', 1);
    expect(result.ok).toBe(false);
  });

  it('lets a craft that empties a slot use the slot it just freed', () => {
    // Fifty planks is the whole of the chest recipe, so the wood stack empties
    // and the chest goes into the slot it vacated. Checked because the order —
    // ingredients out first, result in second — is the only thing that makes
    // it work, and the opposite order is the obvious way to write it.
    const tight: Inventory = emptyInventory(1);
    tight[0] = newStack('wood', 50);
    const result = craft(tight, ['chest'], 'chest', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countItem(result.inventory, 'chest')).toBe(1);
    expect(countItem(result.inventory, 'wood')).toBe(0);
  });
});

describe('ingredient reporting', () => {
  it('reports both numbers so a row can say 34/50 rather than "not enough"', () => {
    const ingredients = ingredientsFor(recipeFor('chest')!, bag({ wood: 34 }));
    expect(ingredients).toEqual([{ item: 'wood', needs: 50, has: 34 }]);
  });

  it('says nothing when nothing is short', () => {
    expect(describeShortfall(recipeFor('chest')!, bag({ wood: 50 }))).toBe('');
  });
});

describe('unlocks', () => {
  it('opens a dated recipe on its day and not before', () => {
    const dated = ALL_RECIPES.find((recipe) => recipe.unlock.by === 'day')!;
    const on = dated.unlock.by === 'day' ? dated.unlock.day : 0;
    expect(unlockMet(dated.unlock, { day: on - 1, heartsFor: () => 0 })).toBe(false);
    expect(unlockMet(dated.unlock, { day: on, heartsFor: () => 0 })).toBe(true);
  });

  it('opens a hearted recipe at its threshold and not below', () => {
    const hearted = ALL_RECIPES.find((recipe) => recipe.unlock.by === 'hearts')!;
    if (hearted.unlock.by !== 'hearts') return;
    const { npc, hearts } = hearted.unlock;
    const heartsFor = (who: NpcId) => (who === npc ? hearts - 1 : 99);
    expect(unlockMet(hearted.unlock, { day: 1, heartsFor })).toBe(false);
    expect(unlockMet(hearted.unlock, { day: 1, heartsFor: () => hearts })).toBe(true);
  });

  it('never ripens a bought recipe, which is paid for rather than earned', () => {
    expect(unlockMet({ by: 'buy', cost: 10 }, { day: 999, heartsFor: () => 99 })).toBe(false);
  });

  it('offers a newly met recipe once, and never again once it is known', () => {
    const first = newlyUnlocked([...STARTING_RECIPES], { day: 999, heartsFor: () => 99 });
    expect(first.length).toBeGreaterThan(0);

    const known = [...STARTING_RECIPES, ...first.map((entry) => entry.recipe)];
    expect(newlyUnlocked(known, { day: 999, heartsFor: () => 99 })).toEqual([]);
  });

  it('offers nothing on the first morning to somebody who has met nobody', () => {
    expect(newlyUnlocked([...STARTING_RECIPES], NO_HEARTS)).toEqual([]);
  });

  it('carries the condition along, so a toast can say who gave it to you', () => {
    const learned = newlyUnlocked([...STARTING_RECIPES], { day: 1, heartsFor: () => 99 });
    const hearted = learned.find((entry) => entry.from.by === 'hearts');
    expect(hearted).toBeDefined();
    if (hearted?.from.by !== 'hearts') return;
    expect(hearted.from.npc).toBeTruthy();
  });
});

describe('the phố’s three dishes, spec 15', () => {
  const DISHES: ItemId[] = ['banh-chung', 'xoi-dau', 'che-dau'];

  it('are known from the first morning', () => {
    for (const dish of DISHES) expect(STARTING_RECIPES).toContain(dish);
  });

  it('ask for what the spec says, and make what it says', () => {
    expect(recipeFor('banh-chung')).toMatchObject({ needs: { nep: 4, fiber: 2 }, yields: 1 });
    expect(recipeFor('xoi-dau')).toMatchObject({ needs: { nep: 3, 'dau-xanh': 2 }, yields: 1 });
    expect(recipeFor('che-dau')).toMatchObject({ needs: { 'dau-xanh': 3, strawberry: 2 }, yields: 2 });
  });

  it('make the dish and take the ingredients when there are enough', () => {
    for (const dish of DISHES) {
      const recipe = recipeFor(dish)!;
      const before = bag({ ...recipe.needs });
      const result = craft(before, [...STARTING_RECIPES], dish, 1);
      expect(result.ok, dish).toBe(true);
      if (!result.ok) continue;
      expect(countItem(result.inventory, dish)).toBe(recipe.yields);
      for (const item of Object.keys(recipe.needs)) expect(countItem(result.inventory, item), `${dish} left ${item}`).toBe(0);
    }
  });

  it('refuse when one ingredient is short, and leave the satchel exactly as it was', () => {
    for (const dish of DISHES) {
      const recipe = recipeFor(dish)!;
      const [first, ...rest] = Object.entries(recipe.needs);
      const short = bag({ [first[0]]: (first[1] ?? 1) - 1, ...Object.fromEntries(rest) });
      const result = craft(short, [...STARTING_RECIPES], dish, 1);
      expect(result.ok, dish).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toContain('thiếu');
      expect(countItem(short, dish)).toBe(0);
      expect(countItem(short, first[0])).toBe((first[1] ?? 1) - 1);
    }
  });

  it('pay more as a dish than the ingredients do as produce', () => {
    // The point of cooking at all. Fibre is counted at its own price.
    for (const dish of DISHES) {
      const recipe = recipeFor(dish)!;
      const raw = Object.entries(recipe.needs).reduce((sum, [item, n]) => sum + ITEMS[item].sellPrice * (n ?? 0), 0);
      expect(ITEMS[dish].sellPrice * recipe.yields, dish).toBeGreaterThan(raw);
    }
  });
});
