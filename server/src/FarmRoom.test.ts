import { beforeEach, describe, expect, it } from 'vitest';
import { MSG, decodeFrame, encodeFrame, type ClientCommand } from '../../src/game/net/protocol';
import { MAX_PLAYERS, type FarmState } from '../../src/game/state/types';
import { countItem } from '../../src/game/systems/inventory';
import { ITEMS } from '../../src/game/systems/items';
import { checkPlacement } from '../../src/game/systems/buildings';
import { decodeSave, encodeSave } from '../../src/game/state/persistence';
import { START_AREA, TILE_SIZE, areaMap, plotKey } from '../../src/game/world/areas';
import { FarmRoom, type Connection } from './FarmRoom';

/** A connection that records what the server sent it. */
class FakeConnection implements Connection {
  readonly sent: Array<{ t: string; d: unknown }> = [];
  closed = false;

  constructor(readonly id: string) {}

  send(data: string): void {
    const frame = decodeFrame(data);
    if (frame) this.sent.push(frame);
  }

  close(): void {
    this.closed = true;
  }

  framesOf(type: string): unknown[] {
    return this.sent.filter((frame) => frame.t === type).map((frame) => frame.d);
  }

  latest(type: string): unknown {
    return this.framesOf(type).at(-1);
  }
}

function command(room: FarmRoom, playerId: string, payload: ClientCommand): void {
  room.receive(playerId, encodeFrame({ t: MSG.command, d: payload }));
}

/** Sends a raw string the way a modified or hostile client would. */
function raw(room: FarmRoom, playerId: string, payload: string): void {
  room.receive(playerId, payload);
}

/** The first farmable tile on the starting map. */
const FIELD = areaMap(START_AREA).plotTiles[0];

/** Where an interactive prop stands, and on which map. */
function propSpot(interact: string): { area: 'farm' | 'village'; x: number; y: number } {
  for (const area of ['farm', 'village'] as const) {
    for (const prop of areaMap(area).props) {
      if (prop.interact === interact) {
        return { area, x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 };
      }
    }
  }
  throw new Error(`No prop interacts as "${interact}".`);
}

let room: FarmRoom;
let alice: FakeConnection;
let bob: FakeConnection;

beforeEach(() => {
  room = new FarmRoom();
  alice = new FakeConnection('alice');
  bob = new FakeConnection('bob');
});

describe('seating players', () => {
  it('welcomes a joiner with its own id and the current farm', () => {
    room.join(alice);

    const welcome = alice.latest(MSG.welcome) as { playerId: string; farm: FarmState };

    expect(welcome.playerId).toBe('alice');
    expect(welcome.farm.players.alice).toBeDefined();
  });

  it('tells the players already seated that somebody arrived', () => {
    room.join(alice);
    room.join(bob);

    const sync = alice.latest(MSG.sync) as FarmState;

    expect(Object.keys(sync.players).sort()).toEqual(['alice', 'bob']);
    // The joiner gets a welcome instead of that sync, not both.
    expect(bob.framesOf(MSG.sync)).toHaveLength(0);
  });

  it('refuses a fifth player', () => {
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      expect(room.join(new FakeConnection(`p${i}`))).toBe(true);
    }

    expect(room.join(new FakeConnection('extra'))).toBe(false);
    expect(room.playerCount).toBe(MAX_PLAYERS);
  });

  it('drops the connection but keeps the place when a player leaves', () => {
    room.join(alice);
    room.join(bob);

    room.leave('alice');

    expect(room.playerCount).toBe(1);
    expect(room.memberCount).toBe(2);
    expect((bob.latest(MSG.sync) as FarmState).players.alice.online).toBe(false);
  });

  it('lets a member back in even when the world is full', () => {
    const members = [];
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      const connection = new FakeConnection(`p${i}`);
      members.push(connection);
      room.join(connection);
    }
    room.leave('p0');

    expect(room.isFull).toBe(true);
    // A newcomer is turned away, but somebody who already lives here is not.
    expect(room.join(new FakeConnection('newcomer'))).toBe(false);
    expect(room.join(new FakeConnection('p0'))).toBe(true);
  });

  it('restores a world it is handed instead of starting a fresh one', () => {
    const seeded = new FarmRoom();
    seeded.join(new FakeConnection('alice'));
    seeded.state.coins = 999;

    const resumed = new FarmRoom(seeded.state);

    expect(resumed.state.coins).toBe(999);
    expect(resumed.memberCount).toBe(1);
  });

  it('reports having changes to save only after something changed', () => {
    const fresh = new FarmRoom();
    expect(fresh.needsSaving).toBe(false);

    fresh.join(alice);
    expect(fresh.needsSaving).toBe(true);

    fresh.markSaved();
    expect(fresh.needsSaving).toBe(false);
  });

  it('ignores commands from a connection that is not seated', () => {
    room.join(alice);
    const before = room.state;

    command(room, 'ghost', { type: 'act' });
    room.tick(16);

    expect(room.state.players.ghost).toBeUndefined();
    expect(room.state.coins).toBe(before.coins);
  });
});

