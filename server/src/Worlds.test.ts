import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeSave } from '../../src/game/state/persistence';
import type { PlayerId } from '../../src/game/state/types';
import { type Connection } from './FarmRoom';
import { GameDatabase, createToken } from './db';
import { Worlds } from './Worlds';

class FakeConnection implements Connection {
  closed = false;
  constructor(readonly id: PlayerId) {}
  send(): void {}
  close(): void {
    this.closed = true;
  }
}

let db: GameDatabase;
let worlds: Worlds;

beforeEach(() => {
  db = new GameDatabase(':memory:');
  worlds = new Worlds(db);
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
});

describe('invite codes', () => {
  it('gives each world its own code', () => {
    const codes = new Set([worlds.create(), worlds.create(), worlds.create()]);

    expect(codes.size).toBe(3);
  });

  it('uses characters that survive being read aloud', () => {
    const code = worlds.create();

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    // 0/O and 1/I/L are the pairs people mishear and mistype.
    expect(code).not.toMatch(/[01OIL]/);
  });
});

describe('joining a world', () => {
  it('starts a new world when given no code', () => {
    const result = worlds.join(null, new FakeConnection('a'), 'A');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.code).toHaveLength(6);
  });

  it('puts two players who use the same code in the same world', () => {
    const first = worlds.join(null, new FakeConnection('a'), 'A');
    if ('error' in first) throw new Error('first join failed');

    const second = worlds.join(first.code, new FakeConnection('b'), 'B');
    if ('error' in second) throw new Error('second join failed');

    expect(second.room).toBe(first.room);
    expect(second.room.memberCount).toBe(2);
  });

  it('refuses a code that names no world rather than inventing one', () => {
    // Mistyping a friend's code should say so, not strand the player alone in
    // a brand new world that looks almost right.
    const result = worlds.join('ZZZZZZ', new FakeConnection('a'), 'A');

    expect(result).toEqual({ error: 'unknown-world' });
    expect(worlds.liveCount).toBe(0);
  });

  it('turns away a fifth newcomer', () => {
    const first = worlds.join(null, new FakeConnection('a'), 'A');
    if ('error' in first) throw new Error('join failed');
    for (const id of ['b', 'c', 'd']) worlds.join(first.code, new FakeConnection(id), id);

    const overflow = worlds.join(first.code, new FakeConnection('e'), 'E');

    expect(overflow).toEqual({ error: 'world-full' });
  });
});

describe('surviving a restart', () => {
  it('brings a world back with its crops, wallet, and members', () => {
    const first = worlds.join(null, new FakeConnection('a'), 'Ada');
    if ('error' in first) throw new Error('join failed');
    const { code, room } = first;

    room.state.coins = 777;
    const plotKey = Object.keys(room.state.plots)[0];
    room.state.plots[plotKey] = { ...room.state.plots[plotKey], stage: 'sprout', crop: 'turnip', daysWatered: 1 };
    worlds.leave(code, 'a');

    // A whole new process, reading the same database.
    const reopened = new Worlds(db);
    const back = reopened.join(code, new FakeConnection('a'), 'Ada');
    if ('error' in back) throw new Error('rejoin failed');

    expect(back.room.state.coins).toBe(777);
    expect(back.room.state.plots[plotKey].crop).toBe('turnip');
    expect(back.room.state.players.a.name).toBe('Ada');
  });

  it('writes a world when its last player leaves', () => {
    const joined = worlds.join(null, new FakeConnection('a'), 'A');
    if ('error' in joined) throw new Error('join failed');
    joined.room.state.coins = 512;

    worlds.leave(joined.code, 'a');

    const saved = decodeSave(db.loadWorld(joined.code)!.save);
    expect(saved?.coins).toBe(512);
  });

  it('brings everyone back logged out, so nobody haunts the farm', () => {
    const joined = worlds.join(null, new FakeConnection('a'), 'A');
    if ('error' in joined) throw new Error('join failed');
    expect(joined.room.state.players.a.online).toBe(true);
    worlds.maintain();

    const saved = decodeSave(db.loadWorld(joined.code)!.save);

    expect(saved?.players.a.online).toBe(false);
  });

  it('saves on shutdown', () => {
    const joined = worlds.join(null, new FakeConnection('a'), 'A');
    if ('error' in joined) throw new Error('join failed');
    joined.room.state.coins = 4242;

    worlds.shutdown();

    expect(decodeSave(db.loadWorld(joined.code)!.save)?.coins).toBe(4242);
  });

  it('refuses to serve a world whose save is corrupt, and leaves it alone', () => {
    const code = worlds.create();
    db.saveWorld(code, '{"version":1,"farm":{"coins":"lots"}}');
    const corrupt = db.loadWorld(code)!.save;

    const result = new Worlds(db).join(code, new FakeConnection('a'), 'A');

    expect(result).toEqual({ error: 'unknown-world' });
    // Overwriting it with a fresh farm would destroy the evidence.
    expect(db.loadWorld(code)!.save).toBe(corrupt);
  });
});

describe('memory', () => {
  it('lets go of a world once it has been empty a while', () => {
    const joined = worlds.join(null, new FakeConnection('a'), 'A');
    if ('error' in joined) throw new Error('join failed');
    worlds.leave(joined.code, 'a');
    expect(worlds.liveCount).toBe(1);

    // maintain() drops worlds idle past the grace period.
    worlds.maintain();
    expect(worlds.liveCount).toBe(1);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    worlds.maintain();

    expect(worlds.liveCount).toBe(0);
  });

  it('keeps a world in memory while somebody is still in it', () => {
    const joined = worlds.join(null, new FakeConnection('a'), 'A');
    if ('error' in joined) throw new Error('join failed');

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 600_000);
    worlds.maintain();

    expect(worlds.liveCount).toBe(1);
  });
});

describe('identities', () => {
  it('recognises a returning token and issues the same player id', () => {
    const token = createToken();
    const created = db.createIdentity(token, 'player-1', 'Ada');

    expect(db.findIdentity(token)).toEqual(created);
  });

  it('does not recognise a token it never issued', () => {
    expect(db.findIdentity(createToken())).toBeNull();
  });

  it('stores a hash, not the token itself', () => {
    const token = createToken();
    db.createIdentity(token, 'player-1', 'Ada');

    const stored = readStoredTokenHashes(db);

    // A leaked dump should not hand an attacker a working identity.
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toBe(token);
    expect(stored[0]).toMatch(/^[0-9a-f]{64}$/);
    // The token still works through the API, which is the point of the hash.
    expect(db.findIdentity(token)?.playerId).toBe('player-1');
  });
});

/** Reads the raw identity keys, to prove the token itself is not among them. */
function readStoredTokenHashes(database: GameDatabase): string[] {
  // Reaches past the public surface deliberately: the point of the test is
  // what is physically on disk, not what the API chooses to show.
  const internal = database as unknown as { db: { prepare(sql: string): { all(): Array<{ token_hash: string }> } } };
  return internal.db.prepare('SELECT token_hash FROM identities').all().map((row) => row.token_hash);
}
