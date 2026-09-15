import { describe, expect, it } from 'vitest';
import { applyIntent, createFarmState } from '../state/reducer';
import { HOTBAR_SIZE, INVENTORY_SIZE } from '../systems/inventory';
import { MAX_ANIMAL_NAME, MAX_HAY_PURCHASE } from '../systems/animals';
import { MAX_BUY } from '../systems/shop';
import { MAX_AREA_TILES } from '../world/areas';
import { parseClientCommand, toMoveUpdates } from './protocol';

describe('accepting well-formed commands', () => {
  it('accepts every command a client may send', () => {
    expect(parseClientCommand({ type: 'move', dx: -1, dy: 1 })).toEqual({ type: 'move', dx: -1, dy: 1 });
    expect(parseClientCommand({ type: 'selectSlot', slot: 3 })).toEqual({ type: 'selectSlot', slot: 3 });
    expect(parseClientCommand({ type: 'moveStack', from: 0, to: 23 })).toEqual({
      type: 'moveStack',
      from: 0,
      to: 23,
    });
    expect(parseClientCommand({ type: 'splitStack', from: 4, to: 5 })).toEqual({
      type: 'splitStack',
      from: 4,
      to: 5,
    });
    expect(parseClientCommand({ type: 'act' })).toEqual({ type: 'act' });
    expect(parseClientCommand({ type: 'sleep' })).toEqual({ type: 'sleep' });
  });

  it('keeps nothing a sleep command tries to smuggle in', () => {
    // Where a player may sleep is the reducer's call, not a field on the wire.
    expect(parseClientCommand({ type: 'sleep', playerId: 'somebody', asleep: true })).toEqual({ type: 'sleep' });
  });

  it('accepts a stopped movement input', () => {
    expect(parseClientCommand({ type: 'move', dx: 0, dy: 0 })).toEqual({ type: 'move', dx: 0, dy: 0 });
  });
});

describe('rejecting malformed commands', () => {
  it('drops anything that is not a command object', () => {
    for (const raw of [null, undefined, 42, 'act', [], true]) {
      expect(parseClientCommand(raw)).toBeNull();
    }
  });

  it('drops unknown command types', () => {
    expect(parseClientCommand({ type: 'player/act' })).toBeNull();
    expect(parseClientCommand({ type: 'world/tick', deltaMs: 10 })).toBeNull();
    expect(parseClientCommand({ type: 'grantCoins', amount: 9999 })).toBeNull();
    expect(parseClientCommand({})).toBeNull();
  });

});

/**
 * The likeliest place in the protocol for a malformed client to reach past the
 * end of an array, so every index is checked as a whole number inside the grid
 * rather than merely confirmed to be a number.
 */
describe('slot indices cannot reach past the grid', () => {
  const badIndices = [
    -1,
    -0.0001,
    HOTBAR_SIZE + 100,
    INVENTORY_SIZE,
    999,
    1.5,
    Number.NaN,
    Infinity,
    -Infinity,
    '0',
    null,
    undefined,
    {},
    [1],
  ];

  it('refuses a held slot outside the hotbar', () => {
    for (const slot of [...badIndices, HOTBAR_SIZE]) {
      expect(parseClientCommand({ type: 'selectSlot', slot })).toBeNull();
    }
    expect(parseClientCommand({ type: 'selectSlot' })).toBeNull();
    // The last slot in reach is still in reach.
    expect(parseClientCommand({ type: 'selectSlot', slot: HOTBAR_SIZE - 1 })).not.toBeNull();
  });

  it('refuses either end of a rearrangement outside the grid', () => {
    for (const type of ['moveStack', 'splitStack']) {
      for (const bad of badIndices) {
        expect(parseClientCommand({ type, from: bad, to: 0 })).toBeNull();
        expect(parseClientCommand({ type, from: 0, to: bad })).toBeNull();
      }
      expect(parseClientCommand({ type })).toBeNull();
      expect(parseClientCommand({ type, from: 0 })).toBeNull();
      expect(parseClientCommand({ type, from: 0, to: INVENTORY_SIZE - 1 })).not.toBeNull();
    }
  });
});

describe('movement cannot be used to cheat', () => {
  it('refuses an oversized movement axis', () => {
    expect(parseClientCommand({ type: 'move', dx: 500, dy: 0 })).toBeNull();
    expect(parseClientCommand({ type: 'move', dx: 1.5, dy: 0 })).toBeNull();
    expect(parseClientCommand({ type: 'move', dx: -1, dy: Infinity })).toBeNull();
    expect(parseClientCommand({ type: 'move', dx: '1', dy: 0 })).toBeNull();
  });

  it('gives a client no way to state its own timestep', () => {
    const parsed = parseClientCommand({ type: 'move', dx: 1, dy: 0, deltaMs: 100000 });

    expect(parsed).toEqual({ type: 'move', dx: 1, dy: 0 });
    expect(parsed).not.toHaveProperty('deltaMs');
  });
});

