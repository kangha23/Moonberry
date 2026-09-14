import type { GameEvent } from '../state/intents';
import { TOOL_ORDER, type FarmState, type PlayerId, type Tool } from '../state/types';
import type { AreaId, Direction } from '../world/areas';

/** Message channels. Kept short because they travel on every packet. */
export const MSG = {
  /** client -> server: one thing the player wants to do. */
  command: 'c',
  /** server -> client: the whole farm, after anything but movement changed. */
  sync: 's',
  /** server -> client: player positions, every simulation tick. */
  moves: 'm',
  /** server -> client: the in-game clock advanced. */
  clock: 'k',
  /** server -> client: things that happened, for sounds and messages. */
  events: 'e',
  /** server -> client: which player this connection controls. */
  welcome: 'w',
  /** server -> client: who the player is and which world they are in. */
  identity: 'id',
} as const;

/**
 * What a client is allowed to send.
 *
 * Note what is missing: `playerId`. The server stamps every command with the
 * session it arrived on, so a client cannot act as another player — it is not
 * a rule the server enforces, it is a value the client never gets to supply.
 *
 * Also missing: `deltaMs`. A client that chose its own timestep could walk as
 * fast as it liked, so movement is expressed as an input direction and the
 * server advances it using the server's own clock.
 */
export type ClientCommand =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'selectTool'; tool: Tool }
  | { type: 'cycleSeed' }
  | { type: 'act' };

export interface MoveUpdate {
  id: PlayerId;
  /** Sent with every position: a player who walked through a door is not
   *  simply somewhere else, they are somewhere else on a different map. */
  area: AreaId;
  x: number;
  y: number;
  facing: Direction;
}

export interface WelcomeMessage {
  playerId: PlayerId;
  farm: FarmState;
}

export interface ClockMessage {
  time: FarmState['time'];
  season: FarmState['season'];
  weather: FarmState['weather'];
}

export interface EventsMessage {
  events: GameEvent[];
}

export interface IdentityMessage {
  /** Present this next time to be recognised as the same player. */
  token: string;
  /** The world's invite code, for bringing somebody else in. */
  code: string;
  playerId: PlayerId;
}

/** One axis of a movement input, as sent by a well-behaved client. */
function isAxis(value: unknown): value is number {
  return value === -1 || value === 0 || value === 1;
}

/**
 * Validates a command off the wire.
 *
 * Everything a client sends is untrusted, including from our own build: a
 * modified client, a replayed packet, or a fuzzer all arrive here. Unknown or
 * malformed commands are dropped rather than coerced into something valid.
 */
export function parseClientCommand(raw: unknown): ClientCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const command = raw as Record<string, unknown>;

  switch (command.type) {
    case 'move':
      if (!isAxis(command.dx) || !isAxis(command.dy)) return null;
      return { type: 'move', dx: command.dx, dy: command.dy };

    case 'selectTool':
      if (!TOOL_ORDER.includes(command.tool as Tool)) return null;
      return { type: 'selectTool', tool: command.tool as Tool };

    case 'cycleSeed':
      return { type: 'cycleSeed' };

    case 'act':
      return { type: 'act' };

    default:
      return null;
  }
}

export function toMoveUpdates(farm: FarmState): MoveUpdate[] {
  return Object.values(farm.players).map((player) => ({
    id: player.id,
    area: player.area,
    x: Math.round(player.x * 100) / 100,
    y: Math.round(player.y * 100) / 100,
    facing: player.facing,
  }));
}

/** Everything the server can send, tagged by channel. */
export type ServerFrame =
  | { t: typeof MSG.identity; d: IdentityMessage }
  | { t: typeof MSG.welcome; d: WelcomeMessage }
  | { t: typeof MSG.sync; d: FarmState }
  | { t: typeof MSG.moves; d: MoveUpdate[] }
  | { t: typeof MSG.clock; d: ClockMessage }
  | { t: typeof MSG.events; d: EventsMessage };

/** What a client sends: always a command, on the one inbound channel. */
export interface ClientFrame {
  t: typeof MSG.command;
  d: ClientCommand;
}

export function encodeFrame(frame: ServerFrame | ClientFrame): string {
  return JSON.stringify(frame);
}

/**
 * Decodes a frame off the wire without trusting it. Returns null for anything
 * that is not parseable JSON carrying a channel tag, so a malformed or hostile
 * packet is dropped at the edge rather than part-way through handling.
 */
export function decodeFrame(raw: string): { t: string; d: unknown } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;
  if (typeof frame.t !== 'string') return null;
  return { t: frame.t, d: frame.d };
}