describe('the server is the authority', () => {
  it('applies a command to the sender, whatever the payload claims', () => {
    room.join(alice);
    room.join(bob);

    // Alice tries to put something in Bob's hand.
    room.receive(
      'alice',
      encodeFrame({ t: MSG.command, d: { type: 'selectSlot', slot: 4, playerId: 'bob' } as ClientCommand }),
    );
    room.tick(16);

    expect(room.state.players.alice.selectedSlot).toBe(4);
    expect(room.state.players.bob.selectedSlot).toBe(0);
  });

  it('refuses a slot index that would reach past the end of the grid', () => {
    room.join(alice);
    room.tick(16);
    const before = room.state.players.alice;

    for (const slot of [-1, 12, 24, 999, 1.5]) {
      raw(room, 'alice', JSON.stringify({ t: MSG.command, d: { type: 'selectSlot', slot } }));
    }
    for (const [from, to] of [
      [-1, 0],
      [0, 24],
      [999, 0],
      [0, 1.5],
    ]) {
      raw(room, 'alice', JSON.stringify({ t: MSG.command, d: { type: 'moveStack', from, to } }));
      raw(room, 'alice', JSON.stringify({ t: MSG.command, d: { type: 'splitStack', from, to } }));
    }
    room.tick(16);

    expect(room.state.players.alice.selectedSlot).toBe(before.selectedSlot);
    expect(room.state.players.alice.inventory).toEqual(before.inventory);
  });

  it('farms the tile a client names, but only one it could reach', () => {
    room.join(alice);
    room.tick(16);
    // Alice stands below the first plot, facing it, with a hoe in hand.
    Object.assign(room.state.players.alice, {
      x: FIELD.x * TILE_SIZE + 16,
      y: (FIELD.y + 1) * TILE_SIZE + 16,
      facing: 'up',
    });

    // A tile beside her: hers to work, even though she is facing elsewhere.
    const beside = { x: FIELD.x + 1, y: FIELD.y };
    command(room, 'alice', { type: 'act', target: beside });
    room.tick(16);

    expect(room.state.plots[plotKey(START_AREA, beside.x, beside.y)].stage).toBe('tilled');
    // Still wild: she never faced it and never named it.
    expect(room.state.plots[plotKey(START_AREA, FIELD.x, FIELD.y)].stage).toBe('wild');
  });

  it('refuses a well-formed act on a tile across the map', () => {
    room.join(alice);
    room.tick(16);
    Object.assign(room.state.players.alice, {
      x: FIELD.x * TILE_SIZE + 16,
      y: (FIELD.y + 1) * TILE_SIZE + 16,
      facing: 'up',
    });
    const distant = areaMap(START_AREA).plotTiles.find(
      (tile) => Math.abs(tile.x - FIELD.x) > 3 || Math.abs(tile.y - FIELD.y) > 3,
    );
    if (!distant) throw new Error('the field is too small to farm across');
    const before = room.state;

    // Nothing wrong with this packet: it parses, it names a real tile, and it
    // is refused anyway. Greying the tile out on the client is a courtesy;
    // this is where the rule is.
    command(room, 'alice', { type: 'act', target: distant });
    room.tick(16);

    expect(room.state.plots[plotKey(START_AREA, distant.x, distant.y)].stage).toBe('wild');
    expect(room.state.players.alice.energy).toBe(before.players.alice.energy);
  });

  it('rearranges the grid of whoever sent it, and nobody else', () => {
    room.join(alice);
    room.join(bob);
    const bobBefore = room.state.players.bob.inventory;

    raw(room, 'alice', JSON.stringify({ t: MSG.command, d: { type: 'moveStack', from: 0, to: 20 } }));
    room.tick(16);

    expect(room.state.players.alice.inventory[20]?.item).toBe('hoe');
    expect(room.state.players.alice.inventory[0]).toBeNull();
    expect(room.state.players.bob.inventory).toEqual(bobBefore);
  });

  it('ignores a client-supplied timestep and moves on its own clock', () => {
    room.join(alice);
    const startX = room.state.players.alice.x;

    // A cheating client claims an enormous delta to cover more ground.
    raw(room, 'alice', JSON.stringify({ t: MSG.command, d: { type: 'move', dx: 1, dy: 0, deltaMs: 100000 } }));
    room.tick(50);

    const travelled = room.state.players.alice.x - startX;

    // 132 px/s for 50ms is about 6.6px, nowhere near a 100s stride.
    expect(travelled).toBeGreaterThan(0);
    expect(travelled).toBeLessThan(10);
  });

  it('drops malformed frames without changing anything', () => {
    room.join(alice);
    room.tick(16);
    const before = room.state;

    raw(room, 'alice', 'not json');
    raw(room, 'alice', '{}');
    raw(room, 'alice', JSON.stringify({ t: 'nonsense', d: {} }));
    raw(room, 'alice', JSON.stringify({ t: MSG.command, d: { type: 'grantCoins', amount: 9999 } }));
    raw(room, 'alice', JSON.stringify({ t: MSG.command, d: { type: 'selectSlot', slot: 'first' } }));
    room.tick(16);

    expect(room.state.coins).toBe(before.coins);
    expect(room.state.players.alice.selectedSlot).toBe(0);
  });

  it('never lets a client drive the world clock', () => {
    room.join(alice);
    const day = room.state.time.day;

    raw(room, 'alice', JSON.stringify({ t: MSG.command, d: { type: 'world/tick', deltaMs: 9_000_000 } }));
    room.tick(16);

    expect(room.state.time.day).toBe(day);
  });
});

