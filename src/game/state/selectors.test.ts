import { describe, expect, it } from 'vitest';
import { DAY_END } from '../systems/time';
import { areaMap } from '../world/areas';
import {
  energyRatio,
  formatClock,
  promptFor,
  openPanel,
  stillAwake,
  stockFor,
  waitingOnLabel,
} from './selectors';
import { applyIntent, createFarmState } from './reducer';
import type { FarmStoreState } from './store';
import { STARTING_MAX_ENERGY, type FarmState, type PlayerId } from './types';

function farmWith(...ids: PlayerId[]): FarmState {
  return ids.reduce(
    (state, id) => applyIntent(state, { type: 'player/join', playerId: id, name: id.toUpperCase() }).state,
    createFarmState(),
  );
}

/** Enough of a store for the selectors that read one. */
function storeWith(farm: FarmState, localPlayerId: PlayerId | null, message = 'Nothing yet.'): FarmStoreState {
  return {
    farm,
    localPlayerId,
    message,
    restored: false,
    online: false,
    inviteCode: null,
    connectionError: null,
    inventoryOpen: false,
    buildKind: null,
    sceneReady: true,
    menuOpen: false,
    summaryOpen: false,
  };
}

describe('the clock past midnight', () => {
  it('reads 26:10 as 2:10 AM rather than running off the end of the day', () => {
    expect(formatClock(DAY_END + 10)).toBe('2:10 SA');
    expect(formatClock(24 * 60)).toBe('12:00 SA');
    expect(formatClock(23 * 60 + 40)).toBe('11:40 CH');
  });
});

describe('the sleep vote, as the player sees it', () => {
  it('names who is still up, and nobody once they are all in bed', () => {
    let farm = farmWith('a', 'b', 'c');
    farm = { ...farm, players: { ...farm.players, a: { ...farm.players.a, asleep: true } } };

    expect(waitingOnLabel(farm, 'a')).toContain('2 nông dân');
    expect(waitingOnLabel(farm, 'a')).toContain('B, C');

    const allIn = {
      ...farm,
      players: Object.fromEntries(
        Object.entries(farm.players).map(([id, player]) => [id, { ...player, asleep: true }]),
      ),
    };
    expect(waitingOnLabel(allIn, 'a')).toBe('');
  });

  it('counts only the people who are actually here', () => {
    let farm = farmWith('a', 'b');
    farm = applyIntent(farm, { type: 'player/leave', playerId: 'b' }).state;

    expect(stillAwake(farm).map((player) => player.id)).toEqual(['a']);
  });
});

describe('energy readouts', () => {
  it('reports a fraction of the bar, clamped at both ends', () => {
    const farm = farmWith('a');
    const player = farm.players.a;

    expect(energyRatio(player)).toBe(1);
    expect(energyRatio({ ...player, energy: STARTING_MAX_ENERGY / 2 })).toBeCloseTo(0.5, 6);
    expect(energyRatio({ ...player, energy: 0 })).toBe(0);
    expect(energyRatio(null)).toBe(0);
  });

  it('tells a player standing at the bed what turning in would cost them', () => {
    const bed = areaMap('farmhouse').props.find((prop) => prop.interact === 'bed')!;
    let farm = farmWith('a');
    farm = {
      ...farm,
      players: {
        ...farm.players,
        a: {
          ...farm.players.a,
          area: 'farmhouse',
          x: bed.x + bed.width / 2,
          y: bed.y + bed.height + 8,
          energy: 42,
        },
      },
    };

    expect(promptFor(storeWith(farm, 'a'))).toContain('42/270');
  });
});

describe('the market stall, as the player sees it', () => {
  /** Puts a player at whichever tile the market prop stands on. */
  function atMarket(farm: FarmState, id: PlayerId): FarmState {
    for (const area of ['farm', 'village'] as const) {
      for (const prop of areaMap(area).props) {
        if (prop.interact !== 'market') continue;
        return {
          ...farm,
          players: {
            ...farm.players,
            [id]: {
              ...farm.players[id],
              area,
              x: prop.x + prop.width / 2,
              y: prop.y + prop.height / 2,
            },
          },
        };
      }
    }
    throw new Error('No market prop on any map.');
  }

  it('is shut until the player opens it, and open once they have', () => {
    const farm = atMarket(farmWith('a'), 'a');

    expect(openPanel(storeWith(farm, 'a'))).toBeNull();

    const opened = applyIntent(farm, { type: 'player/act', playerId: 'a' }).state;

    expect(openPanel(storeWith(opened, 'a'))).toBe('market');
  });

  it('offers to open the stall, then explains it once it is open', () => {
    const farm = atMarket(farmWith('a'), 'a');

    expect(promptFor(storeWith(farm, 'a'))).toMatch(/hạt giống gì/);

    const opened = applyIntent(farm, { type: 'player/act', playerId: 'a' }).state;

    expect(promptFor(storeWith(opened, 'a'))).toMatch(/mua hạt giống/i);
  });

  it('stocks what the season grows, and hands back the same array each read', () => {
    const spring = storeWith(farmWith('a'), 'a');

    expect(stockFor(spring).map((entry) => entry.item)).toContain('turnip-seeds');
    expect(stockFor(spring).map((entry) => entry.item)).not.toContain('pumpkin-seeds');
    // Identity matters: zustand compares by reference, and a fresh array on
    // every read would be a re-render on every read.
    expect(stockFor(spring)).toBe(stockFor(spring));

    const autumn = storeWith({ ...spring.farm, season: 'Autumn' }, 'a');
    expect(stockFor(autumn).map((entry) => entry.item)).toContain('pumpkin-seeds');
    expect(stockFor(autumn)).not.toBe(stockFor(spring));
  });
});