describe('a client cannot act as another player', () => {
  it('strips any player id smuggled into the payload', () => {
    const commands = [
      { type: 'act', playerId: 'someone-else' },
      { type: 'selectSlot', slot: 0, playerId: 'someone-else' },
      { type: 'moveStack', from: 0, to: 1, playerId: 'someone-else' },
      { type: 'move', dx: 1, dy: 0, playerId: 'someone-else' },
    ];

    for (const raw of commands) {
      expect(parseClientCommand(raw)).not.toHaveProperty('playerId');
    }
  });
});

describe('move updates', () => {
  it('reports one entry per seated player', () => {
    let farm = createFarmState();
    farm = applyIntent(farm, { type: 'player/join', playerId: 'a', name: 'A' }).state;
    farm = applyIntent(farm, { type: 'player/join', playerId: 'b', name: 'B' }).state;

    const updates = toMoveUpdates(farm);

    expect(updates.map((update) => update.id).sort()).toEqual(['a', 'b']);
    expect(updates[0]).toHaveProperty('facing');
  });

  it('carries only where a player is, never inventories or coins', () => {
    const farm = applyIntent(createFarmState(), { type: 'player/join', playerId: 'a', name: 'A' }).state;

    expect(Object.keys(toMoveUpdates(farm)[0]).sort()).toEqual(['area', 'facing', 'id', 'x', 'y']);
  });

  it('says which map each player is on, so doorways are visible to everyone', () => {
    let farm = applyIntent(createFarmState(), { type: 'player/join', playerId: 'a', name: 'A' }).state;
    farm = {
      ...farm,
      players: { ...farm.players, a: { ...farm.players.a, area: 'village' } },
    };

    expect(toMoveUpdates(farm)[0].area).toBe('village');
  });

  it('rounds coordinates so float noise does not inflate every packet', () => {
    let farm = applyIntent(createFarmState(), { type: 'player/join', playerId: 'a', name: 'A' }).state;
    farm = applyIntent(farm, { type: 'player/move', playerId: 'a', dx: 1, dy: 1, deltaMs: 17 }).state;

    const { x } = toMoveUpdates(farm)[0];

    expect(x).toBe(Math.round(x * 100) / 100);
  });
});

describe('the buy command off the wire', () => {
  it('accepts a known item and a whole number of packets', () => {
    expect(parseClientCommand({ type: 'buy', item: 'turnip-seeds', count: 3 })).toEqual({
      type: 'buy',
      item: 'turnip-seeds',
      count: 3,
    });
  });

  it('drops an item this build has never heard of', () => {
    for (const item of ['moonfruit-seeds', '', null, 42, { item: 'turnip-seeds' }]) {
      expect(parseClientCommand({ type: 'buy', item, count: 1 })).toBeNull();
    }
  });

  it('drops a count that is not a sane whole number', () => {
    for (const count of [0, -1, 1.5, MAX_BUY + 1, Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
      expect(parseClientCommand({ type: 'buy', item: 'turnip-seeds', count })).toBeNull();
    }
  });

  it('carries no price, so a client cannot name one', () => {
    const parsed = parseClientCommand({
      type: 'buy',
      item: 'turnip-seeds',
      count: 1,
      price: 0,
      free: true,
    });

    expect(Object.keys(parsed!).sort()).toEqual(['count', 'item', 'type']);
  });

  it('accepts closing a counter, which carries nothing at all', () => {
    expect(parseClientCommand({ type: 'closePanel' })).toEqual({ type: 'closePanel' });
  });
});

/**
 * The tile an `act` may name.
 *
 * The parser's job is shape, not permission: a target that survives it names
 * a tile that could exist on some map in this build. Whether the sender can
 * reach it is the reducer's question, asked against a position the client
 * never gets to supply.
 */
describe('the tile an act names', () => {
  it('keeps a well-formed target', () => {
    expect(parseClientCommand({ type: 'act', target: { x: 12, y: 7 } })).toEqual({
      type: 'act',
      target: { x: 12, y: 7 },
    });
  });

  it('treats an absent target as the faced tile, exactly as before', () => {
    expect(parseClientCommand({ type: 'act' })).toEqual({ type: 'act' });
    expect(parseClientCommand({ type: 'act', target: undefined })).toEqual({ type: 'act' });
  });

  it('drops the whole command when the target is malformed', () => {
    // Dropped rather than downgraded to a keyboard swing: coercing nonsense
    // into a valid action is how a fuzzer gets to act by sending rubbish.
    for (const target of [
      { x: 1.5, y: 2 },
      { x: -1, y: 2 },
      { x: 2, y: -0.0001 },
      { x: MAX_AREA_TILES, y: 0 },
      { x: 0, y: MAX_AREA_TILES + 1000 },
      { x: 1e9, y: 1e9 },
      { x: Number.NaN, y: 0 },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: '3', y: '4' },
      { x: 3 },
      {},
      [],
      null,
      'over there',
      7,
    ]) {
      expect(parseClientCommand({ type: 'act', target })).toBeNull();
    }
  });
});

