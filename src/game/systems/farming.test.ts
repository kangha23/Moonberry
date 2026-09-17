import { describe, expect, it } from 'vitest';
import {
  ACTION_ENERGY_COST,
  CROP_DEFINITIONS,
  applyFarmAction,
  advancePlotDay,
  createPlot,
  cropsForSeason,
  growsIn,
  harvestPlot,
  isWithering,
  killOutOfSeasonCrops,
  plantCrop,
  sellAllCrops,
  tillPlot,
  type PlotState,
} from './farming';
import {
  INVENTORY_SIZE,
  addItem,
  countItem,
  createInventory,
  emptyInventory,
  newStack,
  type Inventory,
} from './inventory';
import { DEFAULT_STACK_SIZE, ITEMS, WATERING_CAN_CHARGES, type CropId } from './items';
import { SEASON_DAYS, type Season } from './time';

/** Where the starting tools and seeds sit, by the layout `createInventory` uses. */
const SLOT = {
  hoe: 0,
  can: 1,
  basket: 2,
  axe: 3,
  pickaxe: 4,
  scythe: 5,
  turnipSeeds: 6,
  berrySeeds: 7,
};

/** The season the starting seeds belong to, and so the one most tests are in. */
const SPRING: Season = 'Spring';

function growTurnip() {
  let plot = createPlot(2, 2);
  let inventory = createInventory();

  ({ plot, inventory } = applyFarmAction(plot, inventory, SLOT.hoe, SPRING));
  ({ plot, inventory } = applyFarmAction(plot, inventory, SLOT.turnipSeeds, SPRING));
  ({ plot, inventory } = applyFarmAction(plot, inventory, SLOT.can, SPRING));
  plot = advancePlotDay(plot, false);
  ({ plot, inventory } = applyFarmAction(plot, inventory, SLOT.can, SPRING));
  plot = advancePlotDay(plot, false);

  return { plot, inventory };
}

