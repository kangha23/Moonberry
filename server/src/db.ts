import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Storage for worlds and the identities that own a place in them.
 *
 * SQLite through Node's built-in driver: no service to run, no native module
 * to build, real transactions. The interface below is deliberately small, so
 * moving to Postgres later is writing one more class, not rewriting the server.
 */

/** Characters an invite code is drawn from: no 0/O or 1/I/L to misread aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export interface WorldRow {
  code: string;
  /** The serialized farm, exactly as `encodeSave` writes it. */
  save: string;
  updatedAt: string;
}

export interface Identity {
  playerId: string;
  name: string;
}

/**
 * Hashes a player token before it is stored.
 *
 * The token is the only thing proving who a returning player is, so the
 * database holds a hash rather than the token itself: a leaked dump then does
 * not hand an attacker a working identity for every player.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

export class GameDatabase {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    // Write-ahead logging keeps a save from blocking the simulation loop.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worlds (
        code       TEXT PRIMARY KEY,
        save       TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS identities (
        token_hash TEXT PRIMARY KEY,
        player_id  TEXT NOT NULL,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  /** A code no existing world already uses. */
  createWorldCode(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const bytes = randomBytes(CODE_LENGTH);
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i += 1) {
        code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
      }
      if (!this.loadWorld(code)) return code;
    }
    throw new Error('Could not find an unused invite code.');
  }

  loadWorld(code: string): WorldRow | null {
    const row = this.db.prepare('SELECT code, save, updated_at FROM worlds WHERE code = ?').get(code) as
      | { code: string; save: string; updated_at: string }
      | undefined;
    return row ? { code: row.code, save: row.save, updatedAt: row.updated_at } : null;
  }

  saveWorld(code: string, save: string): void {
    this.db
      .prepare(
        `INSERT INTO worlds (code, save, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET save = excluded.save, updated_at = excluded.updated_at`,
      )
      .run(code, save, new Date().toISOString());
  }

  worldCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM worlds').get() as { n: number };
    return row.n;
  }

  /** The identity a token belongs to, or null if the token is unknown. */
  findIdentity(token: string): Identity | null {
    const row = this.db
      .prepare('SELECT player_id, name FROM identities WHERE token_hash = ?')
      .get(hashToken(token)) as { player_id: string; name: string } | undefined;
    return row ? { playerId: row.player_id, name: row.name } : null;
  }

  createIdentity(token: string, playerId: string, name: string): Identity {
    this.db
      .prepare('INSERT INTO identities (token_hash, player_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), playerId, name, new Date().toISOString());
    return { playerId, name };
  }

  close(): void {
    this.db.close();
  }
}