describe('the forge commands off the wire', () => {
  it('accepts a tool this build knows about, and nothing else', () => {
    expect(parseClientCommand({ type: 'upgradeTool', item: 'hoe' })).toEqual({
      type: 'upgradeTool',
      item: 'hoe',
    });

    // Whether it is a tool, whether it has a rung above it, whether the
    // satchel holds one and whether the wallet covers it are all the
    // reducer's answers. A string naming nothing stops here.
    for (const item of ['mithril-hoe', '', 'turnip-seeds__proto__', 42, null, undefined, {}]) {
      expect(parseClientCommand({ type: 'upgradeTool', item })).toBeNull();
    }
  });

  it('accepts collecting, which carries nothing at all', () => {
    expect(parseClientCommand({ type: 'collectTool' })).toEqual({ type: 'collectTool' });
  });
});

describe('the placement command off the wire', () => {
  it('accepts a known kind at a coordinate some map could have', () => {
    expect(parseClientCommand({ type: 'placeBuilding', kind: 'shed', x: 4, y: 9 })).toEqual({
      type: 'placeBuilding',
      kind: 'shed',
      x: 4,
      y: 9,
    });
  });

  it('carries nothing but the kind and the spot', () => {
    // Notably not a price and not a day: both come from the server's tables.
    const parsed = parseClientCommand({
      type: 'placeBuilding',
      kind: 'barn',
      x: 1,
      y: 1,
      cost: 0,
      readyOnDay: 1,
    });
    expect(Object.keys(parsed!).sort()).toEqual(['kind', 'type', 'x', 'y']);
  });

  it('drops a kind this build has never heard of', () => {
    for (const kind of ['castle', 'Shed', '', null, 7, {}, ['shed']]) {
      expect(parseClientCommand({ type: 'placeBuilding', kind, x: 1, y: 1 })).toBeNull();
    }
  });

  it('drops a spot that could not name a tile on any map', () => {
    // This command writes a solid rectangle into shared state, so a malformed
    // coordinate is dropped rather than rounded into something plausible.
    for (const spot of [
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 1.5, y: 0 },
      { x: MAX_AREA_TILES, y: 0 },
      { x: 0, y: 1e9 },
      { x: Number.NaN, y: 0 },
      { x: '3', y: 4 },
      { x: 3 },
    ]) {
      expect(parseClientCommand({ type: 'placeBuilding', kind: 'shed', ...spot })).toBeNull();
    }
  });
});

