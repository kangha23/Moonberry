import { spawnNpcs } from '../npcs/schedule';
import { createPlot, type PlotState } from '../systems/farming';
import { HOTBAR_SIZE, createInventory, moveStack, slotAt, splitStack } from '../systems/inventory';
import { ITEMS } from '../systems/items';
import { STARTING_RECIPES } from '../systems/crafting';
import { createQuest } from '../systems/quest';
import { seedNodes } from '../systems/resources';
import { createTimeState, seasonForDay, weatherForDay } from '../systems/time';
import {
  AREAS,
  PLAYER_SPEED,
  START_AREA,
  plotKey,
  plotTiles,
  isAreaId,
  portalAt,
  resolveMove,
  spawnPoints,
  type AreaId,
  type Point,
} from '../world/areas';
import type { ApplyResult, GameEvent, Intent } from './intents';
import {
  EXHAUSTED_SPEED_SCALE,
  MAX_PLAYERS,
  STARTING_MAX_ENERGY,
  type FarmState,
  type PlayerId,
  type PlayerState,
} from './types';
import { blockersFor, facingFor, unchanged, say } from './rules/common';
import { rollIfEveryoneAsleep, applySleep } from './rules/day';
import {
  setPanel,
  panelSurvivesStep,
  applyBuy,
  applyUpgradeTool,
  applyCollectTool,
  applyPlaceBuilding,
} from './rules/counters';
import {
  applyPetAnimal,
  applyCollectProduce,
  applyFeedAnimal,
  applyToggleDoor,
  applyBuyAnimal,
  applySellAnimal,
  applyBuyHay,
} from './rules/ranch';
import { applyCast, applyReel, applyCancelCast } from './rules/fishing';
import {
  applyCraft,
  applyPlaceItem,
  applyPickUpItem,
  applyChestMoveStack,
  applyChestStow,
  applyMachineLoad,
  applyMachineCollect,
} from './rules/placeables';
import { applyAct } from './rules/act';
import { applyTick } from './rules/clock';

// The renderer and the tests read the clock through this file, as they always have.
export { CLOCK_STEP_MINUTES, CLOCK_STEP_MS } from './rules/clock';

const STARTING_COINS = 24;

/**
 * What every new world's ground is drawn from.
 *
 * A constant rather than a draw, and that is deliberate. `createFarmState` is
 * not the reducer, so it *could* reach for `Math.random` — but a fixed seed
 * means the first morning is the same first morning for everybody, which is
 * the same bargain the Tiled maps already take: a screenshot of day one is
 * reproducible, and a test can say exactly what is standing where. It lives in
 * the state rather than here so that a future farm-layout choice is a value
 * somebody passes in and not a change to this file.
 */
const DEFAULT_SPAWN_SEED = 0x6d6f6f6e;

export function createFarmState(spawnSeed = DEFAULT_SPAWN_SEED): FarmState {
  const plots: Record<string, PlotState> = {};
  for (const area of Object.keys(AREAS) as AreaId[]) {
    for (const tile of plotTiles(area)) {
      plots[plotKey(area, tile.x, tile.y)] = createPlot(tile.x, tile.y);
    }
  }

  const time = createTimeState();
  const season = seasonForDay(1);
  return {
    revision: 0,
    time,
    season,
    weather: weatherForDay(1),
    plots,
    coins: STARTING_COINS,
    buildings: [],
    // The farm starts overgrown, which is the quieter half of this spec. A
    // field that begins swept clean gives the first week nothing to reclaim,
    // and half the pleasure of a first season is watching the land come out
    // from under the brambles.
    nodes: seedNodes({ plots, buildings: [], placeables: [] }, season, spawnSeed),
    spawnSeed,
    npcs: spawnNpcs(season, weatherForDay(1), time),
    animals: [],
    hay: 0,
    placeables: [],
    quest: createQuest(),
    players: {},
    clockMs: 0,
  };
}

