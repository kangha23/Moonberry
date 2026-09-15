import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ShopPanel from './ShopPanel';
import { applyIntent, createFarmState } from '../game/state/reducer';
import { farmStore } from '../game/state/store';
import type { FarmState } from '../game/state/types';
import { countItem } from '../game/systems/inventory';
import { ITEMS } from '../game/systems/items';
import { areaMap } from '../game/world/areas';

/**
 * The seed counter, as the DOM.
 *
 * The reducer tests already prove the rules this panel obeys. What only a
 * render can show is that a season's stock reaches the screen, that the
 * buttons are disabled when the wallet cannot cover them, and that a click
 * actually reaches the store — the three ways a correct reducer still ships a
 * shop nobody can use.
 */

/** A farm with one player standing at the market stall, panel open. */
function atTheStall(): FarmState {
  let farm = applyIntent(createFarmState(), { type: 'player/join', playerId: 'a', name: 'A' }).state;
  for (const area of ['farm', 'village'] as const) {
    for (const prop of areaMap(area).props) {
      if (prop.interact !== 'market') continue;
      farm = {
        ...farm,
        players: {
          ...farm.players,
          a: {
            ...farm.players.a,
            area,
            x: prop.x + prop.width / 2,
            y: prop.y + prop.height / 2,
          },
        },
      };
    }
  }
  return applyIntent(farm, { type: 'player/act', playerId: 'a' }).state;
}

function show(farm: FarmState) {
  farmStore.setState({ farm, localPlayerId: 'a' });
  return render(<ShopPanel />);
}

function row(label: string) {
  return screen.getByText(label).closest('.shop-row') as HTMLElement;
}

beforeEach(() => {
  farmStore.setState({ farm: createFarmState(), localPlayerId: null, inventoryOpen: false });
});

afterEach(cleanup);

describe('the seed counter', () => {
  it('draws nothing at all until a player opens the stall', () => {
    const farm = applyIntent(createFarmState(), { type: 'player/join', playerId: 'a', name: 'A' }).state;

    const { container } = show(farm);

    expect(container.innerHTML).toBe('');
  });

  it('lists what this season grows, with its price and its terms', () => {
    show(atTheStall());

    expect(screen.getByRole('heading', { name: /sạp chợ — mùa xuân/i })).toBeDefined();
    const turnips = row('Hạt củ cải');
    expect(within(turnips).getByText(`${ITEMS['turnip-seeds'].buyPrice}g`)).toBeDefined();
    expect(turnips.textContent).toMatch(/2 ngày thì chín, rồi nhổ bỏ/);

    // The regrowing crop says so, because that is the whole reason to buy it.
    expect(row('Hạt dâu tây').textContent).toMatch(/rồi cứ 3 ngày một lứa/);

    // And another season's crop is simply not on the stall.
    expect(screen.queryByText('Hạt bí ngô')).toBeNull();
  });

  it('restocks itself when the season turns', () => {
    show({ ...atTheStall(), season: 'Winter' });

    // Winter's two hardy crops, and none of spring's.
    expect(screen.getByText('Meo nấm sương giá')).toBeDefined();
    expect(screen.getByText('Cành dâu đông')).toBeDefined();
    expect(screen.queryByText('Hạt củ cải')).toBeNull();
  });

  it('greys out what the wallet cannot cover, and leaves the rest alone', () => {
    const farm = atTheStall();
    const price = ITEMS['turnip-seeds'].buyPrice!;
    show({ ...farm, coins: price });

    const turnips = row('Hạt củ cải');
    const one = within(turnips).getByRole('button', { name: 'Mua 1' });
    const five = within(turnips).getByRole('button', { name: 'Mua 5' });

    expect(one.hasAttribute('disabled')).toBe(false);
    expect(five.hasAttribute('disabled')).toBe(true);
  });

  it('buys through the store, moving the shared wallet and the satchel', () => {
    show(atTheStall());
    const before = farmStore.getState().farm.coins;

    fireEvent.click(within(row('Hạt củ cải')).getByRole('button', { name: 'Mua 1' }));

    const farm = farmStore.getState().farm;
    expect(farm.coins).toBe(before - ITEMS['turnip-seeds'].buyPrice!);
    expect(countItem(farm.players.a.inventory, 'turnip-seeds')).toBe(9);
  });

  it('warns about a crop that cannot ripen before the season turns', () => {
    const farm = atTheStall();
    // The twenty-seventh of spring: two days left, and nothing but a turnip
    // has time to finish. The row is warned, never disabled — planting it
    // anyway is a choice the player is allowed to make.
    const late = { ...farm, time: { ...farm.time, day: 27 } };
    show(late);

    expect(row('Gốc đại hoàng').textContent).toMatch(/không kịp chín/);
    expect(row('Hạt củ cải').textContent).not.toMatch(/không kịp chín/);
  });

  it('closes through the store rather than a flag of its own', () => {
    show(atTheStall());

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));

    expect(farmStore.getState().farm.players.a.panel).toBeNull();
  });
});