describe('what the room broadcasts', () => {
  it('sends positions every tick once somebody is playing', () => {
    room.join(alice);
    alice.sent.length = 0;

    room.tick(16);

    expect(alice.framesOf(MSG.moves)).toHaveLength(1);
  });

  it('sends a compact clock frame, not the whole farm, when only time moved', () => {
    room.join(alice);
    alice.sent.length = 0;

    // Enough ticks to cross one 1.2s in-game clock step.
    for (let i = 0; i < 25; i += 1) room.tick(50);

    expect(alice.framesOf(MSG.clock).length).toBeGreaterThan(0);
    expect(alice.framesOf(MSG.sync)).toHaveLength(0);
  });

  it('sends the whole farm when a plot changes', () => {
    room.join(alice);
    // Stand Alice below a plot, facing it.
    room.tick(16);
    Object.assign(room.state.players.alice, {
      x: FIELD.x * TILE_SIZE + 16,
      y: (FIELD.y + 1) * TILE_SIZE + 16,
      facing: 'up',
    });
    alice.sent.length = 0;

    command(room, 'alice', { type: 'act' });
    room.tick(16);

    const sync = alice.latest(MSG.sync) as FarmState;
    expect(sync.plots[plotKey(START_AREA, FIELD.x, FIELD.y)].stage).toBe('tilled');
  });

  it('reports action results as events', () => {
    room.join(alice);
    room.tick(16);
    Object.assign(room.state.players.alice, {
      x: FIELD.x * TILE_SIZE + 16,
      y: (FIELD.y + 1) * TILE_SIZE + 16,
      facing: 'up',
    });
    alice.sent.length = 0;

    command(room, 'alice', { type: 'act' });
    room.tick(16);

    const events = alice.latest(MSG.events) as { events: Array<{ kind: string }> };
    expect(events.events.some((event) => event.kind === 'plotChanged')).toBe(true);
  });

  it('stays quiet when nobody is connected', () => {
    room.join(alice);
    room.leave('alice');
    alice.sent.length = 0;

    for (let i = 0; i < 30; i += 1) room.tick(50);

    expect(alice.sent).toHaveLength(0);
  });
});

