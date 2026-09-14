import {
  advancePlotDay,
  applyFarmAction,
  createPlot,
  sellAllCrops,
  type FarmAction,
  type PlotState,
} from '../systems/farming';
import { claimQuestReward, createQuest, recordHarvest } from '../systems/quest';
import { createSatchel, refillWater } from '../systems/satchel';
import { advanceTime, createTimeState, isRainy, seasonForDay, weatherForDay } from '../systems/time';
import {
  LANDMARKS,
  SPAWN_POINTS,
  createMap,
  describeTile,
  isNear,
  plotKey,
  plotTiles,
  resolveMove,
  targetTile,
  type Direction,
  type Point,
} from '../world/layout';
import type { ApplyResult, GameEvent, Intent } from './intents';
import {
  MAX_PLAYERS,
  SEED_ORDER,
  TOOL_LABELS,
  type FarmState,
  type PlayerId,
  type PlayerState,
  type Tool,
} from './types';

/**
 * The map never changes, so it is derived once rather than stored in state.
 * Client and server build the identical map from the same function.
 */
const MAP = createMap();

/** Real milliseconds per in-game clock step. */
const CLOCK_STEP_MS = 1200;
/** In-game minutes added per clock step. */
const CLOCK_STEP_MINUTES = 10;

/** Guards against a long stall replaying hundreds of clock steps at once. */
const MAX_TICK_MS = 5000;

const STARTING_COINS = 24;

const TOOL_ACTIONS: Partial<Record<Tool, FarmAction>> = {
  hoe: 'till',
  seed: 'plant',
  water: 'water',
  harvest: 'harvest',
};

export function createFarmState(): FarmState {
  const plots: Record<string, PlotState> = {};
  for (const tile of plotTiles()) {
    plots[plotKey(tile.x, tile.y)] = createPlot(tile.x, tile.y);
  }

  return {
    revision: 0,
    time: createTimeState(),
    season: seasonForDay(1),
    weather: weatherForDay(1),
    plots,
    coins: STARTING_COINS,
    quest: createQuest(),
    players: {},
    clockMs: 0,
  };
}

function createPlayer(id: PlayerId, name: string, spawn: Point): PlayerState {
  return {
    id,
    name,
    x: spawn.x,
    y: spawn.y,
    facing: 'down',
    tool: 'hoe',
    seed: 'turnip',
    satchel: createSatchel(),
    asleep: false,
  };
}

function facingFor(dx: number, dy: number, fallback: Direction): Direction {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

function unchanged(state: FarmState): ApplyResult {
  return { state, events: [] };
}

function say(playerId: PlayerId, text: string): GameEvent {
  return { kind: 'message', playerId, text };
}

/**
 * Rolls the farm over to the next morning: crops drink, the clock resets to
 * 6am, weather and season are redrawn, and every watering can refills.
 */
function startNewDay(state: FarmState): { state: FarmState; events: GameEvent[] } {
  const wasRainy = isRainy(state.weather);
  const events: GameEvent[] = [];

  const plots: Record<string, PlotState> = {};
  for (const [key, plot] of Object.entries(state.plots)) {
    const next = advancePlotDay(plot, wasRainy);
    plots[key] = next;
    if (next.stage !== plot.stage || next.wateredToday !== plot.wateredToday) {
      events.push({ kind: 'plotChanged', key });
    }
  }

  const time = createTimeState(state.time.day + 1);
  const players: Record<PlayerId, PlayerState> = {};
  for (const [id, player] of Object.entries(state.players)) {
    players[id] = { ...player, satchel: refillWater(player.satchel), asleep: false };
  }

  events.push({ kind: 'dayStarted', day: time.day });

  return {
    state: {
      ...state,
      time,
      season: seasonForDay(time.day),
      weather: weatherForDay(time.day),
      plots,
      players,
      clockMs: 0,
    },
    events,
  };
}

/**
 * Resolves a context-sensitive action: talk to Rowan, sell at the market, or
 * use the equipped tool on the tile the player faces.
 */
function applyAct(state: FarmState, playerId: PlayerId): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (isNear(player, LANDMARKS.rowan)) {
    const result = claimQuestReward(state.quest);
    const events: GameEvent[] = [say(playerId, result.message)];
    if (!result.claimed) return { state, events };
    events.push({ kind: 'questRewarded', playerId, coins: result.reward });
    return {
      state: {
        ...state,
        revision: state.revision + 1,
        quest: result.quest,
        coins: state.coins + result.reward,
      },
      events,
    };
  }

  if (isNear(player, LANDMARKS.market)) {
    const sale = sellAllCrops(player.satchel);
    const events: GameEvent[] = [say(playerId, sale.message)];
    if (!sale.changed) return { state, events };
    events.push({ kind: 'sold', playerId, coins: sale.coinsEarned, count: sale.soldCount });
    return {
      state: {
        ...state,
        revision: state.revision + 1,
        coins: state.coins + sale.coinsEarned,
        players: { ...state.players, [playerId]: { ...player, satchel: sale.satchel } },
      },
      events,
    };
  }

  const target = targetTile(player, player.facing);
  const key = plotKey(target.x, target.y);
  const plot = state.plots[key];
  const action = TOOL_ACTIONS[player.tool];

  if (!plot || !action) {
    return { state, events: [say(playerId, describeTile(MAP, target.x, target.y))] };
  }

  const result = applyFarmAction(plot, player.satchel, action, player.seed);
  const events: GameEvent[] = [say(playerId, result.message)];
  if (!result.changed) return { state, events };

  events.push({ kind: 'plotChanged', key });
  let quest = state.quest;
  if (result.harvestedCrop) {
    quest = recordHarvest(quest, result.harvestedCrop);
    events.push({ kind: 'harvested', playerId, crop: result.harvestedCrop });
  }

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      plots: { ...state.plots, [key]: result.plot },
      quest,
      players: { ...state.players, [playerId]: { ...player, satchel: result.satchel } },
    },
    events,
  };
}

