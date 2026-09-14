import {
  MSG,
  decodeFrame,
  encodeFrame,
  parseClientCommand,
  toMoveUpdates,
  type ClientCommand,
  type ServerFrame,
} from '../../src/game/net/protocol';
import type { GameEvent } from '../../src/game/state/intents';
import { applyIntent, createFarmState } from '../../src/game/state/reducer';
import { MAX_PLAYERS, type FarmState, type PlayerId } from '../../src/game/state/types';

/** Simulation rate. 20Hz is ample for a farming game and cheap to run. */
export const TICK_MS = 50;

/** Everything except movement, which is held as an input vector instead. */
type ActionCommand = Exclude<ClientCommand, { type: 'move' }>;

/** The one thing this room needs from a connection: a way to send it bytes. */
export interface Connection {
  readonly id: PlayerId;
  send(data: string): void;
  close(): void;
}

/**
 * A single farm, simulated by the server.
 *
 * The server is the only authority. Clients send what they would like to do;
 * this room decides what actually happened, using the very same reducer the
 * client runs, and tells everyone the result.
 *
 * It talks to `Connection`, not to a socket, so the whole room is testable
 * without opening a port.
 */
export class FarmRoom {
  private farm: FarmState = createFarmState();
  private connections = new Map<PlayerId, Connection>();

  /** Latest movement input per player, applied on the server's own clock. */
  private moveInputs = new Map<PlayerId, { dx: number; dy: number }>();

  /** Commands received since the last tick, drained in arrival order. */
  private pending: Array<{ playerId: PlayerId; command: ActionCommand }> = [];

  get state(): FarmState {
    return this.farm;
  }

  get playerCount(): number {
    return this.connections.size;
  }

  get isFull(): boolean {
    return this.connections.size >= MAX_PLAYERS;
  }

  /**
   * Seats a connection. Refused when the farm is full, so the cap lives here
   * rather than depending on every caller to check first.
   */
  join(connection: Connection): boolean {
    if (this.isFull || this.connections.has(connection.id)) return false;

    this.connections.set(connection.id, connection);
    this.apply({ type: 'player/join', playerId: connection.id, name: connection.id.slice(0, 6) });

    connection.send(encodeFrame({ t: MSG.welcome, d: { playerId: connection.id, farm: this.farm } }));
    this.broadcast({ t: MSG.sync, d: this.farm }, connection.id);
    return true;
  }

  leave(playerId: PlayerId): void {
    if (!this.connections.delete(playerId)) return;
    this.moveInputs.delete(playerId);
    this.pending = this.pending.filter((entry) => entry.playerId !== playerId);
    this.apply({ type: 'player/leave', playerId });
    this.broadcast({ t: MSG.sync, d: this.farm });
  }

  /**
   * Handles one raw frame from a player.
   *
   * Everything here is untrusted: a modified client, a replayed packet, or a
   * fuzzer all arrive at this method. Anything that does not parse is dropped
   * silently — never guessed at, never partly applied, and never acknowledged,
   * so probing the server teaches an attacker nothing.
   */
  receive(playerId: PlayerId, raw: string): void {
    if (!this.connections.has(playerId)) return;

    const frame = decodeFrame(raw);
    if (!frame || frame.t !== MSG.command) return;

    const command = parseClientCommand(frame.d);
    if (!command) return;

    if (command.type === 'move') {
      this.moveInputs.set(playerId, { dx: command.dx, dy: command.dy });
      return;
    }

    // The player id comes from the connection, never from the payload, so a
    // client cannot act as somebody else however it crafts the message.
    this.pending.push({ playerId, command });
  }

  /**
   * One simulation step: player commands, then the world clock, then movement.
   *
   * Movement runs last so the identity comparisons below describe only
   * non-movement change. Because the reducer is immutable, an untouched slice
   * keeps its object identity, which makes "did the world change?" an exact
   * check rather than a guess.
   */
  tick(deltaMs: number): void {
    const before = this.farm;
    const events: GameEvent[] = [];

    const queued = this.pending;
    this.pending = [];
    for (const { playerId, command } of queued) {
      events.push(...this.apply(toIntent(playerId, command)));
    }

    events.push(...this.apply({ type: 'world/tick', deltaMs }));

    const worldChanged =
      this.farm.plots !== before.plots ||
      this.farm.players !== before.players ||
      this.farm.quest !== before.quest ||
      this.farm.coins !== before.coins ||
      this.farm.season !== before.season ||
      this.farm.weather !== before.weather;
    const clockChanged = this.farm.time !== before.time;

    for (const [playerId, input] of this.moveInputs) {
      if (input.dx === 0 && input.dy === 0) continue;
      this.apply({ type: 'player/move', playerId, dx: input.dx, dy: input.dy, deltaMs });
    }

    if (this.connections.size === 0) return;

    if (worldChanged) {
      this.broadcast({ t: MSG.sync, d: this.farm });
    } else if (clockChanged) {
      // Far cheaper than resending the whole farm every 1.2s to move the hands.
      this.broadcast({
        t: MSG.clock,
        d: { time: this.farm.time, season: this.farm.season, weather: this.farm.weather },
      });
    }

    this.broadcast({ t: MSG.moves, d: toMoveUpdates(this.farm) });

    if (events.length > 0) {
      this.broadcast({ t: MSG.events, d: { events } });
    }
  }

  closeAll(): void {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.moveInputs.clear();
    this.pending = [];
  }

  private apply(intent: Parameters<typeof applyIntent>[1]): GameEvent[] {
    const result = applyIntent(this.farm, intent);
    this.farm = result.state;
    return result.events;
  }

  private broadcast(frame: ServerFrame, exceptId?: PlayerId): void {
    const payload = encodeFrame(frame);
    for (const [id, connection] of this.connections) {
      if (id === exceptId) continue;
      connection.send(payload);
    }
  }
}

/** Widens a validated client command into the intent the reducer understands. */
function toIntent(playerId: PlayerId, command: ActionCommand): Parameters<typeof applyIntent>[1] {
  switch (command.type) {
    case 'selectTool':
      return { type: 'player/selectTool', playerId, tool: command.tool };
    case 'cycleSeed':
      return { type: 'player/cycleSeed', playerId };
    case 'act':
      return { type: 'player/act', playerId };
  }
}
