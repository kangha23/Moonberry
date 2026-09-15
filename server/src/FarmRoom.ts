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
  private farm: FarmState;
  private connections = new Map<PlayerId, Connection>();

  /** True when the world has changed since it was last written to storage. */
  private dirty = false;

  /** Latest movement input per player, applied on the server's own clock. */
  private moveInputs = new Map<PlayerId, { dx: number; dy: number }>();

  /** Commands received since the last tick, drained in arrival order. */
  private pending: Array<{ playerId: PlayerId; command: ActionCommand }> = [];

  /** Restores a saved world, or starts a new one when given nothing. */
  constructor(initial?: FarmState) {
    this.farm = initial ?? createFarmState();
  }

  get state(): FarmState {
    return this.farm;
  }

  get playerCount(): number {
    return this.connections.size;
  }

  get memberCount(): number {
    return Object.keys(this.farm.players).length;
  }

  /** True when the world has changes worth writing to storage. */
  get needsSaving(): boolean {
    return this.dirty;
  }

  markSaved(): void {
    this.dirty = false;
  }

  /** Whether a newcomer could still be given a place here. */
  get isFull(): boolean {
    return this.memberCount >= MAX_PLAYERS;
  }

  /**
   * Seats a connection.
   *
   * A returning member always gets in: their place is already theirs, and the
   * cap is on how many people belong to a world, not on how many happen to be
   * connected at once. Only a newcomer can be turned away.
   */
  join(connection: Connection, name = connection.id.slice(0, 6)): boolean {
    if (this.connections.has(connection.id)) return false;
    const returning = Boolean(this.farm.players[connection.id]);
    if (!returning && this.isFull) return false;

    this.connections.set(connection.id, connection);
    this.apply({ type: 'player/join', playerId: connection.id, name });

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
      this.farm.buildings !== before.buildings ||
      // The ground. A felled tree also moves `players` — the planks went into
      // somebody's satchel — so this is belt and braces, but a cut of grass
      // that fills the silo and nothing else would otherwise reach nobody.
      this.farm.nodes !== before.nodes ||
      this.farm.hay !== before.hay ||
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
    if (result.state !== this.farm) this.dirty = true;
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
    case 'selectSlot':
      return { type: 'player/selectSlot', playerId, slot: command.slot };
    case 'moveStack':
      return { type: 'player/moveStack', playerId, from: command.from, to: command.to };
    case 'splitStack':
      return { type: 'player/splitStack', playerId, from: command.from, to: command.to };
    case 'act':
      // The target is carried through as the client sent it. It has been
      // checked for shape, not for permission — the reducer measures it
      // against where the server thinks this player is standing.
      return { type: 'player/act', playerId, target: command.target };
    case 'sleep':
      return { type: 'player/sleep', playerId };
    case 'buy':
      return { type: 'shop/buy', playerId, item: command.item, count: command.count };
    case 'closePanel':
      return { type: 'panel/close', playerId };
    case 'upgradeTool':
      return { type: 'player/upgradeTool', playerId, item: command.item };
    case 'collectTool':
      return { type: 'player/collectTool', playerId };
    case 'placeBuilding':
      // The spot is carried through as the client proposed it. It has been
      // checked for shape, not for permission — the reducer re-derives the
      // ground, the crops, the wallet and which map this player is on.
      return { type: 'player/placeBuilding', playerId, kind: command.kind, x: command.x, y: command.y };
    case 'buyAnimal':
      // The house and the kind are carried through as proposed. Whether the
      // farm has that building, whether it is finished, whether it is the
      // right sort and whether the wallet covers the animal are all re-derived
      // in the reducer against this server's own farm.
      return {
        type: 'player/buyAnimal',
        playerId,
        kind: command.kind,
        home: command.home,
        name: command.name,
      };
    case 'sellAnimal':
      return { type: 'player/sellAnimal', playerId, animalId: command.animalId };
    case 'buyHay':
      return { type: 'player/buyHay', playerId, count: command.count };
    case 'petAnimal':
      return { type: 'player/petAnimal', playerId, animalId: command.animalId };
    case 'collectProduce':
      return { type: 'player/collectProduce', playerId, animalId: command.animalId };
    case 'feedAnimal':
      return { type: 'player/feedAnimal', playerId, animalId: command.animalId };
    case 'toggleDoor':
      return { type: 'animals/toggleDoor', playerId, buildingId: command.buildingId };
    case 'craft':
      return { type: 'player/craft', playerId, recipe: command.recipe, count: command.count };
    case 'placeItem':
      // Carried through as proposed, exactly like `placeBuilding` above: the
      // reducer re-derives the ground, the crops, the reach and the satchel.
      return { type: 'player/placeItem', playerId, item: command.item, x: command.x, y: command.y };
    case 'pickUpItem':
      return { type: 'player/pickUpItem', playerId, x: command.x, y: command.y };
    case 'chestMoveStack':
      return {
        type: 'chest/moveStack',
        playerId,
        chestId: command.chestId,
        from: command.from,
        to: command.to,
      };
    case 'chestStow':
      return { type: 'chest/stow', playerId, chestId: command.chestId };
    case 'loadMachine':
      return { type: 'machine/load', playerId, machineId: command.machineId };
    case 'collectMachine':
      return { type: 'machine/collect', playerId, machineId: command.machineId };
    case 'cast':
      // Carried through as proposed. Whether it is water, whether it is in
      // reach, whether a rod is in hand and whether there is energy for it
      // are all re-derived against this server's own map and its own idea of
      // where this player is standing.
      return { type: 'player/cast', playerId, target: command.target };
    case 'reel':
      return { type: 'player/reel', playerId, down: command.down };
    case 'cancelCast':
      return { type: 'player/cancelCast', playerId };
  }
}
