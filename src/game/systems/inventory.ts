import { ITEMS, STARTING_TOOLS, itemDef, stackSizeOf, type ItemId } from './items';

/**
 * One player's carried items: a fixed-length grid of slots, each holding a
 * stack or nothing. Coins deliberately live on the farm instead — the wallet
 * is shared between everyone on a farm, an inventory is not.
 *
 * Slots are an array with holes rather than a list that compacts. A player who
 * puts turnips in slot 3 expects them in slot 3 after picking something else
 * up, so `null` is a real value here and never something to squeeze out.
 */
export interface ItemStack {
  item: ItemId;
  count: number;
  /** Set only for an item that holds something: the watering can's pours. */
  charges?: number;
}

export type Inventory = Array<ItemStack | null>;

/** How many slots a farmhand carries. Upgradeable in spec 06 — one place. */
export const INVENTORY_SIZE = 24;

/**
 * How many of those are the hotbar.
 *
 * The hotbar is not a separate array, it is the first window onto this one, so
 * moving something into reach is moving it between slots and needs no special
 * case anywhere.
 */
export const HOTBAR_SIZE = 12;

export function emptyInventory(size = INVENTORY_SIZE): Inventory {
  return Array.from({ length: size }, () => null);
}

/** A stack of a fresh item, with its charges topped up if it has any. */
export function newStack(item: ItemId, count = 1): ItemStack {
  const def = itemDef(item);
  const stack: ItemStack = { item, count: Math.min(count, def.stackSize) };
  if (def.charges !== undefined) stack.charges = def.charges;
  return stack;
}

/**
 * What a new farmhand starts with: the tools in reach, and seeds to plant.
 *
 * No wood. There used to be five planks here and no way on earth to get a
 * sixth, which made them a decoration rather than a resource. There is an axe
 * in the hotbar now and a farm that has gone to scrub, so the planks are
 * something you go and get.
 */
export function createInventory(): Inventory {
  const inventory = emptyInventory();
  STARTING_TOOLS.forEach((tool, index) => {
    inventory[index] = newStack(tool);
  });
  inventory[STARTING_TOOLS.length] = newStack('turnip-seeds', 8);
  inventory[STARTING_TOOLS.length + 1] = newStack('strawberry-seeds', 2);
  return inventory;
}

export function cloneInventory(inventory: Inventory): Inventory {
  return inventory.map((slot) => (slot ? { ...slot } : null));
}

function isSlot(inventory: Inventory, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < inventory.length;
}

export function slotAt(inventory: Inventory, index: number): ItemStack | null {
  return isSlot(inventory, index) ? inventory[index] : null;
}

/** The slice the hotbar shows. A window, not a copy of the truth. */
export function hotbar(inventory: Inventory): Inventory {
  return inventory.slice(0, HOTBAR_SIZE);
}

export function countItem(inventory: Inventory, item: ItemId): number {
  return inventory.reduce((total, slot) => (slot?.item === item ? total + slot.count : total), 0);
}

/** Everything the market stall buys, summed. */
export function countProduce(inventory: Inventory): number {
  return inventory.reduce(
    (total, slot) => (slot && ITEMS[slot.item]?.produce ? total + slot.count : total),
    0,
  );
}

export function freeSlots(inventory: Inventory): number {
  return inventory.reduce((total, slot) => (slot === null ? total + 1 : total), 0);
}

/**
 * Adds items, topping up partial stacks before opening a new slot.
 *
 * All or nothing: returns null when the whole amount does not fit, and the
 * caller leaves the crop in the ground. Dropping the remainder on the floor
 * would need world items, pickup and despawn rules; losing it silently is
 * worse than either.
 */
export function addItem(inventory: Inventory, item: ItemId, count = 1): Inventory | null {
  if (count <= 0) return inventory;
  const max = stackSizeOf(item);
  const next = cloneInventory(inventory);
  let left = count;

  for (let i = 0; i < next.length && left > 0; i += 1) {
    const slot = next[i];
    if (slot?.item !== item || slot.count >= max) continue;
    const room = Math.min(max - slot.count, left);
    next[i] = { ...slot, count: slot.count + room };
    left -= room;
  }

  for (let i = 0; i < next.length && left > 0; i += 1) {
    if (next[i] !== null) continue;
    const taken = Math.min(max, left);
    next[i] = { ...newStack(item, taken), count: taken };
    left -= taken;
  }

  return left > 0 ? null : next;
}

/** True when `count` of an item would fit without displacing anything. */
export function hasRoomFor(inventory: Inventory, item: ItemId, count = 1): boolean {
  return addItem(inventory, item, count) !== null;
}

/**
 * Takes `count` off one slot, emptying it when the stack runs out. Returns
 * null when that slot does not hold enough.
 */
export function takeFromSlot(inventory: Inventory, index: number, count = 1): Inventory | null {
  const slot = slotAt(inventory, index);
  if (!slot || slot.count < count) return null;
  const next = cloneInventory(inventory);
  next[index] = slot.count === count ? null : { ...slot, count: slot.count - count };
  return next;
}

/** Removes items from wherever they are. Null when there are not enough. */
export function removeItem(inventory: Inventory, item: ItemId, count = 1): Inventory | null {
  if (countItem(inventory, item) < count) return null;
  const next = cloneInventory(inventory);
  let left = count;
  for (let i = 0; i < next.length && left > 0; i += 1) {
    const slot = next[i];
    if (slot?.item !== item) continue;
    const taken = Math.min(slot.count, left);
    next[i] = slot.count === taken ? null : { ...slot, count: slot.count - taken };
    left -= taken;
  }
  return next;
}