describe('turning in for the night', () => {
  /** Puts a connected player at the farmhouse door, where the bed is. */
  function standAtBed(playerId: string): void {
    const bed = areaMap(START_AREA).props.find((prop) => prop.interact === 'bed')!;
    Object.assign(room.state.players[playerId], {
      area: START_AREA,
      x: bed.x + bed.width / 2,
      y: bed.y + bed.height + 8,
    });
  }

  it('applies a sleep command to the sender and nobody else', () => {
    room.join(alice);
    room.join(bob);
    room.tick(16);
    standAtBed('alice');

    // Alice tries to send Bob to bed as well as herself.
    room.receive('alice', encodeFrame({ t: MSG.command, d: { type: 'sleep', playerId: 'bob' } as ClientCommand }));
    room.tick(16);

    expect(room.state.players.alice.asleep).toBe(true);
    expect(room.state.players.bob.asleep).toBe(false);
    expect(room.state.time.day).toBe(1);
  });

  it('rolls the day when the last player awake disconnects', () => {
    room.join(alice);
    room.join(bob);
    room.tick(16);
    standAtBed('alice');

    command(room, 'alice', { type: 'sleep' });
    room.tick(16);
    expect(room.state.time.day).toBe(1);

    // Bob logging off leaves nobody up, so the night must not hang on him.
    room.leave('bob');

    expect(room.state.time.day).toBe(2);
    expect(room.state.players.alice.asleep).toBe(false);
  });

  it('refuses to put a player to bed in the middle of a field', () => {
    room.join(alice);
    room.tick(16);

    command(room, 'alice', { type: 'sleep' });
    room.tick(16);

    expect(room.state.players.alice.asleep).toBe(false);
  });
});

describe('the farm is shared', () => {
  it('pays a quest reward into the wallet both players spend from', () => {
    room.join(alice);
    room.join(bob);
    room.tick(16);

    // Complete the quest outright, then let Bob collect it.
    Object.assign(room.state.quest, { progress: 3, completed: true });
    // Rowan walks a schedule, so where he is standing is asked of the world.
    const rowan = room.state.npcs.find((npc) => npc.id === 'rowan')!;
    Object.assign(room.state.players.bob, { area: rowan.area, x: rowan.x, y: rowan.y + 28 });
    const before = room.state.coins;

    command(room, 'bob', { type: 'act' });
    room.tick(16);

    expect(room.state.coins).toBeGreaterThan(before);
    // Alice sees the same wallet, because there is only one.
    expect((alice.latest(MSG.sync) as FarmState).coins).toBe(room.state.coins);
  });

  it('closes every connection on shutdown', () => {
    room.join(alice);
    room.join(bob);

    room.closeAll();

    expect(alice.closed).toBe(true);
    expect(bob.closed).toBe(true);
    expect(room.playerCount).toBe(0);
  });
});