describe('the farming loop, slot by slot', () => {
  it('tills, plants, waters and harvests using whatever is in hand', () => {
    let { plot, inventory } = growTurnip();

    expect(plot.stage).toBe('mature');
    expect(countItem(inventory, 'turnip-seeds')).toBe(7);
    expect(inventory[SLOT.can]?.charges).toBe(WATERING_CAN_CHARGES - 2);

    const harvest = applyFarmAction(plot, inventory, SLOT.basket, SPRING);
    plot = harvest.plot;
    inventory = harvest.inventory;

    expect(harvest.changed).toBe(true);
    expect(harvest.action).toBe('harvest');
    expect(harvest.harvestedCrop).toBe('turnip');
    expect(plot.stage).toBe('tilled');
    expect(plot.crop).toBeNull();
    expect(countItem(inventory, 'turnip')).toBe(1);
  });

  it('plants whatever the held packet grows, not a separately chosen crop', () => {
    let plot = createPlot(1, 1);
    const inventory = createInventory();
    plot = applyFarmAction(plot, inventory, SLOT.hoe, SPRING).plot;

    const result = applyFarmAction(plot, inventory, SLOT.berrySeeds, SPRING);

    expect(result.action).toBe('plant');
    expect(result.plot.crop).toBe('strawberry');
    expect(countItem(result.inventory, 'strawberry-seeds')).toBe(1);
  });

  it('does nothing with an empty selected slot', () => {
    const plot = createPlot(1, 1);
    const inventory = emptyInventory();

    const result = applyFarmAction(plot, inventory, 0, SPRING);

    expect(result.changed).toBe(false);
    expect(result.action).toBeUndefined();
    expect(result.plot).toBe(plot);
    expect(result.inventory).toBe(inventory);
    expect(result.energyCost).toBe(0);
  });

  it('does nothing with a non-tool item, however ripe the plot is', () => {
    const { plot } = growTurnip();
    let inventory = emptyInventory();
    inventory[0] = newStack('wood', 3);

    const result = applyFarmAction(plot, inventory, 0, SPRING);

    expect(result.changed).toBe(false);
    expect(result.plot).toBe(plot);
    expect(result.inventory).toBe(inventory);
    // The crop is still standing there, ripe.
    expect(result.plot.stage).toBe('mature');
  });

  it('refuses a harvest into a full satchel and leaves the crop in the ground', () => {
    const { plot } = growTurnip();
    // Every slot taken, none of them turnips, and a basket to swing.
    const inventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => newStack('wood', 1));
    inventory[SLOT.basket] = newStack('basket');

    const result = applyFarmAction(plot, inventory, SLOT.basket, SPRING);

    expect(result.changed).toBe(false);
    expect(result.message).toMatch(/không còn chỗ/i);
    expect(result.plot).toBe(plot);
    expect(result.plot.stage).toBe('mature');
    expect(result.inventory).toBe(inventory);
    expect(result.energyCost).toBe(0);
  });

  it('still harvests into a full satchel when a turnip stack has room', () => {
    const { plot } = growTurnip();
    const inventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => newStack('wood', 1));
    inventory[SLOT.basket] = newStack('basket');
    inventory[10] = newStack('turnip', 4);

    const result = applyFarmAction(plot, inventory, SLOT.basket, SPRING);

    expect(result.changed).toBe(true);
    expect(result.inventory[10]?.count).toBe(5);
  });

  it('refuses to water from an empty can, and the plot is untouched', () => {
    let plot = createPlot(3, 3);
    let inventory = createInventory();
    ({ plot, inventory } = applyFarmAction(plot, inventory, SLOT.hoe, SPRING));
    ({ plot, inventory } = applyFarmAction(plot, inventory, SLOT.turnipSeeds, SPRING));
    inventory = inventory.map((slot, i) => (i === SLOT.can ? { ...slot!, charges: 0 } : slot));

    const result = applyFarmAction(plot, inventory, SLOT.can, SPRING);

    expect(result.changed).toBe(false);
    expect(result.message).toMatch(/đã cạn/i);
    expect(result.plot.wateredToday).toBe(false);
  });

  it('costs a seed only when the plot accepts it', () => {
    const wild = createPlot(4, 4);
    const inventory = createInventory();

    const refused = applyFarmAction(wild, inventory, SLOT.turnipSeeds, SPRING);

    expect(refused.changed).toBe(false);
    expect(countItem(refused.inventory, 'turnip-seeds')).toBe(8);
  });

  it('charges energy for work done and nothing for work refused', () => {
    let plot = createPlot(5, 5);
    let inventory = createInventory();

    const tilled = applyFarmAction(plot, inventory, SLOT.hoe, SPRING);
    expect(tilled.energyCost).toBe(ACTION_ENERGY_COST.till);
    ({ plot, inventory } = tilled);

    // The same swing at soil that is already prepared costs nothing.
    expect(applyFarmAction(plot, inventory, SLOT.hoe, SPRING).energyCost).toBe(0);

    const planted = applyFarmAction(plot, inventory, SLOT.turnipSeeds, SPRING);
    expect(planted.energyCost).toBe(ACTION_ENERGY_COST.plant);
    ({ plot, inventory } = planted);

    const watered = applyFarmAction(plot, inventory, SLOT.can, SPRING);
    expect(watered.energyCost).toBe(ACTION_ENERGY_COST.water);
    ({ plot, inventory } = watered);

    expect(applyFarmAction(plot, inventory, SLOT.basket, SPRING).energyCost).toBe(0);
  });
});

