import { describe, expect, it } from 'vitest';
import { applyIntent, createFarmState } from '../state/reducer';
import { parseClientCommand, toMoveUpdates } from './protocol';

describe('accepting well-formed commands', () => {
  it('accepts the four commands a client may send', () => {
    expect(parseClientCommand({ type: 'move', dx: -1, dy: 1 })).toEqual({ type: 'move', dx: -1, dy: 1 });
    expect(parseClientCommand({ type: 'selectTool', tool: 'water' })).toEqual({ type: 'selectTool', tool: 'water' });
    expect(parseClientCommand({ type: 'cycleSeed' })).toEqual({ type: 'cycleSeed' });
    expect(parseClientCommand({ type: 'act' })).toEqual({ type: 'act' });
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

  it('drops a tool the game does not define', () => {
    expect(parseClientCommand({ type: 'selectTool', tool: 'bulldozer' })).toBeNull();
    expect(parseClientCommand({ type: 'selectTool' })).toBeNull();
    expect(parseClientCommand({ type: 'selectTool', tool: 7 })).toBeNull();
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
      { type: 'cycleSeed', playerId: 'someone-else' },
      { type: 'selectTool', tool: 'hoe', playerId: 'someone-else' },
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

  it('carries only position and facing, never satchels or coins', () => {
    const farm = applyIntent(createFarmState(), { type: 'player/join', playerId: 'a', name: 'A' }).state;

    expect(Object.keys(toMoveUpdates(farm)[0]).sort()).toEqual(['facing', 'id', 'x', 'y']);
  });

  it('rounds coordinates so float noise does not inflate every packet', () => {
    let farm = applyIntent(createFarmState(), { type: 'player/join', playerId: 'a', name: 'A' }).state;
    farm = applyIntent(farm, { type: 'player/move', playerId: 'a', dx: 1, dy: 1, deltaMs: 17 }).state;

    const { x } = toMoveUpdates(farm)[0];

    expect(x).toBe(Math.round(x * 100) / 100);
  });
});