describe('buying seed through the server', () => {
  /** Stands a player at the market stall, wherever the map puts it. */
  function standAtMarket(playerId: string): void {
    const market = propSpot('market');
    Object.assign(room.state.players[playerId], { area: market.area, x: market.x, y: market.y });
  }

  /** Stands a player somewhere no prop can be reached from. */
  function standInTheField(playerId: string): void {
    Object.assign(room.state.players[playerId], {
      area: START_AREA,
      x: FIELD.x * TILE_SIZE + 16,
      y: FIELD.y * TILE_SIZE + 16,
    });
  }

  const SEED = 'turnip-seeds';
  const PRICE = ITEMS[SEED].buyPrice!;

  it('sells to a player standing at the stall', () => {
    room.join(alice);
    standAtMarket('alice');
    const walletBefore = room.state.coins;

    command(room, 'alice', { type: 'buy', item: SEED, count: 2 });
    room.tick(16);

    expect(room.state.coins).toBe(walletBefore - PRICE * 2);
    expect(countItem(room.state.players.alice.inventory, SEED)).toBe(10);
  });

  // The rule that has to hold on the server whatever the client believes: a
  // modified client can send this from anywhere, and being in range is not a
  // value it gets to supply.
  it('refuses a player who is nowhere near the stall, however well-formed the command', () => {
    room.join(alice);
    standInTheField('alice');
    const walletBefore = room.state.coins;

    command(room, 'alice', { type: 'buy', item: SEED, count: 5 });
    room.tick(16);

    expect(room.state.coins).toBe(walletBefore);
    expect(countItem(room.state.players.alice.inventory, SEED)).toBe(8);
  });

  it('drops a malformed buy at the edge, without reaching the farm', () => {
    room.join(alice);
    standAtMarket('alice');
    const walletBefore = room.state.coins;

    for (const payload of [
      { type: 'buy', item: SEED, count: 0 },
      { type: 'buy', item: SEED, count: -4 },
      { type: 'buy', item: SEED, count: 1e9 },
      { type: 'buy', item: 'moonfruit-seeds', count: 1 },
      { type: 'buy', count: 1 },
    ]) {
      raw(room, 'alice', JSON.stringify({ t: MSG.command, d: payload }));
    }
    room.tick(16);

    expect(room.state.coins).toBe(walletBefore);
    expect(countItem(room.state.players.alice.inventory, SEED)).toBe(8);
  });

  it('spends the shared wallet, so one player can leave another short', () => {
    room.join(alice);
    room.join(bob);
    standAtMarket('alice');
    standAtMarket('bob');

    // Alice empties the wallet down to less than one packet.
    const affordable = Math.floor(room.state.coins / PRICE);
    command(room, 'alice', { type: 'buy', item: SEED, count: affordable });
    room.tick(16);
    command(room, 'bob', { type: 'buy', item: SEED, count: 1 });
    room.tick(16);

    expect(room.state.coins).toBeLessThan(PRICE);
    expect(countItem(room.state.players.alice.inventory, SEED)).toBe(8 + affordable);
    expect(countItem(room.state.players.bob.inventory, SEED)).toBe(8);
  });
});