describe('selling at the market', () => {
  it('empties every produce stack and pays the item table price', () => {
    let inventory = createInventory();
    inventory = addItem(inventory, 'turnip', 3)!;
    inventory = addItem(inventory, 'strawberry', 2)!;

    const sale = sellAllCrops(inventory);

    expect(sale.changed).toBe(true);
    expect(sale.soldCount).toBe(5);
    expect(sale.coinsEarned).toBe(3 * ITEMS.turnip.sellPrice + 2 * ITEMS.strawberry.sellPrice);
    expect(countItem(sale.inventory, 'turnip')).toBe(0);
    expect(countItem(sale.inventory, 'strawberry')).toBe(0);
  });

  it('sells the crops and keeps the tools, the seeds and the timber', () => {
    let inventory = addItem(createInventory(), 'turnip', 2)!;
    inventory = addItem(inventory, 'wood', 5)!;

    const sale = sellAllCrops(inventory);

    expect(countItem(sale.inventory, 'hoe')).toBe(1);
    expect(countItem(sale.inventory, 'turnip-seeds')).toBe(8);
    // The materials are the point of this line. They carry a `sellPrice` and
    // no `produce`, so a trip to the stall can never quietly sell the timber
    // somebody has been saving for a coop.
    expect(countItem(sale.inventory, 'wood')).toBe(5);
    expect(countItem(sale.inventory, 'turnip')).toBe(0);
  });

  it('clears crops spread across more than one stack', () => {
    const inventory = addItem(emptyInventory(), 'turnip', DEFAULT_STACK_SIZE + 6)!;

    const sale = sellAllCrops(inventory);

    expect(sale.soldCount).toBe(DEFAULT_STACK_SIZE + 6);
    expect(countItem(sale.inventory, 'turnip')).toBe(0);
  });

  it('refuses an empty basket without touching the inventory', () => {
    const inventory = createInventory();

    const sale = sellAllCrops(inventory);

    expect(sale.changed).toBe(false);
    expect(sale.coinsEarned).toBe(0);
    expect(sale.inventory).toBe(inventory);
  });
});

/** A plot with a ripe crop of the given kind, without playing the days out. */
function ripe(crop: CropId): PlotState {
  return {
    ...createPlot(0, 0),
    stage: 'mature',
    crop,
    daysWatered: CROP_DEFINITIONS[crop].growDays,
    wateredToday: false,
  };
}

/** A plot map of one plot, which is all `killOutOfSeasonCrops` needs. */
function field(...plots: PlotState[]): Record<string, PlotState> {
  return Object.fromEntries(plots.map((plot, index) => [`farm:${index}`, plot]));
}

describe('the crop catalogue', () => {
  // Table-driven on purpose: the cost of a typo here is a crop that exists,
  // sits in the item table, has art, and can never once be planted.
  it.each(Object.values(CROP_DEFINITIONS))('$id is plantable somewhere', (crop) => {
    expect(crop.seasons.length).toBeGreaterThan(0);
    for (const season of crop.seasons) {
      expect(['Spring', 'Summer', 'Autumn', 'Winter']).toContain(season);
    }
  });

  it.each(Object.values(CROP_DEFINITIONS))('$id has a seed and a produce item', (crop) => {
    expect(ITEMS[crop.seed]?.plants).toBe(crop.id);
    expect(ITEMS[crop.produce]?.produce).toBe(true);
    expect(ITEMS[crop.seed]?.buyPrice).toBeGreaterThan(0);
  });

  it.each(Object.values(CROP_DEFINITIONS))('$id ripens inside a single season', (crop) => {
    // A crop that cannot finish even when planted on the first morning is a
    // crop that can only ever be bought by mistake.
    expect(crop.growDays).toBeLessThan(SEASON_DAYS);
    if (crop.regrowDays !== null) expect(crop.regrowDays).toBeLessThan(crop.growDays);
  });

  it('stocks every growing season, and leaves winter fallow on purpose', () => {
    for (const season of ['Spring', 'Summer', 'Autumn'] as const) {
      expect(cropsForSeason(season).length).toBeGreaterThanOrEqual(3);
    }
    // Spec 17: winter is the mine's, the river's and the phố's. See the note
    // in the catalogue.
    expect(cropsForSeason('Winter')).toEqual([]);
  });
});

describe('planting against the calendar', () => {
  it('refuses a crop that will not live in this season, and spends no seed', () => {
    const tilled = tillPlot(createPlot(1, 1));
    const inventory = createInventory();

    const refused = applyFarmAction(tilled, inventory, SLOT.turnipSeeds, 'Winter');

    expect(refused.changed).toBe(false);
    expect(refused.plot).toBe(tilled);
    expect(refused.plot.crop).toBeNull();
    expect(refused.energyCost).toBe(0);
    expect(countItem(refused.inventory, 'turnip-seeds')).toBe(8);
    expect(refused.message).toMatch(/không mọc được vào mùa Đông/);
  });

  it('accepts a crop that lists this season', () => {
    const tilled = tillPlot(createPlot(1, 1));

    expect(plantCrop(tilled, 'turnip', 'Spring')?.crop).toBe('turnip');
    expect(plantCrop(tilled, 'turnip', 'Summer')).toBeNull();
    // Wheat spans two, and is plantable in both of them.
    expect(plantCrop(tilled, 'wheat', 'Summer')?.crop).toBe('wheat');
    expect(plantCrop(tilled, 'wheat', 'Autumn')?.crop).toBe('wheat');
    expect(plantCrop(tilled, 'wheat', 'Spring')).toBeNull();
  });
});

