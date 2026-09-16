/**
 * Things a player makes and puts down: crafting, placing and picking up,
 * chests and machines, and the two overnight chores those things do — the
 * recipes that ripen and the sprinklers that run.
 */
import { buildingAt, buildingsOn } from '../../systems/buildings';
import { heartsWith } from '../../npcs/relationships';
import type { PlotState } from '../../systems/farming';
import {
  addItem,
  countItem,
  moveBetween,
  removeItem,
  slotAt,
  topUpFrom,
} from '../../systems/inventory';
import { ITEMS, itemDef, type ItemId, type PlaceableKind } from '../../systems/items';
import { craft, newlyUnlocked } from '../../systems/crafting';
import {
  checkPickUp,
  checkSpot,
  createPlaceable,
  describeMachine,
  isChest,
  isMachine,
  isSprinkler,
  loadMachine,
  machineDef,
  machineIsReady,
  machineYield,
  nextPlaceableId,
  placeableAt,
  placeableById,
  sprinklerTiles,
  type Chest,
  type Machine,
  type Placeable,
  type PlacementWorld,
} from '../../systems/placeables';
import { nodeAt } from '../../systems/resources';
import { isWithinReach, plotKey } from '../../world/areas';
import type { ApplyResult, GameEvent } from '../intents';
import type { FarmState, PlayerId, PlayerState } from '../types';
import { unchanged, say, withPlayer } from './common';

// --- crafting, chests and machines -------------------------------------------

/** Writes the placeable list back, bumping the revision. */
function withPlaceables(state: FarmState, placeables: Placeable[]): FarmState {
  return { ...state, revision: state.revision + 1, placeables };
}

/** Swaps one placeable for an updated copy of itself, leaving the rest alone. */
function replacePlaceable(placeables: readonly Placeable[], next: Placeable): Placeable[] {
  return placeables.map((placeable) => (placeable.id === next.id ? next : placeable));
}

const OUT_OF_REACH_THING = 'Thứ đó ngoài tầm với.';
const NO_SUCH_THING = 'Không có gì như thế ở đây.';

/**
 * The placeable a command named, if this player can actually touch it.
 *
 * Both halves are checked here rather than at four call sites, and the reach
 * check is the one that matters: a chest id is a short string a modified
 * client can invent, and without this it could empty a chest on the far side
 * of the valley. Measured against the server's own idea of where this player
 * is standing, which is a value no client ever supplies.
 */
function reachablePlaceable(
  state: FarmState,
  player: PlayerState,
  id: string,
): { placeable: Placeable } | { error: string } {
  const placeable = placeableById(state.placeables, id);
  if (!placeable) return { error: NO_SUCH_THING };
  if (placeable.area !== player.area) return { error: OUT_OF_REACH_THING };
  if (!isWithinReach(player, placeable.x, placeable.y)) return { error: OUT_OF_REACH_THING };
  return { placeable };
}

/**
 * The world as the placement rule wants to see it.
 *
 * `occupied` closes over the buildings and the nodes, which is the seam that
 * lets `placeables.ts` know nothing about either: it imports neither module,
 * and `resources.ts` imports it, so the arrow only ever points one way.
 */
function placementWorld(state: FarmState): PlacementWorld {
  return {
    plots: state.plots,
    placeables: state.placeables,
    occupied: (area, x, y) =>
      buildingAt(buildingsOn(state.buildings, area), x, y) !== null ||
      nodeAt(state.nodes, area, x, y) !== null,
  };
}

/**
 * Makes something out of what is in the satchel.
 *
 * No range check and no counter, because there is no workbench: spec 11 is
 * explicit that crafting happens wherever the player is standing, and it is
 * right. A bench would be one more walk in a game where walking is already
 * the expensive part of a morning.
 */
export function applyCraft(
  state: FarmState,
  playerId: PlayerId,
  recipe: ItemId,
  count: number,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const result = craft(player.inventory, player.knownRecipes, recipe, count);
  if (!result.ok) return { state, events: [say(playerId, result.reason)] };

  return {
    state: withPlayer(state, { ...player, inventory: result.inventory }),
    events: [
      { kind: 'crafted', playerId, item: recipe, made: result.made },
      say(playerId, `Đã làm ${result.made} ${itemDef(recipe).label.toLowerCase()}.`),
    ],
  };
}

/**
 * Puts a crafted thing down on a tile.
 *
 * The same shape as `placeBuilding` and checked with the same suspicion: the
 * tile comes off the wire, so reach, ground, crops, props, doorways and
 * whether the satchel actually holds one are all re-derived here. The ghost
 * under the client's cursor is a courtesy.
 */
