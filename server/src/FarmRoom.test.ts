import { beforeEach, describe, expect, it } from 'vitest';
import { MSG, decodeFrame, encodeFrame, type ClientCommand } from '../../src/game/net/protocol';
import { MAX_PLAYERS, type FarmState } from '../../src/game/state/types';
import { LANDMARKS, TILE_SIZE, plotKey } from '../../src/game/world/layout';
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

  it('frees the seat when a player leaves', () => {
    room.join(alice);
    room.join(bob);

    room.leave('alice');

    expect(room.playerCount).toBe(1);
    expect((bob.latest(MSG.sync) as FarmState).players.alice).toBeUndefined();
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

    // Alice tries to equip a tool as Bob.
    room.receive(
      'alice',
      encodeFrame({ t: MSG.command, d: { type: 'selectTool', tool: 'water', playerId: 'bob' } as ClientCommand }),
    );
    room.tick(16);

    expect(room.state.players.alice.tool).toBe('water');
    expect(room.state.players.bob.tool).toBe('hoe');
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
    raw(room, 'alice', JSON.stringify({ t: MSG.command, d: { type: 'selectTool', tool: 'bulldozer' } }));
    room.tick(16);

    expect(room.state.coins).toBe(before.coins);
    expect(room.state.players.alice.tool).toBe('hoe');
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
    const farm = room.state;
    Object.assign(farm.players.alice, { x: 9 * TILE_SIZE + 16, y: 8 * TILE_SIZE + 16, facing: 'up' });
    alice.sent.length = 0;

    command(room, 'alice', { type: 'act' });
    room.tick(16);

    const sync = alice.latest(MSG.sync) as FarmState;
    expect(sync.plots[plotKey(9, 7)].stage).toBe('tilled');
  });

  it('reports action results as events', () => {
    room.join(alice);
    room.tick(16);
    Object.assign(room.state.players.alice, { x: 9 * TILE_SIZE + 16, y: 8 * TILE_SIZE + 16, facing: 'up' });
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

describe('the farm is shared', () => {
  it('pays a quest reward into the wallet both players spend from', () => {
    room.join(alice);
    room.join(bob);
    room.tick(16);

    // Complete the quest outright, then let Bob collect it.
    Object.assign(room.state.quest, { progress: 3, completed: true });
    Object.assign(room.state.players.bob, { x: LANDMARKS.rowan.x, y: LANDMARKS.rowan.y + 40 });
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