describe('crops that regrow', () => {
  it('yields produce and stays in the ground with its regrow timer set', () => {
    const { growDays, regrowDays } = CROP_DEFINITIONS.strawberry;
    const harvest = harvestPlot(ripe('strawberry'));

    expect(harvest?.crop).toBe('strawberry');
    expect(harvest?.plot.crop).toBe('strawberry');
    expect(harvest?.plot.stage).not.toBe('mature');
    // `regrowDays` waterings from ripe again, not `growDays`.
    expect(growDays - harvest!.plot.daysWatered).toBe(regrowDays);
  });

  it('ripens again after exactly regrowDays of water', () => {
    const { regrowDays } = CROP_DEFINITIONS.strawberry;
    let plot = harvestPlot(ripe('strawberry'))!.plot;

    for (let day = 0; day < regrowDays!; day += 1) {
      expect(plot.stage).not.toBe('mature');
      plot = advancePlotDay({ ...plot, wateredToday: true }, false);
    }

    expect(plot.stage).toBe('mature');
    expect(harvestPlot(plot)?.crop).toBe('strawberry');
  });

  it('leaves a one-and-done crop as bare tilled soil', () => {
    const harvest = harvestPlot(ripe('turnip'));

    expect(harvest?.plot.crop).toBeNull();
    expect(harvest?.plot.stage).toBe('tilled');
    expect(harvest?.plot.daysWatered).toBe(0);
  });
});

describe('the season boundary', () => {
  it('kills exactly the crops that do not list the new season', () => {
    const plots = field(ripe('melon'), ripe('wheat'), ripe('tomato'), createPlot(9, 9));

    const result = killOutOfSeasonCrops(plots, 'Autumn');

    expect(result.count).toBe(2);
    expect(result.crops.sort()).toEqual(['melon', 'tomato']);
    expect(result.plots['farm:0'].crop).toBeNull();
    expect(result.plots['farm:0'].stage).toBe('tilled');
    // Wheat lists autumn, so it is not touched at all — the same object back.
    expect(result.plots['farm:1']).toBe(plots['farm:1']);
    expect(result.plots['farm:2'].crop).toBeNull();
    expect(result.plots['farm:3']).toBe(plots['farm:3']);
  });

  it('kills a regrowing crop too, however established it is', () => {
    const established = harvestPlot(ripe('strawberry'))!.plot;

    const result = killOutOfSeasonCrops(field(established), 'Summer');

    expect(result.count).toBe(1);
    expect(result.crops).toEqual(['strawberry']);
    expect(result.plots['farm:0'].crop).toBeNull();
  });

  it('returns the same plot map when nothing died', () => {
    const plots = field(ripe('turnip'), createPlot(2, 2));

    const result = killOutOfSeasonCrops(plots, 'Spring');

    expect(result.count).toBe(0);
    expect(result.crops).toEqual([]);
    expect(result.plots).toBe(plots);
  });
});

describe('the wilting warning', () => {
  it('warns on the last three days of a season and not before', () => {
    // Day 25 is the twenty-fifth of spring, so four days are left.
    expect(isWithering('turnip', 25)).toBe(false);
    expect(isWithering('turnip', 26)).toBe(true);
    expect(isWithering('turnip', 28)).toBe(true);
    // The first of summer: the turnips are already gone, and what is in the
    // ground now has a whole season ahead of it.
    expect(isWithering('melon', 29)).toBe(false);
  });

  it('leaves a crop that survives the turn alone', () => {
    // Wheat runs summer into autumn, so the last days of summer are ordinary.
    expect(growsIn('wheat', 'Autumn')).toBe(true);
    expect(isWithering('wheat', SEASON_DAYS * 2)).toBe(false);
    // And the last days of autumn are not, because nothing carries into winter.
    expect(isWithering('wheat', SEASON_DAYS * 3)).toBe(true);
  });
});