export function applyPlaceItem(
  state: FarmState,
  playerId: PlayerId,
  item: PlaceableKind,
  x: number,
  y: number,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (!isWithinReach(player, x, y)) {
    return { state, events: [say(playerId, 'Chỗ đó ngoài tầm với.')] };
  }
  if (countItem(player.inventory, item) < 1) {
    return { state, events: [say(playerId, `Trong túi không có ${itemDef(item).label.toLowerCase()}.`)] };
  }

  const spot = checkSpot(player.area, x, y, item, placementWorld(state));
  if (!spot.ok) return { state, events: [say(playerId, spot.reason)] };

  const inventory = removeItem(player.inventory, item, 1);
  // `countItem` already said there is one, so this is belt and braces rather
  // than a case that can happen — but it is the line that would otherwise
  // conjure a free chest if the two ever disagreed.
  if (!inventory) return unchanged(state);

  const id = nextPlaceableId(state.placeables);
  const placed = createPlaceable(id, item, player.area, x, y);

  return {
    state: {
      ...withPlaceables(state, [...state.placeables, placed]),
      players: { ...state.players, [playerId]: { ...player, inventory } },
    },
    events: [
      { kind: 'itemPlaced', playerId, id, item, x, y },
      say(playerId, `Đã đặt ${itemDef(item).label.toLowerCase()} xuống.`),
    ],
  };
}

/**
 * Takes one back up.
 *
 * A chest with anything in it refuses, and so does a machine mid-batch. Both
 * refusals exist because the alternative is a single misplaced keypress
 * deleting a season's produce, and "are you sure?" is not a thing this game
 * has anywhere else.
 */
export function applyPickUpItem(state: FarmState, playerId: PlayerId, x: number, y: number): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (!isWithinReach(player, x, y)) {
    return { state, events: [say(playerId, 'Chỗ đó ngoài tầm với.')] };
  }

  const standing = placeableAt(state.placeables, player.area, x, y);
  if (!standing) return { state, events: [say(playerId, NO_SUCH_THING)] };

  const check = checkPickUp(standing);
  if (!check.ok) return { state, events: [say(playerId, check.reason)] };

  const inventory = addItem(player.inventory, standing.kind, 1);
  if (!inventory) {
    return { state, events: [say(playerId, 'Túi đồ đã đầy, không cầm thêm được.')] };
  }

  return {
    state: {
      ...withPlaceables(
        state,
        state.placeables.filter((placeable) => placeable.id !== standing.id),
      ),
      players: {
        ...state.players,
        [playerId]: { ...player, inventory, panel: null, openChest: null },
      },
    },
    events: [
      { kind: 'itemPickedUp', playerId, item: standing.kind },
      say(playerId, `Đã nhặt ${itemDef(standing.kind).label.toLowerCase()} lên.`),
    ],
  };
}

/** The chest a chest command named, if it is one and is in reach. */
function reachableChest(
  state: FarmState,
  playerId: PlayerId,
  chestId: string,
): { player: PlayerState; chest: Chest } | { error: ApplyResult } {
  const player = state.players[playerId];
  if (!player) return { error: unchanged(state) };

  const found = reachablePlaceable(state, player, chestId);
  if ('error' in found) return { error: { state, events: [say(playerId, found.error)] } };
  if (!isChest(found.placeable)) {
    return { error: { state, events: [say(playerId, 'Thứ đó không phải cái rương.')] } };
  }
  return { player, chest: found.placeable };
}

/**
 * Moves a stack between a satchel and a chest, or within either.
 *
 * The concurrency this spec actually creates lives here, and the answer is the
 * one the rest of the game already gives: **whoever gets here first wins.**
 * Two players dragging the same stack out of one chest is two intents arriving
 * in some order, and the second one finds a slot that is empty or holds less
 * than it did. No lock, no queue, no reservation — the loser sees the chest
 * update, which is exactly what they would see if the other person had been a
 * second quicker with the mouse.
 *
 * What makes that safe rather than merely simple is that the chest and the
 * satchel are written in the *same* reducer step out of the *same* helper, so
 * there is no window in which the items are in both places or in neither.
 */
export function applyChestMoveStack(
  state: FarmState,
  playerId: PlayerId,
  chestId: string,
  from: { side: 'player' | 'chest'; slot: number },
  to: { side: 'player' | 'chest'; slot: number },
): ApplyResult {
  const found = reachableChest(state, playerId, chestId);
  if ('error' in found) return found.error;
  const { player, chest } = found;

  const side = (ref: { side: 'player' | 'chest'; slot: number }) =>
    ({ side: ref.side === 'player' ? ('left' as const) : ('right' as const), slot: ref.slot });

  const moved = moveBetween(player.inventory, chest.contents, side(from), side(to));
  if (moved.left === player.inventory && moved.right === chest.contents) return unchanged(state);

  return {
    state: {
      ...withPlaceables(
        state,
        replacePlaceable(state.placeables, { ...chest, contents: moved.right }),
      ),
      players: { ...state.players, [playerId]: { ...player, inventory: moved.left } },
    },
    events: [],
  };
}