describe('the herd, off the wire', () => {
  it('accepts the seven commands the animals added', () => {
    expect(parseClientCommand({ type: 'buyAnimal', kind: 'cow', home: 'b2', name: 'Sữa' })).toEqual({
      type: 'buyAnimal',
      kind: 'cow',
      home: 'b2',
      name: 'Sữa',
    });
    expect(parseClientCommand({ type: 'sellAnimal', animalId: 'a3' })).toEqual({
      type: 'sellAnimal',
      animalId: 'a3',
    });
    expect(parseClientCommand({ type: 'buyHay', count: 60 })).toEqual({ type: 'buyHay', count: 60 });
    expect(parseClientCommand({ type: 'petAnimal', animalId: 'a1' })).toEqual({
      type: 'petAnimal',
      animalId: 'a1',
    });
    expect(parseClientCommand({ type: 'collectProduce', animalId: 'a1' })).toEqual({
      type: 'collectProduce',
      animalId: 'a1',
    });
    expect(parseClientCommand({ type: 'feedAnimal', animalId: 'a1' })).toEqual({
      type: 'feedAnimal',
      animalId: 'a1',
    });
    expect(parseClientCommand({ type: 'toggleDoor', buildingId: 'b1' })).toEqual({
      type: 'toggleDoor',
      buildingId: 'b1',
    });
  });

  it('keeps nothing a purchase tried to smuggle alongside it', () => {
    // Notably not a price and not an affection: both come from the server's
    // own tables, measured against the server's own farm.
    const parsed = parseClientCommand({
      type: 'buyAnimal',
      kind: 'chicken',
      home: 'b1',
      name: 'Mun',
      price: 0,
      affection: 1000,
    });
    expect(Object.keys(parsed!).sort()).toEqual(['home', 'kind', 'name', 'type']);
  });

  it('drops an animal this build has never heard of', () => {
    for (const kind of ['llama', 'Chicken', '', null, 7, {}, ['cow']]) {
      expect(parseClientCommand({ type: 'buyAnimal', kind, home: 'b1', name: 'Mun' })).toBeNull();
    }
  });

  it('drops a name that is empty, blank, or longer than a row', () => {
    for (const name of ['', '   ', 'x'.repeat(MAX_ANIMAL_NAME + 1), null, 7, {}]) {
      expect(parseClientCommand({ type: 'buyAnimal', kind: 'cow', home: 'b1', name })).toBeNull();
    }
  });

  it('trims the name here, so the length checked is the length stored', () => {
    const parsed = parseClientCommand({
      type: 'buyAnimal',
      kind: 'cow',
      home: 'b1',
      name: '  Sữa  ',
    });
    expect(parsed).toEqual({ type: 'buyAnimal', kind: 'cow', home: 'b1', name: 'Sữa' });
  });

  it('drops an id that is empty, absurd, or not a string', () => {
    for (const animalId of ['', 'a'.repeat(200), null, 7, {}, ['a1']]) {
      expect(parseClientCommand({ type: 'petAnimal', animalId })).toBeNull();
      expect(parseClientCommand({ type: 'collectProduce', animalId })).toBeNull();
      expect(parseClientCommand({ type: 'feedAnimal', animalId })).toBeNull();
      expect(parseClientCommand({ type: 'sellAnimal', animalId })).toBeNull();
      expect(parseClientCommand({ type: 'toggleDoor', buildingId: animalId })).toBeNull();
    }
  });

  it('drops a hay order that is not a whole number of bales in range', () => {
    for (const count of [0, -1, 1.5, MAX_HAY_PURCHASE + 1, 1e9, Number.NaN, '10', null]) {
      expect(parseClientCommand({ type: 'buyHay', count })).toBeNull();
    }
  });
});

describe('the fishing commands off the wire', () => {
  it('takes a cast at a well-formed tile', () => {
    expect(parseClientCommand({ type: 'cast', target: { x: 4, y: 9 } })).toEqual({
      type: 'cast',
      target: { x: 4, y: 9 },
    });
  });

  it('drops a cast with no target, which is a cast at nothing', () => {
    // Unlike `act`, where an absent target legitimately means the faced tile.
    expect(parseClientCommand({ type: 'cast' })).toBeNull();
  });

  it('drops a cast at a tile no map has', () => {
    expect(parseClientCommand({ type: 'cast', target: { x: -1, y: 4 } })).toBeNull();
    expect(parseClientCommand({ type: 'cast', target: { x: 2.5, y: 4 } })).toBeNull();
    expect(parseClientCommand({ type: 'cast', target: { x: 1e9, y: 4 } })).toBeNull();
  });

  it('takes the reel as a button state and nothing else', () => {
    expect(parseClientCommand({ type: 'reel', down: true })).toEqual({ type: 'reel', down: true });
    expect(parseClientCommand({ type: 'reel', down: false })).toEqual({ type: 'reel', down: false });
  });

  it('drops a reel that is not a boolean, however truthy', () => {
    expect(parseClientCommand({ type: 'reel', down: 1 })).toBeNull();
    expect(parseClientCommand({ type: 'reel', down: 'yes' })).toBeNull();
    expect(parseClientCommand({ type: 'reel' })).toBeNull();
  });

  /**
   * The check the whole minigame's honesty rests on.
   *
   * A client that could say where its square was could put it wherever the
   * fish is. There is no field here to say that in — the server owns the bar
   * and this says only whether the key is down — so a command carrying a
   * position keeps the parts that exist and silently loses the rest.
   */
  it('gives a client no way to say where its square is', () => {
    const parsed = parseClientCommand({ type: 'reel', down: true, barAt: 0.5, progress: 1 });
    expect(parsed).toEqual({ type: 'reel', down: true });
  });

  it('takes a cancel, which carries nothing to check', () => {
    expect(parseClientCommand({ type: 'cancelCast' })).toEqual({ type: 'cancelCast' });
  });
});
