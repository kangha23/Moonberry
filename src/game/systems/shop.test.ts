import { describe, expect, it } from 'vitest';
import { cropsForSeason } from './farming';
import { countItem, createInventory, emptyInventory, newStack, type Inventory } from './inventory';
import { ITEMS, itemDef } from './items';
import { MAX_BUY, buyFromStall, sellAtStall, shopStock, stallFor, stocks } from './shop';

/** A satchel with no room at all, for the refusal paths. */
function fullSatchel(): Inventory {
  return Array.from({ length: 24 }, () => newStack('wood', 99));
}

describe('what the stall stocks', () => {
  it('lists the seed for every crop of the season, and nothing else', () => {
    for (const season of ['Spring', 'Summer', 'Autumn', 'Winter'] as const) {
      const stock = shopStock(season);
      expect(
        stock
          .filter((entry) => entry.kind === 'seed')
          .map((entry) => entry.item)
          .sort(),
      ).toEqual(
        cropsForSeason(season)
          .map((crop) => crop.seed)
          .sort(),
      );
      // Derived from the item table, so a new crop cannot ship unpriced.
      for (const entry of stock) expect(entry.price).toBe(itemDef(entry.item).buyPrice);
    }
  });

  it('carries the golden scythe and the rod all year, because neither is a season crop', () => {
    for (const season of ['Spring', 'Summer', 'Autumn', 'Winter'] as const) {
      const tools = shopStock(season).filter((entry) => entry.kind === 'tool');
      expect(tools.map((entry) => entry.item)).toEqual(['gold-scythe', 'fishing-rod']);
    }
  });

  it('does not stock produce, the forged tools, or the seed of another season', () => {
    expect(stocks('Spring', 'turnip-seeds')).toBe(true);
    expect(stocks('Spring', 'pumpkin-seeds')).toBe(false);
    expect(stocks('Spring', 'turnip')).toBe(false);
    // The blacksmith's ladder and the stall's counter never offer the same
    // thing: a hoe is forged, a golden scythe is bought, and neither is both.
    expect(stocks('Spring', 'hoe')).toBe(false);
    expect(stocks('Spring', 'gold-hoe')).toBe(false);
    expect(stocks('Spring', 'nonsense')).toBe(false);
  });

  it('sells a farmhand one scythe and refuses a second', () => {
    const first = buyFromStall(createInventory(), 10_000, 'Spring', 'gold-scythe', 1);
    expect(first.changed).toBe(true);
    expect(countItem(first.inventory, 'gold-scythe')).toBe(1);

    const again = buyFromStall(first.inventory, 10_000, 'Spring', 'gold-scythe', 1);
    expect(again.changed).toBe(false);
    // And never a stack of them, which `addItem` would otherwise happily do
    // across two slots at 4000g each.
    expect(buyFromStall(createInventory(), 99_000, 'Spring', 'gold-scythe', 2).changed).toBe(false);
  });
});