describe('the forge and the carpenter through the server', () => {
  /** Stands a player at the blacksmith's anvil, wherever the map puts it. */
  function standAtForge(playerId: string): void {
    const forge = propSpot('blacksmith');
    Object.assign(room.state.players[playerId], { area: forge.area, x: forge.x, y: forge.y });
  }

  function standInTheField(playerId: string): void {
    Object.assign(room.state.players[playerId], {
      area: START_AREA,
      x: FIELD.x * TILE_SIZE + 16,
      y: FIELD.y * TILE_SIZE + 16,
    });
  }

  it('takes a tool in for work and charges the farm for it', () => {
    room.join(alice);
    standAtForge('alice');
    room.state.coins = 5000;
    const cost = ITEMS.hoe.upgradeCost!;

    command(room, 'alice', { type: 'upgradeTool', item: 'hoe' });
    room.tick(16);

    expect(countItem(room.state.players.alice.inventory, 'hoe')).toBe(0);
    expect(room.state.coins).toBe(5000 - cost);
    expect(room.state.players.alice.pendingUpgrade?.item).toBe('copper-hoe');
  });

  it('keeps a tool that is in for work across a restart', () => {
    const seeded = new FarmRoom();
    seeded.join(new FakeConnection('alice'));
    Object.assign(seeded.state.players.alice, propSpot('blacksmith'));
    seeded.state.coins = 5000;
    command(seeded, 'alice', { type: 'upgradeTool', item: 'hoe' });
    seeded.tick(16);
    const pending = seeded.state.players.alice.pendingUpgrade;
    expect(pending).not.toBeNull();

    // The world goes to storage and comes back, exactly as a server restart
    // does: through `encodeSave` and `decodeSave`, not by handing the object
    // straight over, because that is the path a real restart takes.
    const stored = decodeSave(encodeSave(seeded.state));
    expect(stored).not.toBeNull();
    const resumed = new FarmRoom(stored!);

    expect(resumed.state.players.alice.pendingUpgrade).toEqual(pending);
    expect(countItem(resumed.state.players.alice.inventory, 'hoe')).toBe(0);

    // And it can still be collected on the far side, on the right day.
    resumed.join(new FakeConnection('alice'));
    Object.assign(resumed.state.players.alice, propSpot('blacksmith'));
    resumed.state.time = { ...resumed.state.time, day: pending!.readyOnDay };
    command(resumed, 'alice', { type: 'collectTool' });
    resumed.tick(16);

    expect(countItem(resumed.state.players.alice.inventory, 'copper-hoe')).toBe(1);
    expect(resumed.state.players.alice.pendingUpgrade).toBeNull();
  });

  it('refuses a placement from a client standing on another map', () => {
    room.join(alice);
    room.state.coins = 100_000;
    // At the forge in the village, asking for a shed on the farm.
    standAtForge('alice');

    command(room, 'alice', { type: 'placeBuilding', kind: 'shed', x: 25, y: 9 });
    room.tick(16);

    expect(room.state.buildings).toHaveLength(0);
    expect(room.state.coins).toBe(100_000);
  });

  it('accepts a placement from a client standing on the farm, and syncs it', () => {
    room.join(alice);
    room.state.coins = 100_000;
    standInTheField('alice');
    const spot = firstShedSpot();

    command(room, 'alice', { type: 'placeBuilding', kind: 'shed', x: spot.x, y: spot.y });
    room.tick(16);

    expect(room.state.buildings).toHaveLength(1);
    // A building is shared state, so everybody gets the whole farm rather than
    // only the positions — `buildings` is part of what makes a tick "changed".
    const synced = alice.latest(MSG.sync) as FarmState | undefined;
    expect(synced?.buildings).toHaveLength(1);
  });

  it('drops a placement naming a building this build has never heard of', () => {
    room.join(alice);
    room.state.coins = 100_000;
    standInTheField('alice');
    const before = room.state;

    raw(room, 'alice', JSON.stringify({ t: MSG.command, d: { type: 'placeBuilding', kind: 'castle', x: 2, y: 2 } }));
    room.tick(16);

    expect(room.state.buildings).toBe(before.buildings);
    expect(room.state.coins).toBe(100_000);
  });

  /** The first spot on the farm that would actually take a shed. */
  function firstShedSpot(): { x: number; y: number } {
    const map = areaMap(START_AREA);
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (checkPlacement(START_AREA, room.state.buildings, room.state.plots, 'shed', x, y).ok) {
          return { x, y };
        }
      }
    }
    throw new Error('Nowhere on the farm will take a shed.');
  }
});

