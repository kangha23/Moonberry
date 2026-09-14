import { describe, expect, it } from 'vitest';
import { applyFarmAction, advancePlotDay, createPlot, sellAllCrops } from './farming';
import { addCrop, createSatchel } from './satchel';

function growTurnip() {
  let plot = createPlot(4, 4);
  let satchel = createSatchel();

  ({ plot, satchel } = applyFarmAction(plot, satchel, 'till'));
  ({ plot, satchel } = applyFarmAction(plot, satchel, 'plant', 'turnip'));
  ({ plot, satchel } = applyFarmAction(plot, satchel, 'water'));
  plot = advancePlotDay(plot, false);
  ({ plot, satchel } = applyFarmAction(plot, satchel, 'water'));
  plot = advancePlotDay(plot, false);

  return { plot, satchel };
}

describe('farming lifecycle', () => {
  it('tills, plants, waters, grows, and harvests a turnip', () => {
    let { plot, satchel } = growTurnip();

    expect(plot.stage).toBe('mature');
    expect(satchel.seeds.turnip).toBe(7);
    expect(satchel.water).toBe(10);

    const harvest = applyFarmAction(plot, satchel, 'harvest');
    plot = harvest.plot;
    satchel = harvest.satchel;

    expect(harvest.changed).toBe(true);
    expect(harvest.harvestedCrop).toBe('turnip');
    expect(plot.stage).toBe('tilled');
    expect(plot.crop).toBeNull();
    expect(satchel.crops.turnip).toBe(1);
  });

  it('does not spend seeds on untilled plots', () => {
    const plot = createPlot(2, 3);
    const satchel = createSatchel();

    const result = applyFarmAction(plot, satchel, 'plant', 'strawberry');

    expect(result.changed).toBe(false);
    expect(result.satchel.seeds.strawberry).toBe(2);
    expect(result.plot.crop).toBeNull();
  });

  it('rainy days advance watered crops without spending water', () => {
    let plot = createPlot(1, 1);
    let satchel = createSatchel();
    ({ plot, satchel } = applyFarmAction(plot, satchel, 'till'));
    ({ plot, satchel } = applyFarmAction(plot, satchel, 'plant', 'turnip'));

    plot = advancePlotDay(plot, true);
    plot = advancePlotDay(plot, true);

    expect(plot.stage).toBe('mature');
    expect(satchel.water).toBe(12);
  });
});

describe('market economy', () => {
  it('sells every harvested crop for the sum of sell prices and clears the basket', () => {
    let satchel = createSatchel();
    satchel = addCrop(satchel, 'turnip', 3);
    satchel = addCrop(satchel, 'strawberry', 2);

    const sale = sellAllCrops(satchel);

    expect(sale.changed).toBe(true);
    expect(sale.soldCount).toBe(5);
    expect(sale.coinsEarned).toBe(3 * 18 + 2 * 32);
    expect(sale.satchel.crops.turnip).toBe(0);
    expect(sale.satchel.crops.strawberry).toBe(0);
  });

  it('does nothing when the basket is empty', () => {
    const satchel = createSatchel();

    const sale = sellAllCrops(satchel);

    expect(sale.changed).toBe(false);
    expect(sale.soldCount).toBe(0);
    expect(sale.coinsEarned).toBe(0);
    expect(sale.satchel).toBe(satchel);
  });
});
