import { describe, expect, it } from 'vitest';
import {
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  addItem,
  countItem,
  countProduce,
  createInventory,
  emptyInventory,
  freeSlots,
  hotbar,
  moveStack,
  newStack,
  refillCharges,
  removeItem,
  spendCharge,
  splitStack,
  type Inventory,
} from './inventory';
import { DEFAULT_STACK_SIZE, WATERING_CAN_CHARGES } from './items';

/** An inventory with every slot but the given ones filled with wood. */
function packedExcept(free: number[]): Inventory {
  return Array.from({ length: INVENTORY_SIZE }, (_, index) =>
    free.includes(index) ? null : newStack('wood', 1),
  );
}

describe('slots', () => {
  it('starts with the tools in reach and seeds to plant', () => {
    const inventory = createInventory();

    expect(inventory).toHaveLength(INVENTORY_SIZE);
    expect(inventory[0]?.item).toBe('hoe');
    expect(inventory[1]?.item).toBe('watering-can');
    expect(inventory[1]?.charges).toBe(WATERING_CAN_CHARGES);
    expect(inventory[2]?.item).toBe('basket');
    expect(countItem(inventory, 'turnip-seeds')).toBe(8);
    expect(hotbar(inventory)).toHaveLength(HOTBAR_SIZE);
  });

  it('keeps holes rather than compacting, so a stack stays where it was put', () => {
    let inventory = emptyInventory();
    inventory[3] = newStack('turnip', 4);
    inventory = addItem(inventory, 'strawberry', 1)!;

    // The strawberry took slot 0, the first free one; the turnips did not slide.
    expect(inventory[0]?.item).toBe('strawberry');
    expect(inventory[3]?.item).toBe('turnip');
    expect(inventory[1]).toBeNull();
  });
});

describe('stacking', () => {
  it('fills a stack to its stack size, then spills into the next free slot', () => {
    const inventory = addItem(emptyInventory(), 'turnip', DEFAULT_STACK_SIZE + 5);

    expect(inventory![0]).toEqual({ item: 'turnip', count: DEFAULT_STACK_SIZE });
    expect(inventory![1]).toEqual({ item: 'turnip', count: 5 });
    expect(countItem(inventory!, 'turnip')).toBe(DEFAULT_STACK_SIZE + 5);
  });

  it('tops up a partial stack before opening a new slot', () => {
    let inventory = emptyInventory();
    inventory[5] = newStack('turnip', DEFAULT_STACK_SIZE - 2);
    inventory = addItem(inventory, 'turnip', 3)!;

    expect(inventory[5]?.count).toBe(DEFAULT_STACK_SIZE);
    expect(inventory[0]).toEqual({ item: 'turnip', count: 1 });
  });

  it('refuses a pickup with no free slot and no partial stack, changing nothing', () => {
    const full = packedExcept([]);

    expect(addItem(full, 'turnip', 1)).toBeNull();
    // Same array, untouched: the caller can safely keep using it.
    expect(full.every((slot) => slot?.item === 'wood')).toBe(true);
  });

  it('refuses all of an amount that only partly fits', () => {
    const nearlyFull = packedExcept([7]);

    expect(addItem(nearlyFull, 'turnip', DEFAULT_STACK_SIZE + 1)).toBeNull();
    expect(addItem(nearlyFull, 'turnip', DEFAULT_STACK_SIZE)).not.toBeNull();
  });

  it('counts free slots and produce', () => {
    const inventory = packedExcept([1, 2, 3]);

    expect(freeSlots(inventory)).toBe(3);
    // Wood is not produce, so the market sees none of it.
    expect(countProduce(inventory)).toBe(0);
    expect(countProduce(addItem(inventory, 'turnip', 2)!)).toBe(2);
  });

  it('removes items from wherever they are, and refuses to overdraw', () => {
    const inventory = addItem(emptyInventory(), 'turnip', DEFAULT_STACK_SIZE + 4)!;

    expect(removeItem(inventory, 'turnip', DEFAULT_STACK_SIZE + 5)).toBeNull();
    const after = removeItem(inventory, 'turnip', DEFAULT_STACK_SIZE + 1)!;
    expect(countItem(after, 'turnip')).toBe(3);
  });
});