describe('standing next to somebody, as the player sees it', () => {
  /** A farm with one player parked within arm's reach of a villager. */
  function besideRowan(message = 'Nothing yet.'): FarmStoreState {
    const farm = farmWith('a');
    const rowan = farm.npcs.find((actor) => actor.id === 'rowan')!;
    const placed: FarmState = {
      ...farm,
      players: {
        ...farm.players,
        a: { ...farm.players.a, area: rowan.area, x: rowan.x, y: rowan.y + 26 },
      },
    };
    return storeWith(placed, 'a', message);
  }

  /** The same, with one of something in hand. */
  function holding(store: FarmStoreState, item: string): FarmStoreState {
    const player = store.farm.players.a;
    const inventory = player.inventory.map((slot, index) => (index === 5 ? { item, count: 1 } : slot));
    return {
      ...store,
      farm: {
        ...store.farm,
        players: { ...store.farm.players, a: { ...player, inventory, selectedSlot: 5 } },
      },
    };
  }

  it('names the villager and offers to talk', () => {
    expect(promptFor(besideRowan())).toContain('Rowan');
    expect(promptFor(besideRowan())).toMatch(/Space\/Enter để trò chuyện/);
  });

  it('offers the gift instead when the thing in hand can be given', () => {
    const prompt = promptFor(holding(besideRowan(), 'turnip'));
    expect(prompt).toMatch(/Space\/Enter để tặng củ cải/);
  });

  it('still offers a chat when the thing in hand is a tool', () => {
    const prompt = promptFor(holding(besideRowan(), 'hoe'));
    expect(prompt).toMatch(/Space\/Enter để trò chuyện/);
  });

  it('says so rather than promising a gift that would be refused', () => {
    const store = holding(besideRowan(), 'turnip');
    const spent: FarmStoreState = {
      ...store,
      farm: {
        ...store.farm,
        players: {
          ...store.farm.players,
          a: {
            ...store.farm.players.a,
            relationships: { rowan: { points: 40, giftsThisWeek: 1, giftedToday: true } },
          },
        },
      },
    };

    expect(promptFor(spent)).toMatch(/đã nhận quà rồi/i);
  });

  it('lets what they just said outrank the offer to make them say it', () => {
    // Otherwise the hint paints back over the line the instant it is spoken,
    // and the dialogue is never actually readable.
    const prompt = promptFor(besideRowan('Rowan: "Good land, that."'));
    expect(prompt).toContain('Good land, that.');
    expect(prompt).not.toMatch(/Space\/Enter để trò chuyện/);
  });

  it('goes back to the offer once something else has happened', () => {
    expect(promptFor(besideRowan('Đất tơi ra, sẵn sàng cho hạt giống.'))).toMatch(/Space\/Enter để trò chuyện/);
  });

  it('shows the hearts once there are any to show', () => {
    const store = besideRowan();
    const friendly: FarmStoreState = {
      ...store,
      farm: {
        ...store.farm,
        players: {
          ...store.farm.players,
          a: {
            ...store.farm.players.a,
            relationships: { rowan: { points: 800, giftsThisWeek: 0, giftedToday: false } },
          },
        },
      },
    };

    // 800 points is three hearts, and the prompt is where a player reads that.
    expect(promptFor(friendly)).toContain('♥♥♥');
    expect(promptFor(store)).not.toContain('♥');
  });

  it('says nothing about anybody when nobody is near', () => {
    const store = besideRowan();
    const away: FarmStoreState = {
      ...store,
      farm: {
        ...store.farm,
        players: {
          ...store.farm.players,
          a: { ...store.farm.players.a, x: store.farm.players.a.x + 600 },
        },
      },
    };

    expect(promptFor(away)).toBe('Nothing yet.');
  });
});
