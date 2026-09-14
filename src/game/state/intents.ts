import type { CropId } from '../systems/satchel';
import type { FarmState, PlayerId, Tool } from './types';

/**
 * Everything a client is allowed to ask the farm to do.
 *
 * Intents are requests, not commands: the reducer validates each one and may
 * reject it. Once the server exists these travel over the wire unchanged, so
 * they must stay plain JSON.
 */
export type Intent =
  | { type: 'player/join'; playerId: PlayerId; name: string }
  | { type: 'player/leave'; playerId: PlayerId }
  | { type: 'player/move'; playerId: PlayerId; dx: number; dy: number; deltaMs: number }
  | { type: 'player/selectTool'; playerId: PlayerId; tool: Tool }
  | { type: 'player/cycleSeed'; playerId: PlayerId }
  | { type: 'player/act'; playerId: PlayerId }
  | { type: 'world/tick'; deltaMs: number };

/**
 * Things that happened as a result of an intent. The renderer turns these into
 * sprites, sounds, and toasts; the reducer itself never touches presentation.
 */
export type GameEvent =
  | { kind: 'message'; playerId: PlayerId; text: string }
  | { kind: 'plotChanged'; key: string }
  | { kind: 'harvested'; playerId: PlayerId; crop: CropId }
  | { kind: 'sold'; playerId: PlayerId; coins: number; count: number }
  | { kind: 'questRewarded'; playerId: PlayerId; coins: number }
  | { kind: 'dayStarted'; day: number }
  | { kind: 'playerJoined'; playerId: PlayerId }
  | { kind: 'playerLeft'; playerId: PlayerId }
  /** The whole farm was swapped out: start a new farm now, a server resync later. */
  | { kind: 'farmReplaced' };

export interface ApplyResult {
  state: FarmState;
  events: GameEvent[];
}
