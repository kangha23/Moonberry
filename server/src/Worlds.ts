import { decodeSave, encodeSave } from '../../src/game/state/persistence';
import type { FarmState } from '../../src/game/state/types';
import type { GameDatabase } from './db';
import { FarmRoom, type Connection } from './FarmRoom';

/**
 * The set of worlds this server is running.
 *
 * A world lives in memory only while somebody is in it. It is read from the
 * database on the first arrival and written back as it changes, so a restart
 * costs at most the last few seconds rather than the whole farm.
 */

/** How often a world with unsaved changes is written to storage. */
export const SAVE_INTERVAL_MS = 10_000;

/** How long an empty world is kept in memory before being let go. */
const IDLE_GRACE_MS = 30_000;

export type JoinFailure = 'unknown-world' | 'world-full';

export interface JoinSuccess {
  code: string;
  room: FarmRoom;
}

export type JoinResult = JoinSuccess | { error: JoinFailure };

interface LiveWorld {
  room: FarmRoom;
  /** When the last player left, or null while somebody is still here. */
  emptySince: number | null;
}

export class Worlds {
  private live = new Map<string, LiveWorld>();

  constructor(private readonly db: GameDatabase) {}

  get liveCount(): number {
    return this.live.size;
  }

  /** Creates an empty world and returns its invite code. */
  create(): string {
    const code = this.db.createWorldCode();
    const room = new FarmRoom();
    this.live.set(code, { room, emptySince: Date.now() });
    this.db.saveWorld(code, encodeSave(room.state));
    return code;
  }

  /**
   * Puts a connection into a world.
   *
   * A missing code starts a new world, which is what makes "just play" work
   * without a lobby. A code that names no world is an error rather than a
   * silent new world: a player who mistypes a friend's code should be told,
   * not quietly dropped somewhere else alone.
   */
  join(code: string | null, connection: Connection, name: string): JoinResult {
    const resolved = code ?? this.create();

    const world = this.open(resolved);
    if (!world) return { error: 'unknown-world' };

    if (!world.room.join(connection, name)) return { error: 'world-full' };
    world.emptySince = null;
    return { code: resolved, room: world.room };
  }

  leave(code: string, playerId: string): void {
    const world = this.live.get(code);
    if (!world) return;

    world.room.leave(playerId);
    if (world.room.playerCount === 0) {
      world.emptySince = Date.now();
      this.persist(code, world.room);
    }
  }

  /** Loads a world into memory, or returns the one already there. */
  private open(code: string): LiveWorld | null {
    const existing = this.live.get(code);
    if (existing) return existing;

    const row = this.db.loadWorld(code);
    if (!row) return null;

    const restored = decodeSave(row.save);
    // A save the validator rejects is a world we cannot honestly resume. It is
    // left on disk untouched rather than overwritten with a fresh farm, so the
    // damage stays inspectable instead of being destroyed by the recovery.
    if (!restored) {
      console.error(`World ${code} could not be read; refusing to serve it.`);
      return null;
    }

    const world: LiveWorld = { room: new FarmRoom(restored), emptySince: null };
    this.live.set(code, world);
    return world;
  }

  tick(deltaMs: number): void {
    for (const world of this.live.values()) world.room.tick(deltaMs);
  }

  /** Writes every world that has changed, and releases the ones long empty. */
  maintain(): void {
    const now = Date.now();
    for (const [code, world] of this.live) {
      this.persist(code, world.room);

      if (world.emptySince !== null && now - world.emptySince > IDLE_GRACE_MS) {
        // Already persisted just above, so dropping it loses nothing.
        this.live.delete(code);
      }
    }
  }

  private persist(code: string, room: FarmRoom): void {
    if (!room.needsSaving) return;
    try {
      this.db.saveWorld(code, encodeSave(room.state));
      room.markSaved();
    } catch (error) {
      // Keep the room dirty so the next pass tries again rather than losing it.
      console.error(`Could not save world ${code}:`, error);
    }
  }

  /** Saves everything and closes every connection, for a clean shutdown. */
  shutdown(): void {
    for (const [code, world] of this.live) {
      this.persist(code, world.room);
      world.room.closeAll();
    }
    this.live.clear();
  }

  /** Exposed for tests: the state of a world currently in memory. */
  peek(code: string): FarmState | null {
    return this.live.get(code)?.room.state ?? null;
  }
}