/** The one button: top up the stacks the chest already has. */
export function applyChestStow(state: FarmState, playerId: PlayerId, chestId: string): ApplyResult {
  const found = reachableChest(state, playerId, chestId);
  if ('error' in found) return found.error;
  const { player, chest } = found;

  const result = topUpFrom(player.inventory, chest.contents);
  if (result.moved === 0) {
    return { state, events: [say(playerId, 'Không có gì trong túi khớp với chồng đồ sẵn có trong rương.')] };
  }

  return {
    state: {
      ...withPlaceables(
        state,
        replacePlaceable(state.placeables, { ...chest, contents: result.target }),
      ),
      players: { ...state.players, [playerId]: { ...player, inventory: result.source } },
    },
    events: [say(playerId, `Đã dồn ${result.moved} món vào rương.`)],
  };
}

/** The machine a machine command named, if it is one and is in reach. */
function reachableMachine(
  state: FarmState,
  playerId: PlayerId,
  machineId: string,
): { player: PlayerState; machine: Machine } | { error: ApplyResult } {
  const player = state.players[playerId];
  if (!player) return { error: unchanged(state) };

  const found = reachablePlaceable(state, player, machineId);
  if ('error' in found) return { error: { state, events: [say(playerId, found.error)] } };
  if (!isMachine(found.placeable)) {
    return { error: { state, events: [say(playerId, 'Thứ đó không phải cái máy.')] } };
  }
  return { player, machine: found.placeable };
}

/**
 * Feeds a machine whatever is in hand.
 *
 * What goes in is the held slot rather than a value off the wire, on purpose:
 * it means the command carries one id and nothing a client could lie about,
 * and it means loading a keg is the same gesture as everything else in this
 * game — hold the thing, face the thing, press the key.
 */
export function applyMachineLoad(state: FarmState, playerId: PlayerId, machineId: string): ApplyResult {
  const found = reachableMachine(state, playerId, machineId);
  if ('error' in found) return found.error;
  const { player, machine } = found;

  const held = slotAt(player.inventory, player.selectedSlot);
  if (!held) {
    return { state, events: [say(playerId, `${machineDef(machine.kind).label} cần bạn cầm sẵn thứ để nạp vào.`)] };
  }

  const load = loadMachine(machine, held.item, state.time.day);
  if (!load.ok) return { state, events: [say(playerId, load.reason)] };

  const label = machineDef(machine.kind).label;
  const fed = removeItem(player.inventory, held.item, load.takes);
  if (!fed) {
    return {
      state,
      events: [say(playerId, `${label} cần ${load.takes} ${itemDef(held.item).label.toLowerCase()} một mẻ.`)],
    };
  }
  // Fuel second, out of what is left, so a refusal on either leaves the
  // satchel exactly as it was: neither removal has been written anywhere yet.
  const inventory = load.fuel ? removeItem(fed, load.fuel.item, load.fuel.count) : fed;
  if (!inventory) {
    return {
      state,
      events: [
        say(
          playerId,
          `${label} cần thêm ${load.fuel!.count} ${itemDef(load.fuel!.item).label.toLowerCase()} làm nhiên liệu.`,
        ),
      ],
    };
  }

  return {
    state: {
      ...withPlaceables(
        state,
        replacePlaceable(state.placeables, { ...machine, job: load.job }),
      ),
      players: { ...state.players, [playerId]: { ...player, inventory } },
    },
    events: [
      {
        kind: 'machineLoaded',
        playerId,
        machineId,
        machine: machine.kind,
        input: load.job.input,
        output: load.job.output,
        readyOnDay: load.job.readyOnDay,
      },
      say(
        playerId,
        `${machineDef(machine.kind).label} bắt đầu chạy. Xong vào ngày ${load.job.readyOnDay}.`,
      ),
    ],
  };
}

export function applyMachineCollect(state: FarmState, playerId: PlayerId, machineId: string): ApplyResult {
  const found = reachableMachine(state, playerId, machineId);
  if ('error' in found) return found.error;
  const { player, machine } = found;

  if (!machine.job) {
    return { state, events: [say(playerId, `${machineDef(machine.kind).label} đang trống.`)] };
  }
  if (!machineIsReady(machine, state.time.day)) {
    return { state, events: [say(playerId, describeMachine(machine, state.time.day))] };
  }

  const out = machineYield(machine);
  if (!out) return unchanged(state);

  const inventory = addItem(player.inventory, out.item, out.count);
  if (!inventory) {
    // Left in the machine rather than dropped. The same bargain the harvest
    // takes: a full satchel costs you a trip home, never the goods.
    return { state, events: [say(playerId, 'Túi đồ đã đầy. Thứ đó vẫn nằm trong máy.')] };
  }

  return {
    state: {
      ...withPlaceables(state, replacePlaceable(state.placeables, { ...machine, job: null })),
      players: { ...state.players, [playerId]: { ...player, inventory } },
    },
    events: [
      { kind: 'machineCollected', playerId, machineId, item: out.item },
      say(playerId, `Lấy ra ${itemDef(out.item).label.toLowerCase()}.`),
    ],
  };
}