describe('friendships, which belong to one player and not to the farm', () => {
  /** Stands a player beside a villager, wherever the schedule has put them. */
  function beside(room: FarmRoom, player: string, npc: string) {
    const actor = room.state.npcs.find((candidate) => candidate.id === npc)!;
    Object.assign(room.state.players[player], { area: actor.area, x: actor.x, y: actor.y + 26 });
  }

  /** Puts one of something into a player's hand, through the server's own state. */
  function hold(room: FarmRoom, player: string, item: string) {
    const inventory = [...room.state.players[player].inventory];
    inventory[5] = { item, count: 3 };
    Object.assign(room.state.players[player], { inventory, selectedSlot: 5 });
  }

  it('accrues separately for two players gifting the same villager', () => {
    room.join(alice);
    room.join(bob);
    room.tick(16);

    beside(room, 'alice', 'rowan');
    beside(room, 'bob', 'rowan');
    hold(room, 'alice', 'rhubarb');
    hold(room, 'bob', 'wood');

    command(room, 'alice', { type: 'act' });
    command(room, 'bob', { type: 'act' });
    room.tick(16);

    const aliceRowan = room.state.players.alice.relationships.rowan;
    const bobRowan = room.state.players.bob.relationships.rowan;

    expect(aliceRowan?.points).toBeGreaterThan(0);
    expect(bobRowan?.points).toBeLessThan(0);
    expect(aliceRowan?.points).not.toBe(bobRowan?.points);
  });

  it('survives a restart, and is still there on a rejoin', () => {
    const seeded = new FarmRoom();
    seeded.join(new FakeConnection('alice'));
    beside(seeded, 'alice', 'rowan');
    hold(seeded, 'alice', 'rhubarb');
    command(seeded, 'alice', { type: 'act' });
    seeded.tick(16);

    const friendship = seeded.state.players.alice.relationships.rowan;
    expect(friendship?.points).toBeGreaterThan(0);

    // Through storage, which is the path a real restart takes.
    const stored = decodeSave(encodeSave(seeded.state));
    expect(stored).not.toBeNull();
    const resumed = new FarmRoom(stored!);

    expect(resumed.state.players.alice.relationships.rowan).toEqual(friendship);

    // And rejoining is coming back rather than starting over.
    resumed.join(new FakeConnection('alice'));
    resumed.tick(16);
    expect(resumed.state.players.alice.relationships.rowan).toEqual(friendship);
  });

  it('keeps one player out of the gift allowance of another', () => {
    room.join(alice);
    room.join(bob);
    room.tick(16);

    beside(room, 'alice', 'rowan');
    beside(room, 'bob', 'rowan');
    hold(room, 'alice', 'turnip');
    hold(room, 'bob', 'turnip');

    command(room, 'alice', { type: 'act' });
    room.tick(16);
    // Alice has spent today. Bob has not, and should not have.
    command(room, 'bob', { type: 'act' });
    room.tick(16);

    expect(room.state.players.alice.relationships.rowan?.giftedToday).toBe(true);
    expect(room.state.players.bob.relationships.rowan?.giftedToday).toBe(true);
    expect(room.state.players.bob.relationships.rowan?.points).toBeGreaterThan(0);
  });
});

describe('the village is shared, even though the friendships are not', () => {
  it('simulates one set of villagers that everybody sees', () => {
    room.join(alice);
    room.join(bob);
    room.tick(16);

    // Positions are world state on the room, not a per-connection view, so
    // there is exactly one Maeve to be in exactly one place.
    const ids = room.state.npcs.map((actor) => actor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('moves them on as the clock runs, without anybody asking it to', () => {
    room.join(alice);
    room.tick(16);
    const dawn = room.state.npcs.map(({ id, x, y }) => ({ id, x, y }));

    for (let step = 0; step < 400; step += 1) room.tick(1200);

    expect(room.state.npcs.map(({ id, x, y }) => ({ id, x, y }))).not.toEqual(dawn);
  });
});