describe('buying seed', () => {
  const price = ITEMS['turnip-seeds'].buyPrice!;

  it('takes the coins and hands over the seed', () => {
    const result = buyFromStall(createInventory(), 100, 'Spring', 'turnip-seeds', 3);

    expect(result.changed).toBe(true);
    expect(result.spent).toBe(price * 3);
    expect(countItem(result.inventory, 'turnip-seeds')).toBe(11);
  });

  it('is refused when the wallet is short, and buys none rather than some', () => {
    const inventory = createInventory();

    const result = buyFromStall(inventory, price * 2, 'Spring', 'turnip-seeds', 3);

    expect(result.changed).toBe(false);
    expect(result.spent).toBe(0);
    expect(result.inventory).toBe(inventory);
    expect(result.message).toMatch(/giá 18g/);
  });

  it('is refused when the satchel is full, and costs nothing', () => {
    const inventory = fullSatchel();

    const result = buyFromStall(inventory, 10_000, 'Spring', 'turnip-seeds', 1);

    expect(result.changed).toBe(false);
    expect(result.spent).toBe(0);
    expect(result.inventory).toBe(inventory);
    expect(result.message).toMatch(/không còn chỗ/);
  });

  it('is refused for anything the season does not stock', () => {
    const outOfSeason = buyFromStall(emptyInventory(), 10_000, 'Spring', 'pumpkin-seeds', 1);
    expect(outOfSeason.changed).toBe(false);
    expect(outOfSeason.message).toMatch(/Xuân/);

    // Produce and tools are not merely unaffordable, they are not for sale.
    expect(buyFromStall(emptyInventory(), 10_000, 'Autumn', 'pumpkin', 1).changed).toBe(false);
    expect(buyFromStall(emptyInventory(), 10_000, 'Spring', 'hoe', 1).changed).toBe(false);
  });

  it('refuses a count that is not a sane whole number of packets', () => {
    for (const count of [0, -1, 1.5, MAX_BUY + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = buyFromStall(emptyInventory(), 10_000, 'Spring', 'turnip-seeds', count);
      expect(result.changed, `count ${count} should be refused`).toBe(false);
      expect(result.spent).toBe(0);
    }
  });

  it('spends exactly the coins it says it spent', () => {
    const wallet = 500;
    const result = buyFromStall(createInventory(), wallet, 'Spring', 'strawberry-seeds', 4);

    expect(result.changed).toBe(true);
    expect(result.spent).toBe(ITEMS['strawberry-seeds'].buyPrice! * 4);
    expect(result.spent).toBeLessThanOrEqual(wallet);
    expect(result.message).toContain(`${result.spent}g`);
  });
});

describe('Bà Xoan’s cart, spec 15', () => {
  it('sells the nếp and đậu xanh seed in summer, and nothing else', () => {
    const stock = shopStock('Summer', 'xoi-stall');
    expect(stock.map((entry) => entry.item).sort()).toEqual(['dau-xanh-seeds', 'nep-seeds']);
    expect(stock.find((entry) => entry.item === 'nep-seeds')?.price).toBe(60);
    expect(stock.find((entry) => entry.item === 'dau-xanh-seeds')?.price).toBe(50);
  });

  it('has no seed out of season and no tools ever', () => {
    for (const season of ['Spring', 'Autumn', 'Winter'] as const) {
      expect(shopStock(season, 'xoi-stall')).toEqual([]);
    }
    expect(stocks('Summer', 'fishing-rod', 'xoi-stall')).toBe(false);
    expect(stocks('Summer', 'melon-seeds', 'xoi-stall')).toBe(false);
  });

  it('leaves the market stocking the new seed too, because stock follows the crop table', () => {
    expect(stocks('Summer', 'nep-seeds')).toBe(true);
    expect(stocks('Summer', 'dau-xanh-seeds')).toBe(true);
  });

  it('refuses to sell at the cart what only the market stocks', () => {
    const result = buyFromStall(createInventory(), 10_000, 'Summer', 'melon-seeds', 1, 'xoi-stall');
    expect(result.changed).toBe(false);
    expect(result.spent).toBe(0);
  });

  it('buys only the three dishes, and leaves every other crop in the basket', () => {
    const inventory: Inventory = emptyInventory();
    inventory[0] = newStack('xoi-dau', 2);
    inventory[1] = newStack('melon', 3);
    inventory[2] = newStack('che-dau', 1);

    const sale = sellAtStall(inventory, 'xoi-stall');
    expect(sale.changed).toBe(true);
    expect(sale.soldCount).toBe(3);
    expect(sale.coinsEarned).toBe(2 * itemDef('xoi-dau').sellPrice + itemDef('che-dau').sellPrice);
    expect(countItem(sale.inventory, 'melon')).toBe(3);
    expect(countItem(sale.inventory, 'xoi-dau')).toBe(0);
  });

  it('says what it buys when the basket has none of it', () => {
    const inventory = emptyInventory();
    inventory[0] = newStack('melon', 3);
    const sale = sellAtStall(inventory, 'xoi-stall');
    expect(sale.changed).toBe(false);
    expect(sale.message).toContain('bánh chưng');
  });

  it('is found from the prop it is, and nothing else is a stall', () => {
    expect(stallFor('xoi-stall')).toBe('xoi-stall');
    expect(stallFor('market')).toBe('market');
    expect(stallFor('blacksmith')).toBeNull();
    expect(stallFor(null)).toBeNull();
  });
});