/** Empties every slot holding `item`, reporting how many were there. */
export function clearItem(
  inventory: Inventory,
  item: ItemId,
): { inventory: Inventory; removed: number } {
  let removed = 0;
  const next = inventory.map((slot) => {
    if (slot?.item !== item) return slot;
    removed += slot.count;
    return null;
  });
  return { inventory: next, removed };
}

/** Spends one charge from the item in a slot. Null when it holds none. */
export function spendCharge(inventory: Inventory, index: number): Inventory | null {
  const slot = slotAt(inventory, index);
  if (!slot || slot.charges === undefined || slot.charges <= 0) return null;
  const next = cloneInventory(inventory);
  next[index] = { ...slot, charges: slot.charges - 1 };
  return next;
}

/** Tops every charged item back up to its capacity. Runs each morning. */
export function refillCharges(inventory: Inventory): Inventory {
  let changed = false;
  const next = inventory.map((slot) => {
    if (!slot) return slot;
    const capacity = ITEMS[slot.item]?.charges;
    if (capacity === undefined || slot.charges === capacity) return slot;
    changed = true;
    return { ...slot, charges: capacity };
  });
  return changed ? next : inventory;
}

/**
 * Rearranges two slots: merges same-item stacks up to the stack size, and
 * swaps anything else.
 *
 * Out-of-range indices change nothing rather than throwing. A malformed client
 * reaches this with slot -1 or 999, and the safe answer to both is a shrug.
 */
export function moveStack(inventory: Inventory, from: number, to: number): Inventory {
  if (!isSlot(inventory, from) || !isSlot(inventory, to) || from === to) return inventory;
  const source = inventory[from];
  if (!source) return inventory;

  const target = inventory[to];
  const next = cloneInventory(inventory);

  if (target && target.item === source.item) {
    const room = Math.min(stackSizeOf(source.item) - target.count, source.count);
    // Two full stacks have nothing to merge, so they fall through and swap.
    if (room > 0) {
      next[to] = { ...target, count: target.count + room };
      next[from] = source.count === room ? null : { ...source, count: source.count - room };
      return next;
    }
  }

  next[to] = source;
  next[from] = target;
  return next;
}

/**
 * Moves a stack between two containers — a satchel and a chest — or within
 * either of them.
 *
 * Implemented by laying the two side by side, calling `moveStack` on the join
 * and cutting it back in half, which is not a trick for its own sake: it means
 * dragging a stack of turnips from a satchel into a chest merges, swaps and
 * respects the stack size by running *the same code* that dragging it across
 * the satchel runs. A second implementation of those rules is a second
 * implementation to keep in step, and stacking rules are exactly the kind that
 * drift apart quietly.
 *
 * Slots are numbered within each side, so a caller says "chest slot 3" rather
 * than doing the offset arithmetic itself.
 */
export function moveBetween(
  left: Inventory,
  right: Inventory,
  from: { side: 'left' | 'right'; slot: number },
  to: { side: 'left' | 'right'; slot: number },
): { left: Inventory; right: Inventory } {
  const index = (ref: { side: 'left' | 'right'; slot: number }) =>
    ref.side === 'left' ? ref.slot : left.length + ref.slot;

  const joined = [...left, ...right];
  const moved = moveStack(joined, index(from), index(to));
  return { left: moved.slice(0, left.length), right: moved.slice(left.length) };
}

/**
 * Tops up every stack the target already holds, out of the source.
 *
 * What the chest panel's one button does. Deliberately *not* "put everything
 * in": a button that swept the hoe and the day's seed into a box because it
 * was the nearest box is a button people learn not to press. Only items the
 * chest already has a stack of move, which makes it the thing it is actually
 * for — coming home and emptying the morning's wood into the wood chest.
 */
export function topUpFrom(
  source: Inventory,
  target: Inventory,
): { source: Inventory; target: Inventory; moved: number } {
  let from = source;
  let into = target;
  let moved = 0;

  for (let i = 0; i < from.length; i += 1) {
    const stack = from[i];
    if (!stack) continue;
    // Only what is already there, and never anything that holds charges —
    // a watering can is not a thing you have thirty of.
    if (stack.charges !== undefined) continue;
    if (countItem(into, stack.item) === 0) continue;

    const before = countItem(into, stack.item);
    const filled = addItem(into, stack.item, stack.count);
    if (!filled) continue;
    const took = countItem(filled, stack.item) - before;
    if (took <= 0) continue;

    into = filled;
    from = from.map((slot, index) =>
      index === i ? (stack.count === took ? null : { ...stack, count: stack.count - took }) : slot,
    );
    moved += took;
  }

  return { source: from, target: into, moved };
}

/**
 * Splits half a stack into an empty slot. Refuses anything else: merging half
 * a stack into an occupied one is what `moveStack` is for.
 */
export function splitStack(inventory: Inventory, from: number, to: number): Inventory {
  if (!isSlot(inventory, from) || !isSlot(inventory, to) || from === to) return inventory;
  const source = inventory[from];
  if (!source || source.count < 2 || inventory[to] !== null) return inventory;

  const taken = Math.floor(source.count / 2);
  const next = cloneInventory(inventory);
  next[from] = { ...source, count: source.count - taken };
  next[to] = { ...source, count: taken };
  return next;
}