/**
 * Acting on something standing on the ground.
 *
 * Three answers, one per family: a chest opens, a machine loads or empties
 * depending on what it is doing, and everything else says what it is. The
 * branch is on the family rather than on the kind, so a fifth sort of fence
 * needs nothing here.
 */
export function applyPlaceableAct(
  state: FarmState,
  playerId: PlayerId,
  placeable: Placeable,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  // Holding a pickaxe turns every one of them into something to take back up.
  // A gesture rather than a button, and the same one the rest of the game
  // uses: hold the thing, face the thing, press the key. It has to be a tool
  // the player chose deliberately, because the alternative — an empty hand —
  // is what somebody has while walking past their own chests all day.
  const held = slotAt(player.inventory, player.selectedSlot);
  if (held && ITEMS[held.item]?.tool === 'pickaxe') {
    return applyPickUpItem(state, playerId, placeable.x, placeable.y);
  }

  if (isChest(placeable)) {
    const opened: PlayerState = { ...player, panel: 'chest', openChest: placeable.id };
    const events: GameEvent[] = [];
    if (player.panel !== 'chest' || player.openChest !== placeable.id) {
      events.push({ kind: 'panelChanged', playerId, panel: 'chest' });
    }
    return { state: withPlayer(state, opened), events };
  }

  if (isMachine(placeable)) {
    if (machineIsReady(placeable, state.time.day)) {
      return applyMachineCollect(state, playerId, placeable.id);
    }
    if (placeable.job) {
      return { state, events: [say(playerId, describeMachine(placeable, state.time.day))] };
    }
    return applyMachineLoad(state, playerId, placeable.id);
  }

  return {
    state,
    events: [say(playerId, `${itemDef(placeable.kind).label}. ${itemDef(placeable.kind).blurb}`)],
  };
}

/**
 * The recipes this player has just earned, folded into them.
 *
 * Asked on every morning *and* after every gift, not only at dawn: hearts move
 * during the day, and a recipe that turned up the next morning would leave the
 * player unsure whether the present had worked at all.
 */
export function learnRecipes(
  player: PlayerState,
  day: number,
): { player: PlayerState; events: GameEvent[] } {
  const learned = newlyUnlocked(player.knownRecipes, {
    day,
    heartsFor: (npc) => heartsWith(player.relationships, npc),
  });
  if (learned.length === 0) return { player, events: [] };

  const events: GameEvent[] = [];
  for (const entry of learned) {
    events.push({ kind: 'recipeLearned', playerId: player.id, recipe: entry.recipe, from: entry.from });
    events.push(
      say(player.id, `Học được công thức: ${itemDef(entry.recipe).label.toLowerCase()}.`),
    );
  }

  return {
    player: {
      ...player,
      knownRecipes: [...player.knownRecipes, ...learned.map((entry) => entry.recipe)],
    },
    events,
  };
}

/**
 * The sprinklers, run over the plots before the night's growth.
 *
 * The order is the whole point, and spec 11 says so in as many words. A
 * sprinkler that watered *after* `advancePlotDay` would set a flag that the
 * next roll-over consumes, which is a day of lag nobody would ever describe as
 * a feature; watering first means the crop grows tonight on water the player
 * did not have to carry. That is the difference between making the chore
 * cheaper and deleting it.
 *
 * Wild ground is skipped, so a sprinkler standing in scrub does nothing — and
 * `sprinklerTiles` carries the area with each tile, so one on the farm cannot
 * water a bed in the forest.
 */
export function runSprinklers(
  placeables: readonly Placeable[],
  plots: Record<string, PlotState>,
): { plots: Record<string, PlotState>; watered: number } {
  let next = plots;
  let watered = 0;

  for (const placeable of placeables) {
    if (!isSprinkler(placeable)) continue;
    for (const tile of sprinklerTiles(placeable)) {
      const key = plotKey(tile.area, tile.x, tile.y);
      const plot = next[key];
      if (!plot || plot.stage === 'wild' || plot.wateredToday) continue;
      if (next === plots) next = { ...plots };
      next[key] = { ...plot, wateredToday: true };
      watered += 1;
    }
  }

  return { plots: next, watered };
}