function createPlayer(id: PlayerId, name: string, spawn: Point): PlayerState {
  return {
    id,
    name,
    area: START_AREA,
    x: spawn.x,
    y: spawn.y,
    facing: 'down',
    inventory: createInventory(),
    selectedSlot: 0,
    energy: STARTING_MAX_ENERGY,
    maxEnergy: STARTING_MAX_ENERGY,
    asleep: false,
    panel: null,
    openChest: null,
    // Everything with no condition on it, which is what `{ by: 'start' }` means.
    knownRecipes: [...STARTING_RECIPES],
    pendingUpgrade: null,
    relationships: {},
    // Nobody starts with a line in the water, and nobody starts with a rod
    // either: fishing is taken up at the stall rather than handed over on the
    // first morning. See the rod's row in `TOOL_BASES`.
    fishing: null,
    online: true,
  };
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
      // A returning member is not a new one: they keep their inventory and
      // the spot they logged out from, and take no extra seat.
      const existing = state.players[intent.playerId];
      if (existing) {
        if (existing.online) return unchanged(state);
        return {
          state: {
            ...state,
            revision: state.revision + 1,
            players: { ...state.players, [intent.playerId]: { ...existing, online: true } },
          },
          events: [{ kind: 'playerJoined', playerId: intent.playerId }],
        };
      }

      const taken = Object.keys(state.players).length;
      if (taken >= MAX_PLAYERS) return unchanged(state);
      const spawns = spawnPoints();
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: {
            ...state.players,
            [intent.playerId]: createPlayer(intent.playerId, intent.name, spawns[taken % spawns.length]),
          },
        },
        events: [{ kind: 'playerJoined', playerId: intent.playerId }],
      };
    }

    case 'player/leave': {
      // Disconnecting, not moving out. The record stays so the world keeps a
      // place for them; only their presence ends.
      const player = state.players[intent.playerId];
      if (!player || !player.online) return unchanged(state);
      const left: FarmState = {
        ...state,
        revision: state.revision + 1,
        players: {
          ...state.players,
          // The cast goes with the connection, and this is the one piece of a
          // player that leaving takes. Everything else survives on purpose —
          // the satchel, the spot by the gate, the tool at the blacksmith —
          // because membership outlives a session. A cast does not: it is a
          // minigame with a second-wide window in it, and one left hanging
          // would be simulated on every tick for a player who is not there,
          // then resumed hours later with a fish that bit this morning.
          [intent.playerId]: { ...player, online: false, fishing: null },
        },
      };
      const events: GameEvent[] = [{ kind: 'playerLeft', playerId: intent.playerId }];

      // The last person awake logging off should end the night, not hang it.
      const rolled = rollIfEveryoneAsleep(left);
      return rolled ? { state: rolled.state, events: [...events, ...rolled.events] } : { state: left, events };
    }

    case 'player/move': {
      const player = state.players[intent.playerId];
      if (!player) return unchanged(state);
      // In bed. Getting up is an action, not a step.
      if (player.asleep) return unchanged(state);
      // A line in the water pins you to the bank. Dropped rather than treated
      // as a cancel, and spec 12 is right to insist on the difference: a
      // fumbled key at the wrong second should cost a step, never the fish.
      // Winding in is `player/cancelCast`, which is a thing somebody chose.
      if (player.fishing) return unchanged(state);

      const facing = facingFor(intent.dx, intent.dy, player.facing);
      // Running out of energy does not refuse the action, it drags: the
      // interesting decision is whether to push on, and a wall removes it.
      const speed = player.energy > 0 ? PLAYER_SPEED : PLAYER_SPEED * EXHAUSTED_SPEED_SCALE;
      // Buildings are state, not map, so collision has to be handed them.
      const position = resolveMove(
        player.area,
        player,
        intent.dx,
        intent.dy,
        intent.deltaMs,
        speed,
        blockersFor(state, player.area),
      );

      // Walking into a doorway is what moves a player between maps. Resolving
      // it here rather than in the renderer means the server decides where a
      // player ends up, and an offline client follows the identical rule.
      const portal = portalAt(player.area, position);
      if (portal && isAreaId(portal.toArea)) {
        const moved: PlayerState = {
          ...player,
          area: portal.toArea,
          x: portal.toX,
          y: portal.toY,
          facing,
          // Walking onto another map is the most definite way there is of
          // leaving a counter, and no map is obliged to keep its doorway out
          // of reach of one.
          panel: null,
          openChest: null,
        };
        const events: GameEvent[] = [
          { kind: 'areaChanged', playerId: intent.playerId, area: portal.toArea },
          say(intent.playerId, `Bạn theo con đường tới ${portal.label}.`),
        ];
        if (player.panel) {
          events.push({ kind: 'panelChanged', playerId: intent.playerId, panel: null });
        }
        return {
          state: {
            ...state,
            revision: state.revision + 1,
            players: { ...state.players, [intent.playerId]: moved },
          },
          events,
        };
      }

      // Walking out of range shuts the counter. A panel is tied to a place,
      // so a player who wandered off cannot keep trading from where they are.
      // It can only ever close here — a step never opens one — so the event
      // this emits always carries a null panel.
      const moved: PlayerState = { ...player, ...position, facing };
      const panel = panelSurvivesStep(state, moved) ? player.panel : null;
      const panelEvents: GameEvent[] =
        panel === player.panel ? [] : [{ kind: 'panelChanged', playerId: intent.playerId, panel: null }];

      if (
        position.x === player.x &&
        position.y === player.y &&
        facing === player.facing &&
        panel === player.panel
      ) {
        return unchanged(state);
      }
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: {
            ...state.players,
            [intent.playerId]: { ...moved, panel, openChest: panel ? player.openChest : null },
          },
        },
        events: panelEvents,
      };
    }

    case 'player/selectSlot': {
      const player = state.players[intent.playerId];
      if (!player) return unchanged(state);
      // Checked again here even though the protocol already bounds-checked it:
      // an intent can also arrive from the offline path, which never parsed.
      if (!Number.isInteger(intent.slot) || intent.slot < 0 || intent.slot >= HOTBAR_SIZE) {
        return unchanged(state);
      }
      if (player.selectedSlot === intent.slot) return unchanged(state);

      const held = slotAt(player.inventory, intent.slot);
      const label = held ? (ITEMS[held.item]?.label ?? held.item) : '';
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: { ...state.players, [intent.playerId]: { ...player, selectedSlot: intent.slot } },
        },
        events: [say(intent.playerId, held ? `Đang cầm ${label.toLowerCase()}.` : 'Tay không.')],
      };
    }

    case 'player/moveStack':
    case 'player/splitStack': {
      const player = state.players[intent.playerId];
      if (!player) return unchanged(state);
      const rearrange = intent.type === 'player/moveStack' ? moveStack : splitStack;
      // Both refuse an out-of-range index by returning the same array, so a
      // client asking for slot -1 or 999 bumps no revision and moves nothing.
      const inventory = rearrange(player.inventory, intent.from, intent.to);
      if (inventory === player.inventory) return unchanged(state);
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: { ...state.players, [intent.playerId]: { ...player, inventory } },
        },
        events: [],
      };
    }

    case 'player/act':
      return applyAct(state, intent.playerId, intent.target);

    case 'player/sleep':
      return applySleep(state, intent.playerId);

    case 'shop/buy':
      return applyBuy(state, intent.playerId, intent.item, intent.count);

    case 'panel/close':
      return setPanel(state, intent.playerId, null);

    case 'player/upgradeTool':
      return applyUpgradeTool(state, intent.playerId, intent.item);

    case 'player/collectTool':
      return applyCollectTool(state, intent.playerId);

    case 'player/placeBuilding':
      return applyPlaceBuilding(state, intent.playerId, intent.kind, intent.x, intent.y);

    case 'player/buyAnimal':
      return applyBuyAnimal(state, intent.playerId, intent.kind, intent.home, intent.name);

    case 'player/sellAnimal':
      return applySellAnimal(state, intent.playerId, intent.animalId);

    case 'player/buyHay':
      return applyBuyHay(state, intent.playerId, intent.count);

    case 'player/petAnimal':
      return applyPetAnimal(state, intent.playerId, intent.animalId);

    case 'player/collectProduce':
      return applyCollectProduce(state, intent.playerId, intent.animalId);

    case 'player/feedAnimal':
      return applyFeedAnimal(state, intent.playerId, intent.animalId);

    case 'player/craft':
      return applyCraft(state, intent.playerId, intent.recipe, intent.count);

    case 'player/placeItem':
      return applyPlaceItem(state, intent.playerId, intent.item, intent.x, intent.y);

    case 'player/pickUpItem':
      return applyPickUpItem(state, intent.playerId, intent.x, intent.y);

    case 'chest/moveStack':
      return applyChestMoveStack(state, intent.playerId, intent.chestId, intent.from, intent.to);

    case 'chest/stow':
      return applyChestStow(state, intent.playerId, intent.chestId);

    case 'machine/load':
      return applyMachineLoad(state, intent.playerId, intent.machineId);

    case 'machine/collect':
      return applyMachineCollect(state, intent.playerId, intent.machineId);

    case 'animals/toggleDoor':
      return applyToggleDoor(state, intent.playerId, intent.buildingId);

    case 'player/cast':
      return applyCast(state, intent.playerId, intent.target);

    case 'player/reel':
      return applyReel(state, intent.playerId, intent.down);

    case 'player/cancelCast':
      return applyCancelCast(state, intent.playerId);

    case 'world/tick':
      return applyTick(state, intent.deltaMs);
  }
}