function applyTick(state: FarmState, deltaMs: number): ApplyResult {
  const clockMs = state.clockMs + Math.min(deltaMs, MAX_TICK_MS);
  if (clockMs < CLOCK_STEP_MS) return { state: { ...state, clockMs }, events: [] };

  const steps = Math.floor(clockMs / CLOCK_STEP_MS);
  let next: FarmState = { ...state, clockMs: clockMs % CLOCK_STEP_MS, revision: state.revision + 1 };
  const events: GameEvent[] = [];

  for (let i = 0; i < steps; i += 1) {
    const advanced = advanceTime(next.time, CLOCK_STEP_MINUTES);
    if (advanced.newDay) {
      const rolled = startNewDay(next);
      // startNewDay resets clockMs; keep the remainder we already banked.
      next = { ...rolled.state, clockMs: next.clockMs };
      events.push(...rolled.events);
    } else {
      next = { ...next, time: advanced.time };
    }
  }

  return { state: next, events };
}

/**
 * The single authority over farm state. Pure: the same state plus the same
 * intent always yields the same next state and the same events, with no I/O
 * and no dependency on Phaser, React, or the DOM.
 *
 * This function is what will later move to the server unchanged.
 */
export function applyIntent(state: FarmState, intent: Intent): ApplyResult {
  switch (intent.type) {
    case 'player/join': {
      if (state.players[intent.playerId]) return unchanged(state);
      const taken = Object.keys(state.players).length;
      if (taken >= MAX_PLAYERS) return unchanged(state);
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: {
            ...state.players,
            [intent.playerId]: createPlayer(intent.playerId, intent.name, SPAWN_POINTS[taken]),
          },
        },
        events: [{ kind: 'playerJoined', playerId: intent.playerId }],
      };
    }

    case 'player/leave': {
      if (!state.players[intent.playerId]) return unchanged(state);
      const players = { ...state.players };
      delete players[intent.playerId];
      return {
        state: { ...state, revision: state.revision + 1, players },
        events: [{ kind: 'playerLeft', playerId: intent.playerId }],
      };
    }

    case 'player/move': {
      const player = state.players[intent.playerId];
      if (!player) return unchanged(state);
      const facing = facingFor(intent.dx, intent.dy, player.facing);
      const position = resolveMove(MAP, player, intent.dx, intent.dy, intent.deltaMs);
      if (position.x === player.x && position.y === player.y && facing === player.facing) {
        return unchanged(state);
      }
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: { ...state.players, [intent.playerId]: { ...player, ...position, facing } },
        },
        events: [],
      };
    }

    case 'player/selectTool': {
      const player = state.players[intent.playerId];
      if (!player || player.tool === intent.tool) return unchanged(state);
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: { ...state.players, [intent.playerId]: { ...player, tool: intent.tool } },
        },
        events: [say(intent.playerId, `${TOOL_LABELS[intent.tool]} equipped.`)],
      };
    }

    case 'player/cycleSeed': {
      const player = state.players[intent.playerId];
      if (!player) return unchanged(state);
      const index = SEED_ORDER.indexOf(player.seed);
      const seed = SEED_ORDER[(index + 1) % SEED_ORDER.length];
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: { ...state.players, [intent.playerId]: { ...player, seed } },
        },
        events: [say(intent.playerId, `${seed} seeds selected.`)],
      };
    }

    case 'player/act':
      return applyAct(state, intent.playerId);

    case 'world/tick':
      return applyTick(state, intent.deltaMs);
  }
}
