import type { PlotState } from '../systems/farming';
import type { QuestState } from '../systems/quest';
import type { CropId, Satchel } from '../systems/satchel';
import type { Season, TimeState, Weather } from '../systems/time';
import type { AreaId, Direction } from '../world/areas';

export type PlayerId = string;
export type Tool = 'hoe' | 'seed' | 'water' | 'harvest' | 'inspect';

export const MAX_PLAYERS = 4;

export const TOOL_ORDER: readonly Tool[] = ['hoe', 'seed', 'water', 'harvest', 'inspect'];

export const TOOL_LABELS: Record<Tool, string> = {
  hoe: 'Hoe',
  seed: 'Seeds',
  water: 'Watering Can',
  harvest: 'Harvest Basket',
  inspect: 'Inspect',
};

export const SEED_ORDER: readonly CropId[] = ['turnip', 'strawberry'];

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** Which map the player is standing on. */
  area: AreaId;
  x: number;
  y: number;
  facing: Direction;
  tool: Tool;
  seed: CropId;
  satchel: Satchel;
  /** Whether this player has turned in for the night; the day ends when all have. */
  asleep: boolean;
  /**
   * Whether this player is connected right now.
   *
   * Membership outlives a session: leaving keeps the record, the satchel, and
   * the spot by the gate, so coming back tomorrow is coming back, not starting
   * over. Only presence is transient.
   */
  online: boolean;
}

/**
 * The complete authoritative game state for one farm.
 *
 * Everything here is plain JSON: no class instances, no Phaser objects, no
 * functions. That is what lets the identical reducer run on a server and the
 * whole state be serialized to the wire or to a database.
 *
 * Shared across players: coins, plots, quest, time, weather.
 * Per player: position, facing, equipped tool and seed, satchel.
 */
export interface FarmState {
  /** Incremented on every intent that changed anything. Used as the sync version. */
  revision: number;
  time: TimeState;
  season: Season;
  weather: Weather;
  /** Every farmable cell in the world, keyed by area and tile. */
  plots: Record<string, PlotState>;
  /** The farm's shared wallet. */
  coins: number;
  /** Farm-wide quest progress: any player can advance it, any player can claim it. */
  quest: QuestState;
  players: Record<PlayerId, PlayerState>;
  /** Real milliseconds banked toward the next in-game clock step. */
  clockMs: number;
}