describe('rearranging', () => {
  it('merges two stacks of the same item', () => {
    let inventory = emptyInventory();
    inventory[0] = newStack('turnip', 3);
    inventory[4] = newStack('turnip', 5);

    const merged = moveStack(inventory, 0, 4);
    expect(merged[4]?.count).toBe(8);
    expect(merged[0]).toBeNull();
  });

  it('leaves the remainder behind when a merge overflows the stack size', () => {
    let inventory = emptyInventory();
    inventory[0] = newStack('turnip', 10);
    inventory[1] = newStack('turnip', DEFAULT_STACK_SIZE - 4);

    const merged = moveStack(inventory, 0, 1);
    expect(merged[1]?.count).toBe(DEFAULT_STACK_SIZE);
    expect(merged[0]?.count).toBe(6);
  });

  it('swaps two different items', () => {
    let inventory = emptyInventory();
    inventory[0] = newStack('hoe');
    inventory[9] = newStack('turnip', 2);

    const swapped = moveStack(inventory, 0, 9);
    expect(swapped[9]?.item).toBe('hoe');
    expect(swapped[0]?.item).toBe('turnip');
  });

  it('swaps two stacks that are both already full rather than doing nothing', () => {
    let inventory = emptyInventory();
    inventory[0] = newStack('turnip', DEFAULT_STACK_SIZE);
    inventory[1] = newStack('turnip', DEFAULT_STACK_SIZE);

    const moved = moveStack(inventory, 0, 1);
    expect(moved[0]?.count).toBe(DEFAULT_STACK_SIZE);
    expect(moved[1]?.count).toBe(DEFAULT_STACK_SIZE);
  });

  it('ignores out-of-range indices without throwing', () => {
    const inventory = createInventory();

    for (const [from, to] of [
      [-1, 0],
      [0, -1],
      [0, 999],
      [999, 0],
      [0.5, 1],
      [Number.NaN, 1],
      [0, 0],
    ]) {
      expect(moveStack(inventory, from, to)).toBe(inventory);
      expect(splitStack(inventory, from, to)).toBe(inventory);
    }
  });

  it('halves a stack into an empty slot, and refuses an occupied one', () => {
    let inventory = emptyInventory();
    inventory[0] = newStack('turnip', 7);
    inventory[2] = newStack('wood', 1);

    const split = splitStack(inventory, 0, 1);
    expect(split[0]?.count).toBe(4);
    expect(split[1]?.count).toBe(3);

    expect(splitStack(inventory, 0, 2)).toBe(inventory);
    // Nothing to halve.
    inventory[5] = newStack('turnip', 1);
    expect(splitStack(inventory, 5, 6)).toBe(inventory);
  });
});

describe('charges', () => {
  it('spends a pour at a time and refuses an empty can', () => {
    let inventory = createInventory();

    for (let i = 0; i < WATERING_CAN_CHARGES; i += 1) {
      inventory = spendCharge(inventory, 1)!;
    }
    expect(inventory[1]?.charges).toBe(0);
    expect(spendCharge(inventory, 1)).toBeNull();
    // The can itself is still there. It is empty, not gone.
    expect(inventory[1]?.item).toBe('watering-can');
  });

  it('refuses a slot that holds nothing, or something with no charges', () => {
    const inventory = createInventory();

    expect(spendCharge(inventory, 0)).toBeNull();
    expect(spendCharge(inventory, 20)).toBeNull();
  });

  it('refills every can overnight and leaves everything else alone', () => {
    const spent = spendCharge(createInventory(), 1)!;
    const morning = refillCharges(spent);

    expect(morning[1]?.charges).toBe(WATERING_CAN_CHARGES);
    expect(morning[0]).toEqual(spent[0]);
    // Nothing to do twice: an untouched inventory keeps its identity.
    expect(refillCharges(morning)).toBe(morning);
  });
});
