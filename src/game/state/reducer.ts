import {
  ANIMAL_DEFS,
  HAY_PRICE,
  MAX_HAY_PURCHASE,
  advanceAnimals,
  animalAtTile,
  animalById,
  animalsIn,
  animalsOn,
  nearestAnimal,
  checkPurchase,
  collectProduce,
  createAnimal,
  feedAnimal,
  hasProduce,
  hayCapacity,
  isAnimalHouse,
  petAnimal,
  resalePrice,
  startAnimalDay,
  type Animal,
  type AnimalKind,
} from '../systems/animals';
import {
  BUILDING_AREA,
  buildingAt,
  buildingDef,
  buildingTiles,
  buildingsOn,
  checkPlacement,
  isComplete,
  nextBuildingId,
  solidRects,
  type Building,
  type BuildingKind,
} from '../systems/buildings';
import { npcDef } from '../npcs/definitions';
import { pickDialogue, type DialogueContext } from '../npcs/dialogue';
import {
  REACTION_BLURB,
  giveGift,
  heartsWith,
  isBirthday,
  isGiftable,
  relationshipWith,
  startRelationshipDay,
} from '../npcs/relationships';
import { activityAt, advanceNpcs, spawnNpcs, type NpcActor } from '../npcs/schedule';
import {
  advancePlotDay,
  applySweep,
  createPlot,
  killOutOfSeasonCrops,
  sellAllCrops,
  type PlotState,
} from '../systems/farming';
import {
  HOTBAR_SIZE,
  addItem,
  countItem,
  createInventory,
  moveBetween,
  moveStack,
  refillCharges,
  removeItem,
  slotAt,
  splitStack,
  topUpFrom,
} from '../systems/inventory';
import {
  ITEMS,
  areaOfEffectOf,
  barWidthOf,
  isPlaceableItem,
  energyFactorOf,
  fishDef,
  itemDef,
  upgradeFor,
  type ItemId,
  type PlaceableKind,
} from '../systems/items';
import { STARTING_RECIPES, craft, newlyUnlocked } from '../systems/crafting';
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
  solidPlaceableRects,
  sprinklerTiles,
  type Chest,
  type Machine,
  type Placeable,
  type PlacementWorld,
} from '../systems/placeables';
import {
  BAIT_ITEM,
  CAST_ENERGY,
  acceptsReel,
  describeCatch,
  hookFish,
  startCast,
  stepFishing,
  type FishDraw,
} from '../systems/fishing';
import { claimQuestReward, createQuest, recordHarvest } from '../systems/quest';
import {
  nodeAt,
  nodeDef,
  seedNodes,
  solidNodeRects,
  startNodeDay,
  workNodes,
  type ResourceNode,
} from '../systems/resources';
import { buyFromStall } from '../systems/shop';
import { advanceTime, createTimeState, isRainy, seasonForDay, weatherForDay } from '../systems/time';
import {
  AREAS,
  PLAYER_SPEED,
  START_AREA,
  areaOfEffectTiles,
  describeTile,
  interactableAt,
  isNear,
  isWithinReach,
  plotKey,
  propGap,
  plotTiles,
  isAreaId,
  portalAt,
  resolveMove,
  spawnPoints,
  targetTile,
  tileAt,
  worldToTile,
  type AreaId,
  type Blockers,
  type Direction,
  type Point,
} from '../world/areas';
import type { ApplyResult, GameEvent, Intent } from './intents';
import {
  COLLAPSE_COIN_CAP,
  COLLAPSE_COIN_SHARE,
  EXHAUSTED_SPEED_SCALE,
  MAX_PLAYERS,
  PANEL_FOR_INTERACT,
  STARTING_MAX_ENERGY,
  UPGRADE_DAYS,
  type FarmState,
  type PanelId,
  type PlayerId,
  type PlayerState,
} from './types';

/** Real milliseconds per in-game clock step. */
const CLOCK_STEP_MS = 1200;
/** In-game minutes added per clock step. */
const CLOCK_STEP_MINUTES = 10;

/** Guards against a long stall replaying hundreds of clock steps at once. */
const MAX_TICK_MS = 5000;

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
 * Everything standing in the way of a player on this map.
 *
 * Two sources now, which is exactly why `Blockers` is an object: the third one
 * spec 13 brings is a field here rather than a fourth argument at every call
 * site that has to be threaded through.
 */
function blockersFor(state: FarmState, area: AreaId): Blockers {
  return {
    buildings: solidRects(buildingsOn(state.buildings, area)),
    nodes: solidNodeRects(state.nodes, area),
    placeables: solidPlaceableRects(state.placeables, area),
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

/** Everyone with a place here who is actually connected right now. */
function onlineMembers(state: FarmState): PlayerState[] {
  return Object.values(state.players).filter((player) => player.online);
}

/**
 * Who is still on their feet.
 *
 * Only people who are here count. An offline member must not hold the night
 * open, or one person going out for the evening freezes the farm for everyone
 * else; and an empty farm must not vote itself into tomorrow.
 */
function stillAwake(state: FarmState): PlayerState[] {
  return onlineMembers(state).filter((player) => !player.asleep);
}

/**
 * Rolls the farm over to the next morning: crops drink, the clock resets to
 * 6am, weather and season are redrawn, every watering can refills, and
 * everybody wakes up rested — unless the night ended in a collapse, which
 * costs half of it.
 */
function startNewDay(state: FarmState, collapsed = false): ApplyResult {
  const wasRainy = isRainy(state.weather);
  const events: GameEvent[] = [];

  const time = createTimeState(state.time.day + 1);
  const season = seasonForDay(time.day);

  // The cull runs before the night's growth, not after it, so a crop the turn
  // is going to kill does not get one last drink first. Only on a boundary:
  // for twenty-seven mornings out of twenty-eight there is nothing to decide.
  const withered = season !== state.season
    ? killOutOfSeasonCrops(state.plots, season)
    : null;
  if (withered && withered.count > 0) {
    events.push({ kind: 'cropsWithered', count: withered.count, season, crops: withered.crops });
  }

  // The sprinklers, and the one line of this function whose position is a
  // design decision rather than a convenience. After the cull, so nothing
  // waters a crop the turning season has already killed; **before** the growth
  // below, so tonight's water counts towards tonight's stage. Watering after
  // the roll-over would set a flag the *next* roll-over consumes, and a day of
  // lag is how a sprinkler stops feeling like one.
  const damp = runSprinklers(state.placeables, withered?.plots ?? state.plots);
  if (damp.watered > 0) events.push({ kind: 'sprinklersRan', watered: damp.watered });

  const plots: Record<string, PlotState> = {};
  let grown = 0;
  for (const [key, plot] of Object.entries(damp.plots)) {
    const next = advancePlotDay(plot, wasRainy);
    plots[key] = next;
    // Compared against last night rather than against the culled plot, so a
    // plot that withered reports the change the renderer has to draw.
    const before = state.plots[key];
    if (next.stage !== before.stage && next.crop) grown += 1;
    if (next.stage !== before.stage || next.crop !== before.crop || next.wateredToday !== before.wateredToday) {
      events.push({ kind: 'plotChanged', key });
    }
  }

  const players: Record<PlayerId, PlayerState> = {};
  for (const [id, player] of Object.entries(state.players)) {
    const woken: PlayerState = {
      ...player,
      inventory: refillCharges(player.inventory),
      energy: collapsed ? Math.floor(player.maxEnergy / 2) : player.maxEnergy,
      asleep: false,
      // Nobody wakes up mid-purchase, and the stall's stock has just changed
      // under anyone who fell asleep on the last night of a season.
      panel: null,
      // Which takes the chest with it. Nobody wakes up with a lid open either.
      openChest: null,
      // And nobody wakes up mid-cast. A night passed; whatever was on the
      // line is long gone, and resuming a bite window from yesterday evening
      // would be a fish caught by going to bed.
      fishing: null,
      // Today's gift is available again, and on the first day of a week so is
      // the week's allowance.
      relationships: startRelationshipDay(player.relationships, time.day),
    };
    // Recipes that ripen on a date arrive here; the ones that ripen on hearts
    // have usually arrived already, at the moment the gift was handed over.
    const taught = learnRecipes(woken, time.day);
    players[id] = taught.player;
    events.push(...taught.events);
    // The blacksmith worked overnight. Said once, on the morning the work is
    // finished, so the summary can mention it — the tool itself still has to
    // be walked to the village and collected, which is what makes handing it
    // over a decision rather than a two-day delay on a purchase.
    const pending = player.pendingUpgrade;
    if (pending && pending.readyOnDay === time.day) {
      events.push({ kind: 'upgradeReady', playerId: id, item: pending.item });
      events.push(say(id, `${itemDef(pending.item).label} đã xong ở lò rèn.`));
    }
  }

  // The carpenter likewise. A scaffold whose day has come loses its
  // `readyOnDay` and becomes a building, which is the only thing that
  // distinguishes the two.
  let buildings = state.buildings;
  const finished = state.buildings.filter(
    (building) => building.readyOnDay !== null && building.readyOnDay <= time.day,
  );
  if (finished.length > 0) {
    buildings = state.buildings.map((building) =>
      building.readyOnDay !== null && building.readyOnDay <= time.day
        ? { ...building, readyOnDay: null }
        : building,
    );
    for (const building of finished) {
      events.push({ kind: 'buildingFinished', id: building.id, building: building.kind });
    }
  }

  // The herd. Last night's neglect is settled, this morning's hay is handed
  // out, and everybody wakes up indoors — the same rule the villagers follow,
  // for the same reason: an animal left standing in a field at 2am is a
  // simulation artefact rather than something that happened.
  const herd = startAnimalDay(state.animals, state.hay, time.day);
  if (herd.hungry > 0) events.push({ kind: 'animalsHungry', count: herd.hungry });

  // The machines. Nothing changes in the state — a finished batch sits in the
  // hopper until somebody walks over and takes it — so this is purely the
  // announcement, said once on the morning it is true. The bubble the renderer
  // floats over a keg is the whole reason it is an event rather than something
  // the panel works out for itself.
  for (const placeable of state.placeables) {
    if (!isMachine(placeable) || !placeable.job) continue;
    if (placeable.job.readyOnDay !== time.day) continue;
    events.push({
      kind: 'machineReady',
      machineId: placeable.id,
      machine: placeable.kind,
      output: placeable.job.output,
    });
  }

  // The ground. After the crops, because the plots it must not grow on are the
  // plots as they stand this morning, and before the summary, because what
  // came up is a line in it.
  const ground = startNodeDay(
    state.nodes,
    { plots, buildings, placeables: state.placeables },
    season,
    time.day,
    state.spawnSeed,
  );
  if (ground.spawned > 0 || ground.cleared > 0) {
    events.push({ kind: 'nodesGrew', spawned: ground.spawned, cleared: ground.cleared });
  }

  events.push({ kind: 'dayStarted', day: time.day, grown });

  // The morning panel that reports all this is drawn in the canvas, where a
  // screen reader cannot follow it. The same news goes down the text channel,
  // which the shell mirrors into a live region, so turning in for the night
  // announces the morning to everybody rather than only to people looking.
  for (const player of onlineMembers(state)) {
    events.push(
      say(player.id, `Ngày ${time.day} bắt đầu. ${grown} luống đã lớn lên qua đêm.`),
    );
  }

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      time,
      season,
      weather: weatherForDay(time.day),
      plots,
      buildings,
      // Everybody wakes up at their own front door rather than wherever the
      // small hours left them, which saves the valley from a morning with Ash
      // stranded halfway across it.
      npcs: spawnNpcs(season, weatherForDay(time.day), time),
      animals: herd.animals,
      hay: herd.hay,
      nodes: ground.nodes,
      players,
      clockMs: 0,
    },
    events,
  };
}

/**
 * 02:00 with somebody still up.
 *
 * Stardew charges the hour in gold and nothing else, and so does this: never
 * crops, never items. Punishing the hour with the farm's produce teaches the
 * wrong lesson, and in a shared world it bills everybody for one person's
 * evening.
 */
function collapse(state: FarmState): ApplyResult {
  const coinsLost = Math.min(Math.floor(state.coins * COLLAPSE_COIN_SHARE), COLLAPSE_COIN_CAP);
  const rolled = startNewDay({ ...state, coins: state.coins - coinsLost }, true);
  return { state: rolled.state, events: [{ kind: 'collapsed', coinsLost }, ...rolled.events] };
}

/**
 * Ends the night the moment the last person still up turns in.
 *
 * Sleep is a vote because the world is shared: one player cannot fast-forward
 * four people's day. Returns null when the vote is not unanimous yet.
 */
function rollIfEveryoneAsleep(state: FarmState): ApplyResult | null {
  const online = onlineMembers(state);
  if (online.length === 0 || stillAwake(state).length > 0) return null;
  return startNewDay(state);
}

/**
 * Turning in, or getting back up.
 *
 * Where a player may sleep is decided here and nowhere else: the command off
 * the wire carries nothing but its type, precisely so there is nothing in it
 * to trust.
 */
function applySleep(state: FarmState, playerId: PlayerId): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (!player.asleep && interactableAt(player.area, player)?.interact !== 'bed') {
    return { state, events: [say(playerId, 'Bạn cần một cái giường trước khi có thể đi ngủ.')] };
  }

  const asleep = !player.asleep;
  const slept: FarmState = {
    ...state,
    revision: state.revision + 1,
    players: { ...state.players, [playerId]: { ...player, asleep } },
  };
  const events: GameEvent[] = [
    { kind: 'sleepChanged', playerId, asleep },
    say(playerId, asleep ? 'Bạn lên giường đi ngủ.' : 'Bạn ngồi dậy.'),
  ];

  const rolled = asleep ? rollIfEveryoneAsleep(slept) : null;
  return rolled ? { state: rolled.state, events: [...events, ...rolled.events] } : { state: slept, events };
}

/**
 * Which counter this player is standing at, if any.
 *
 * Asked of the player's own position, which came from the server's movement
 * simulation — never of anything the client sent alongside the purchase. This
 * is the check that keeps `buy` and `upgradeTool` honest: a client that only
 * sends them while its panel is open is a client we have decided to believe.
 */
function counterAt(player: PlayerState): PanelId | null {
  const interact = interactableAt(player.area, player)?.interact;
  return interact ? (PANEL_FOR_INTERACT[interact] ?? null) : null;
}

/** Sets a player's open panel, or returns the state untouched if it is already so. */
function setPanel(state: FarmState, playerId: PlayerId, panel: PanelId | null): ApplyResult {
  const player = state.players[playerId];
  if (!player || player.panel === panel) return unchanged(state);
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      // Which chest goes with the panel. Leaving a stale id behind would mean
      // a later `panel: 'chest'` could open a box nobody walked to.
      players: { ...state.players, [playerId]: { ...player, panel, openChest: null } },
    },
    events: [{ kind: 'panelChanged', playerId, panel }],
  };
}

/**
 * Whether a place-bound panel survives a step.
 *
 * Two kinds of place now, and one rule between them. A counter is a prop on
 * the map, so standing at it is `counterAt`; a chest is a thing on a tile, so
 * standing at it is reach. Both close the moment the player walks off, which
 * is the point of the panel being place-bound at all — otherwise a client
 * could keep a lid open from the far side of the valley and trade from there.
 */
function panelSurvivesStep(state: FarmState, player: PlayerState): boolean {
  if (!player.panel) return false;
  if (player.panel !== 'chest') return counterAt(player) === player.panel;
  if (!player.openChest) return false;
  const chest = placeableById(state.placeables, player.openChest);
  return (
    chest !== null && chest.area === player.area && isWithinReach(player, chest.x, chest.y)
  );
}

/**
 * Buys seeds.
 *
 * The range check is the point of this function existing on the server. A
 * client that only sends `shop/buy` while its panel is open is a client we
 * have decided to believe; a modified one buys pumpkin seed from the far side
 * of the village. So being at the stall is checked here, every time, from the
 * player's own position — which is a value the client never gets to supply.
 */
function applyBuy(state: FarmState, playerId: PlayerId, item: string, count: number): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (counterAt(player) !== 'market') {
    return { state, events: [say(playerId, 'Bạn không đứng ở sạp chợ.')] };
  }

  const result = buyFromStall(player.inventory, state.coins, state.season, item, count);
  const events: GameEvent[] = [say(playerId, result.message)];
  if (!result.changed) return { state, events };

  events.push({ kind: 'bought', playerId, item, count, coins: result.spent });
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      coins: state.coins - result.spent,
      players: { ...state.players, [playerId]: { ...player, inventory: result.inventory } },
    },
    events,
  };
}

/** Writes one player back, bumping the revision. The shape of half of these. */
function withPlayer(state: FarmState, player: PlayerState): FarmState {
  return {
    ...state,
    revision: state.revision + 1,
    players: { ...state.players, [player.id]: player },
  };
}

/**
 * Hands a tool over the counter.
 *
 * The tool is *gone*: it comes out of the satchel now and comes back two
 * mornings later, which is the whole mechanic. Buying an upgrade that arrived
 * instantly would be a purchase; giving up watering at scale for two days,
 * chosen deliberately in the week before you need it, is a decision.
 */
function applyUpgradeTool(state: FarmState, playerId: PlayerId, item: ItemId): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (counterAt(player) !== 'workshop') {
    return { state, events: [say(playerId, 'Bạn không đứng ở lò rèn.')] };
  }
  if (player.pendingUpgrade) {
    const waiting = itemDef(player.pendingUpgrade.item).label;
    return { state, events: [say(playerId, `Cái đe đang bận với ${waiting.toLowerCase()} của bạn.`)] };
  }

  const upgrade = upgradeFor(item);
  if (!upgrade) {
    const known = ITEMS[item];
    return {
      state,
      events: [
        say(
          playerId,
          known?.tool
            ? `${known.label} đó đã tốt hết mức rồi.`
            : 'Thợ rèn chỉ làm nông cụ, không làm thứ đó.',
        ),
      ],
    };
  }

  // Taken from wherever it is rather than from the held slot, so handing over
  // the can does not depend on the can being the thing in your hand.
  const inventory = removeItem(player.inventory, item, 1);
  if (!inventory) {
    return { state, events: [say(playerId, `Bạn không mang theo ${itemDef(item).label.toLowerCase()}.`)] };
  }
  if (upgrade.cost > state.coins) {
    return {
      state,
      events: [
        say(playerId, `Công đó hết ${upgrade.cost}g, mà nông trại chỉ có ${state.coins}g.`),
      ],
    };
  }

  const readyOnDay = state.time.day + UPGRADE_DAYS;
  const next: PlayerState = { ...player, inventory, pendingUpgrade: { item: upgrade.item, readyOnDay } };
  return {
    state: { ...withPlayer(state, next), coins: state.coins - upgrade.cost },
    events: [
      { kind: 'upgradeOrdered', playerId, item, into: upgrade.item, readyOnDay },
      say(
        playerId,
        `Thợ rèn nhận ${itemDef(item).label.toLowerCase()} của bạn cùng ${upgrade.cost}g. Ngày ${readyOnDay} quay lại lấy.`,
      ),
    ],
  };
}

/** Picks the finished tool up. Refused before the morning it is ready. */
function applyCollectTool(state: FarmState, playerId: PlayerId): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (counterAt(player) !== 'workshop') {
    return { state, events: [say(playerId, 'Bạn không đứng ở lò rèn.')] };
  }

  const pending = player.pendingUpgrade;
  if (!pending) {
    return { state, events: [say(playerId, 'Bạn chẳng gửi gì cho thợ rèn cả.')] };
  }
  if (state.time.day < pending.readyOnDay) {
    const days = pending.readyOnDay - state.time.day;
    return {
      state,
      events: [say(playerId, `Chưa xong. Quay lại vào ngày ${pending.readyOnDay}, tức ${days} ngày nữa.`)],
    };
  }

  const inventory = addItem(player.inventory, pending.item, 1);
  if (!inventory) {
    return { state, events: [say(playerId, 'Túi của bạn không còn chỗ. Thợ rèn sẽ giữ giúp.')] };
  }

  const next: PlayerState = { ...player, inventory, pendingUpgrade: null };
  return {
    state: withPlayer(state, next),
    events: [
      { kind: 'upgradeCollected', playerId, item: pending.item },
      say(playerId, `${itemDef(pending.item).label}, và nó tốt hơn hẳn thứ bạn đã đưa.`),
    ],
  };
}

/**
 * Breaks ground on a building.
 *
 * Everything a client can influence is re-derived here from the server's own
 * state: where the player is standing, what the ground is, what is already on
 * it, and what the wallet holds. The client's translucent footprint saves a
 * wasted click and decides nothing.
 */
function applyPlaceBuilding(
  state: FarmState,
  playerId: PlayerId,
  kind: BuildingKind,
  x: number,
  y: number,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  // Standing somewhere else is its own refusal rather than a footprint check
  // that happens to fail: a client asking to build on the farm from the
  // village is asking for something it is not entitled to ask for at all.
  if (player.area !== BUILDING_AREA) {
    return { state, events: [say(playerId, 'Bạn phải đứng trên nông trại mới xây được.')] };
  }

  const placement = checkPlacement(player.area, state.buildings, state.plots, kind, x, y);
  if (!placement.ok) return { state, events: [say(playerId, placement.reason)] };

  const def = buildingDef(kind);
  if (def.cost > state.coins) {
    return {
      state,
      events: [say(playerId, `${def.label} giá ${def.cost}g, mà nông trại chỉ có ${state.coins}g.`)],
    };
  }

  const readyOnDay = state.time.day + def.days;
  const building: Building = {
    id: nextBuildingId(state.buildings),
    kind,
    x,
    y,
    readyOnDay,
    // Shut, which is the only sensible default for a house nothing lives in
    // yet — and it means the first thing anybody does at a new coop is open it.
    doorOpen: false,
  };
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      coins: state.coins - def.cost,
      buildings: [...state.buildings, building],
    },
    events: [
      { kind: 'buildingPlaced', playerId, id: building.id, building: kind, readyOnDay },
      say(playerId, `Đã động thổ ${def.label.toLowerCase()}. Xong vào ngày ${readyOnDay}.`),
    ],
  };
}

/** Writes the herd back, bumping the revision. The animal half of `withPlayer`. */
function withAnimals(state: FarmState, animals: Animal[]): FarmState {
  return { ...state, revision: state.revision + 1, animals };
}

/** One animal replaced in place, which is what every chore below produces. */
function replaceAnimal(animals: readonly Animal[], next: Animal): Animal[] {
  return animals.map((animal) => (animal.id === next.id ? next : animal));
}

/**
 * Whether this player is close enough to lay a hand on this animal.
 *
 * An animal indoors is reached through its house, which is checked the same
 * way: you have to be standing at the door. Without this, a panel left open on
 * one screen would be a remote control for a farm on the other side of the
 * valley — which is precisely the thing the market counter is not allowed to
 * be either.
 */
function canReachAnimal(state: FarmState, player: PlayerState, animal: Animal): boolean {
  if (player.area !== BUILDING_AREA) return false;
  if (animal.position) {
    return isWithinReach(player, worldToTile(animal.position.x), worldToTile(animal.position.y));
  }
  const home = state.buildings.find((building) => building.id === animal.home);
  if (!home) return false;
  return buildingTiles(home).some((tile) => isWithinReach(player, tile.x, tile.y));
}

const OUT_OF_REACH = 'Con vật đó không ở trong tầm tay bạn.';
const NO_SUCH_ANIMAL = 'Không có con vật nào như thế.';
const NOT_AT_RANCHER = 'Bạn không đứng ở chỗ người bán gia súc.';

/**
 * The animal a chore is about, and whether it can be reached.
 *
 * The three chores below differ in what they do and in nothing else, so the
 * two ways of refusing them are asked once here. Every one of them starts by
 * looking the id up rather than trusting it: an animal id off the wire is a
 * string a client chose.
 */
function reachableAnimal(
  state: FarmState,
  player: PlayerState,
  animalId: string,
): { ok: true; animal: Animal } | { ok: false; reason: string } {
  const animal = animalById(state.animals, animalId);
  if (!animal) return { ok: false, reason: NO_SUCH_ANIMAL };
  if (!canReachAnimal(state, player, animal)) return { ok: false, reason: OUT_OF_REACH };
  return { ok: true, animal };
}

/** A stroke. Once a day, and the fifteen points land now rather than at dawn. */
function applyPetAnimal(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const found = reachableAnimal(state, player, animalId);
  if (!found.ok) return { state, events: [say(playerId, found.reason)] };

  const result = petAnimal(found.animal);
  if (!result.ok) return { state, events: [say(playerId, result.reason)] };

  return {
    state: withAnimals(state, replaceAnimal(state.animals, result.animal)),
    events: [
      { kind: 'animalPetted', playerId, animalId, animal: found.animal.kind },
      say(playerId, result.message),
    ],
  };
}

/**
 * Collecting.
 *
 * The animal's clock moves on in the same state change that puts the egg in
 * the satchel, which is what makes two farmhands racing for the same coop
 * safe: the second one arrives to find `produceOnDay` already in the future
 * and is told there is nothing there. Nothing needs locking, because the
 * reducer only ever applies one intent at a time.
 */
function applyCollectProduce(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const found = reachableAnimal(state, player, animalId);
  if (!found.ok) return { state, events: [say(playerId, found.reason)] };

  const result = collectProduce(found.animal, player.inventory, state.time.day);
  if (!result.ok) return { state, events: [say(playerId, result.reason)] };

  const label = itemDef(result.item).label.toLowerCase();
  return {
    state: {
      ...withAnimals(state, replaceAnimal(state.animals, result.animal)),
      players: { ...state.players, [playerId]: { ...player, inventory: result.inventory } },
    },
    events: [
      { kind: 'produceCollected', playerId, animalId, item: result.item, grade: result.grade },
      say(
        playerId,
        `Bạn ${ANIMAL_DEFS[found.animal.kind].collectVerb} ${found.animal.name}: ${label}.`,
      ),
    ],
  };
}

/**
 * Feeding by hand.
 *
 * Only ever needed when the morning found the silo empty and somebody has been
 * to the rancher since. The everyday case is the trough, which `startAnimalDay`
 * fills without anybody pressing a key — a chore that has to be done every
 * single morning and can never be done wrong is not a decision, it is a tax.
 */
function applyFeedAnimal(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const found = reachableAnimal(state, player, animalId);
  if (!found.ok) return { state, events: [say(playerId, found.reason)] };

  const result = feedAnimal(found.animal, state.hay);
  if (!result.ok) return { state, events: [say(playerId, result.reason)] };

  return {
    state: { ...withAnimals(state, replaceAnimal(state.animals, result.animal)), hay: result.hay },
    events: [{ kind: 'animalFed', playerId, animalId }, say(playerId, result.message)],
  };
}

/**
 * The coop door.
 *
 * On the farm and within arm's reach of the building, because it is a door: a
 * client that could swing it from the village could put somebody else's whole
 * herd out in the rain from a panel nobody is standing at.
 */
function applyToggleDoor(state: FarmState, playerId: PlayerId, buildingId: string): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const building = state.buildings.find((candidate) => candidate.id === buildingId);
  if (!building || !isAnimalHouse(building.kind)) {
    return { state, events: [say(playerId, 'Cái đó không có cửa chuồng.')] };
  }
  if (!isComplete(building)) {
    return { state, events: [say(playerId, `${buildingDef(building.kind).label} chưa dựng xong.`)] };
  }
  if (
    player.area !== BUILDING_AREA ||
    !buildingTiles(building).some((tile) => isWithinReach(player, tile.x, tile.y))
  ) {
    return { state, events: [say(playerId, 'Bạn phải đứng cạnh chuồng đã.')] };
  }

  const open = !building.doorOpen;
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      buildings: state.buildings.map((candidate) =>
        candidate.id === buildingId ? { ...candidate, doorOpen: open } : candidate,
      ),
    },
    events: [
      { kind: 'doorToggled', buildingId, open },
      say(
        playerId,
        open
          ? 'Bạn chống cửa chuồng lên. Ngày nào khô ráo là chúng sẽ ra ngoài.'
          : 'Bạn đóng cửa chuồng lại.',
      ),
    ],
  };
}

/**
 * Walking up to an animal.
 *
 * Produce wins over a stroke, deliberately: the egg is the errand, the stroke
 * is what you do afterwards, and one press should never leave a player
 * wondering whether the coop has been done. Both are still available — the
 * second press pets, because by then there is nothing left to pick up.
 */
function applyAnimalAct(state: FarmState, playerId: PlayerId, animal: Animal): ApplyResult {
  return hasProduce(animal, state.time.day)
    ? applyCollectProduce(state, playerId, animal.id)
    : applyPetAnimal(state, playerId, animal.id);
}

/**
 * Doing the round at a coop or a barn.
 *
 * There are no interiors in this game, so acting on the building is what
 * standing in the doorway has to mean: every egg picked up and every empty
 * trough filled, in one press. Only when there is nothing to do does the press
 * fall through to the door — which is the right order round, because the door
 * is the thing you touch once a day and the eggs are what you came for.
 */
function applyHouseChores(state: FarmState, playerId: PlayerId, building: Building): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const housed = animalsIn(state.animals, building.id);
  if (housed.length === 0) {
    const def = buildingDef(building.kind);
    return {
      state,
      events: [
        say(playerId, `${def.label} còn trống. Người bán gia súc ngoài làng có thứ để thả vào.`),
      ],
    };
  }

  let animals = state.animals;
  let inventory = player.inventory;
  let hay = state.hay;
  let collected = 0;
  let fed = 0;
  const events: GameEvent[] = [];

  for (const housedAnimal of housed) {
    const picked = collectProduce(housedAnimal, inventory, state.time.day);
    if (picked.ok) {
      animals = replaceAnimal(animals, picked.animal);
      inventory = picked.inventory;
      collected += 1;
      events.push({
        kind: 'produceCollected',
        playerId,
        animalId: housedAnimal.id,
        item: picked.item,
        grade: picked.grade,
      });
    }

    // Read off the running herd rather than the loop variable: an animal that
    // was just collected from is a different object by now.
    const current = animalById(animals, housedAnimal.id);
    if (!current) continue;
    const meal = feedAnimal(current, hay);
    if (meal.ok) {
      animals = replaceAnimal(animals, meal.animal);
      hay = meal.hay;
      fed += 1;
      events.push({ kind: 'animalFed', playerId, animalId: housedAnimal.id });
    }
  }

  if (collected === 0 && fed === 0) return applyToggleDoor(state, playerId, building.id);

  const done = [collected > 0 ? `thu được ${collected} món` : '', fed > 0 ? `cho ${fed} con ăn` : '']
    .filter(Boolean)
    .join(' và ');
  events.push(say(playerId, `${buildingDef(building.kind).label}: bạn ${done}.`));

  return {
    state: {
      ...withAnimals(state, animals),
      hay,
      players: { ...state.players, [playerId]: { ...player, inventory } },
    },
    events,
  };
}

// --- the rancher's counter ---------------------------------------------------

/**
 * Buying an animal.
 *
 * Everything a client could lie about is re-derived here: the price from the
 * table, the house from the farm's own building list, the room in it from the
 * herd, and the wallet from the farm. What the client genuinely supplies is
 * one thing — the name — and that is checked for shape and nothing else,
 * because a name is allowed to be whatever a person wants to call a goat.
 */
function applyBuyAnimal(
  state: FarmState,
  playerId: PlayerId,
  kind: AnimalKind,
  home: string,
  name: string,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (counterAt(player) !== 'ranch') {
    return { state, events: [say(playerId, NOT_AT_RANCHER)] };
  }

  const check = checkPurchase(state.animals, state.buildings, kind, home, name);
  if (!check.ok) return { state, events: [say(playerId, check.reason)] };

  const def = ANIMAL_DEFS[kind];
  if (def.price > state.coins) {
    return {
      state,
      events: [say(playerId, `${def.label} giá ${def.price}g, mà nông trại chỉ có ${state.coins}g.`)],
    };
  }

  const animal = createAnimal(state.animals, kind, home, name, state.time.day);
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      coins: state.coins - def.price,
      animals: [...state.animals, animal],
    },
    events: [
      { kind: 'animalBought', playerId, animalId: animal.id, animal: kind, coins: def.price },
      say(playerId, `${animal.name} về nông trại rồi. Nhớ cho ăn, và vuốt nó mỗi ngày một lần.`),
    ],
  };
}

/**
 * Selling one back, at half.
 *
 * Brutal, and necessary. Without a way out, a coop filled with the wrong bird
 * is a permanent decision taken by somebody who had been playing for an hour,
 * and there are eight places in it.
 */
function applySellAnimal(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (counterAt(player) !== 'ranch') {
    return { state, events: [say(playerId, NOT_AT_RANCHER)] };
  }

  const animal = animalById(state.animals, animalId);
  if (!animal) return { state, events: [say(playerId, NO_SUCH_ANIMAL)] };

  const paid = resalePrice(animal.kind);
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      coins: state.coins + paid,
      animals: state.animals.filter((candidate) => candidate.id !== animalId),
    },
    events: [
      { kind: 'animalSold', playerId, animal: animal.kind, coins: paid },
      say(playerId, `${animal.name} theo người bán đi, và để lại ${paid}g.`),
    ],
  };
}

/**
 * Buying hay.
 *
 * The one purchase in the game that can be refused for having nowhere to put
 * it: hay lives in the silo and nowhere else, so a farm without one cannot buy
 * a single bale. That is the whole reason the silo is the cheapest of the
 * three farm buildings, and why its blurb says to put it up first.
 */
function applyBuyHay(state: FarmState, playerId: PlayerId, count: number): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (counterAt(player) !== 'ranch') {
    return { state, events: [say(playerId, NOT_AT_RANCHER)] };
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_HAY_PURCHASE) {
    return { state, events: [say(playerId, 'Ông ta đếm lại một lượt rồi lắc đầu.')] };
  }

  const capacity = hayCapacity(state.buildings);
  if (capacity === 0) {
    return {
      state,
      events: [say(playerId, 'Nông trại chưa có kho cỏ nào. Không có chỗ chứa thì ông ta không bán.')],
    };
  }
  if (state.hay + count > capacity) {
    const room = capacity - state.hay;
    return { state, events: [say(playerId, `Kho cỏ chỉ còn chỗ cho ${room} bó nữa.`)] };
  }

  const spent = HAY_PRICE * count;
  if (spent > state.coins) {
    return {
      state,
      events: [say(playerId, `${count} bó cỏ giá ${spent}g, mà nông trại chỉ có ${state.coins}g.`)],
    };
  }

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      coins: state.coins - spent,
      hay: state.hay + count,
    },
    events: [
      { kind: 'hayBought', playerId, count, coins: spent },
      say(playerId, `Đã mua ${count} bó cỏ với giá ${spent}g.`),
    ],
  };
}

/**
 * The villager a player is standing next to, and how far away they are.
 *
 * The gap comes back with them because a counter and a villager can both be in
 * reach at once — Maeve works the forge yard — and the nearer of the two has to
 * win. That is the rule two props have always followed; this only extends it to
 * cover people.
 */
function nearestNpc(state: FarmState, player: PlayerState): { actor: NpcActor; gap: number } | null {
  let best: { actor: NpcActor; gap: number } | null = null;
  for (const actor of state.npcs) {
    if (actor.area !== player.area) continue;
    if (!isNear(player, actor)) continue;
    const gap = Math.hypot(actor.x - player.x, actor.y - player.y);
    if (!best || gap < best.gap) best = { actor, gap };
  }
  return best;
}

/** Everything a line is allowed to depend on, gathered in one place. */
function dialogueContextFor(state: FarmState, player: PlayerState, actor: NpcActor): DialogueContext {
  const def = npcDef(actor.id);
  return {
    hearts: heartsWith(player.relationships, actor.id),
    season: state.season,
    weather: state.weather,
    day: state.time.day,
    birthday: isBirthday(def, state.season, state.time.day),
    questCompleted: state.quest.completed,
    questRewarded: state.quest.rewarded,
    activity: activityAt(def, state.season, state.weather, state.time),
  };
}

/** The line this villager has for this player right now. */
function speakLine(state: FarmState, playerId: PlayerId, actor: NpcActor): string {
  const player = state.players[playerId];
  const def = npcDef(actor.id);
  if (!player) return '';
  return pickDialogue(def, dialogueContextFor(state, player, actor));
}

/**
 * Saying hello, as the two things that produces.
 *
 * Only the talking path emits `npcSpoke`. A gift makes its own sound and
 * carries the same line in its message, and firing both would put two blips
 * over one interaction.
 */
function speakEvents(state: FarmState, playerId: PlayerId, actor: NpcActor): GameEvent[] {
  const line = speakLine(state, playerId, actor);
  if (!line) return [];
  return [
    { kind: 'npcSpoke', npc: actor.id, playerId, line },
    say(playerId, `${npcDef(actor.id).name}: ${line}`),
  ];
}

/**
 * Talking.
 *
 * The quest rides along on this rather than on a villager's name: `questGiver`
 * is a flag in the definition, so the promise that adding a villager never
 * means touching this file survives the one villager who predates all of it.
 */
function applyTalk(state: FarmState, playerId: PlayerId, actor: NpcActor): ApplyResult {
  const events = speakEvents(state, playerId, actor);
  const def = npcDef(actor.id);
  if (!def.questGiver) return { state, events };

  const result = claimQuestReward(state.quest);
  if (!result.claimed) return { state, events };

  events.push(say(playerId, result.message), { kind: 'questRewarded', playerId, coins: result.reward });
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

/**
 * Handing something over.
 *
 * A refusal still gets a line. The alternative — silence until tomorrow — makes
 * a villager who has already had their gift feel broken rather than finished
 * with, and the refusal itself has to change nothing at all: no points, no
 * allowance spent, and the item stays in the satchel.
 */
function applyGift(
  state: FarmState,
  playerId: PlayerId,
  actor: NpcActor,
  item: ItemId,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const def = npcDef(actor.id);
  const before = relationshipWith(player.relationships, actor.id);
  const result = giveGift(before, def, item, state.season, state.time.day);
  if (!result.ok) {
    return { state, events: [say(playerId, result.reason), ...speakEvents(state, playerId, actor)] };
  }

  // Checked rather than assumed: `giveGift` has agreed the item is giftable,
  // but the satchel is the only thing that knows it is still in there.
  const inventory = removeItem(player.inventory, item, 1);
  if (!inventory) return { state, events: [say(playerId, 'Bạn không mang theo thứ đó.')] };

  const label = itemDef(item).label.toLowerCase();
  const next: PlayerState = {
    ...player,
    inventory,
    relationships: { ...player.relationships, [actor.id]: result.relationship },
  };

  const events: GameEvent[] = [
    {
      kind: 'giftGiven',
      npc: actor.id,
      playerId,
      item,
      reaction: result.reaction,
      heartsNow: result.hearts,
      heartGained: result.heartGained,
      birthday: result.birthday,
    },
    say(
      playerId,
      result.birthday
        ? `Bạn tặng ${def.name} ${label} — đúng ngày sinh nhật. ${def.name} ${REACTION_BLURB[result.reaction]}.`
        : `Bạn tặng ${def.name} ${label}. ${def.name} ${REACTION_BLURB[result.reaction]}.`,
    ),
    say(playerId, `${def.name}: ${speakLine(state, playerId, actor)}`),
  ];

  // This is where spec 11 pays spec 07's debt, and it is two lines long.
  // Before this, a friendship bought dialogue and nothing else, so a player who
  // worked out that gifts were optional was right. Now four hearts with Maeve
  // is a keg. Asked here rather than only at dawn on purpose: a recipe that
  // turned up the next morning would leave the player unsure the gift had done
  // anything, and the whole point is that it visibly did.
  const taught = learnRecipes(next, state.time.day);
  events.push(...taught.events);

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      players: { ...state.players, [playerId]: taught.player },
    },
    events,
  };
}

/**
 * Walking up to somebody.
 *
 * What is in hand decides which of the two this is, exactly as it decides what
 * a swing at a plot does: something giftable means a gift, and anything else —
 * a tool, an empty slot — means hello.
 */
function applyNpcAct(state: FarmState, playerId: PlayerId, actor: NpcActor): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);
  const held = slotAt(player.inventory, player.selectedSlot);
  return held && isGiftable(held.item)
    ? applyGift(state, playerId, actor, held.item)
    : applyTalk(state, playerId, actor);
}

/**
 * Swinging at something standing on the ground.
 *
 * The shape of the plot sweep one function below, deliberately: a steel axe
 * covers the same 3x3 a steel hoe does, and the two ought to be one mechanic
 * that a player learns once. Energy is charged per node actually struck, and
 * the tier's factor applied to the total.
 *
 * Three things this is careful about, and all three are rules the spec calls
 * out by name:
 *
 * - **Refusing the felling blow when the satchel is full.** The node keeps its
 *   last point of health and stays exactly where it was. Dropping twelve
 *   planks on the ground would need world items, pickup and despawn rules;
 *   losing them silently is worse than either.
 * - **Saying when the tool is too weak.** Ten swings at a boulder that was
 *   never going to break, with nothing said, is an interface failure rather
 *   than a difficulty — so it is an event as well as a sentence, and the
 *   cursor greys out on anything this tier cannot touch.
 * - **Hay never reaching the satchel.** Cut grass goes to the silo or nowhere,
 *   because a permanent stack of grass would hold one of twenty-four slots for
 *   ever.
 */
function applyNodeAct(
  state: FarmState,
  playerId: PlayerId,
  aimed: ResourceNode,
  tile: Point,
  held: ItemId | null,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  // Everything the swing covers that is actually a node. The rectangle is the
  // tool's own, so a basic axe passes exactly the one tile it was aimed at.
  const covered = held
    ? areaOfEffectTiles(tile, areaOfEffectOf(held), player.area)
    : [tile];
  const targets: ResourceNode[] = [];
  for (const spot of covered) {
    const found = nodeAt(state.nodes, player.area, spot.x, spot.y);
    // Only nodes the aimed one's tool would work. Without this a steel axe
    // swung at a tree would report "you need a scythe" about a tuft of grass
    // three tiles away that the player never aimed at.
    if (found && nodeDef(found.kind).tool === nodeDef(aimed.kind).tool) targets.push(found);
  }
  if (targets.length === 0) targets.push(aimed);

  const result = workNodes(
    targets,
    held,
    player.inventory,
    state.hay,
    hayCapacity(state.buildings),
    state.time.day,
    state.spawnSeed,
    held ? energyFactorOf(held) : 1,
  );

  const events: GameEvent[] = [];
  if (result.tooWeak) {
    events.push({ kind: 'toolTooWeak', playerId, node: aimed.kind, requires: result.tooWeak });
  }
  events.push(say(playerId, result.message));

  // A refused swing costs nothing: the budget is spent on work done.
  if (result.changed.length === 0) return { state, events };

  const felled = new Set(
    result.changed.filter((entry) => entry.node === null).map((entry) => entry.id),
  );
  const struck = new Map(
    result.changed
      .filter((entry): entry is { id: string; node: ResourceNode } => entry.node !== null)
      .map((entry) => [entry.id, entry.node]),
  );
  const nodes = state.nodes
    .filter((node) => !felled.has(node.id))
    .map((node) => struck.get(node.id) ?? node);

  for (const hit of result.hit) events.push({ kind: 'nodeHit', playerId, id: hit.id, node: hit.kind });
  for (const fell of result.cleared) {
    events.push({ kind: 'nodeCleared', playerId, id: fell.id, node: fell.kind, drops: fell.drops });
  }

  const energy = Math.max(0, player.energy - result.energyCost);
  if (energy === 0 && player.energy > 0) events.push({ kind: 'exhausted', playerId });

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      nodes,
      hay: result.hay,
      players: { ...state.players, [playerId]: { ...player, inventory: result.inventory, energy } },
    },
    events,
  };
}

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
 * The world as the fish draw wants to see it.
 *
 * Assembled in one place rather than at each call site, because the draw is
 * only deterministic if everybody builds the same tuple: an `hour` computed
 * two different ways in two functions is two different fish.
 */
function fishDraw(state: FarmState, player: PlayerState, tile: Point): FishDraw {
  return {
    seed: state.spawnSeed,
    totalMinutes: state.time.totalMinutes,
    area: player.area,
    tile,
    season: state.season,
    weather: state.weather,
    // Hours since midnight of the day that *began*, so six in the morning is
    // 6 and two the next morning is 26 — never `time.hour`, which wraps at 24
    // and would sort the small hours before the evening. See `FishDef`.
    hour: Math.floor(state.time.totalMinutes / 60),
  };
}

/**
 * Throws a line.
 *
 * Every rule that matters is checked here and nowhere else, because here is
 * the only place a modified client cannot edit it out: that a rod is in hand,
 * that the tile is water on the map this player is actually standing on, that
 * it is within the same reach everything else is held to, and that there is
 * energy to pay for it.
 *
 * The energy comes out on the throw and never goes back. A cast refunded on a
 * miss would make casting until something worth catching turns up the optimal
 * play, and an evening's fishing would stop being an evening spent.
 */
function applyCast(state: FarmState, playerId: PlayerId, target: Point): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);
  // Already fishing, or asleep. Both are silent: neither is a mistake worth a
  // sentence, and a client that repeats a cast while one is in the water is
  // an ordinary key repeat rather than an attack.
  if (player.fishing || player.asleep) return unchanged(state);

  const held = slotAt(player.inventory, player.selectedSlot);
  const rod = held && ITEMS[held.item]?.tool === 'rod' ? held.item : null;
  if (!rod) return { state, events: [say(playerId, 'Bạn cần cầm cần câu đã.')] };

  if (!isWithinReach(player, target.x, target.y)) {
    return { state, events: [say(playerId, 'Chỗ đó ngoài tầm với.')] };
  }
  if (tileAt(player.area, target.x, target.y)?.kind !== 'water') {
    return { state, events: [say(playerId, 'Phải ném xuống nước.')] };
  }
  if (player.energy < CAST_ENERGY) {
    return { state, events: [say(playerId, 'Bạn mệt quá, không vung nổi cần.')] };
  }

  // Bait is spent on the throw whether or not anything comes of it, which is
  // the same bargain the energy takes and for the same reason.
  const baited = countItem(player.inventory, BAIT_ITEM) > 0;
  const inventory = baited
    ? (removeItem(player.inventory, BAIT_ITEM, 1) ?? player.inventory)
    : player.inventory;

  const energy = player.energy - CAST_ENERGY;
  const next: PlayerState = {
    ...player,
    inventory,
    energy,
    // Turned towards the water, so the throw is not sideways.
    facing: facingFor(target.x - worldToTile(player.x), target.y - worldToTile(player.y), player.facing),
    fishing: startCast(fishDraw(state, player, target), barWidthOf(rod), baited),
  };

  const events: GameEvent[] = [{ kind: 'cast', playerId, area: player.area, target }];
  if (energy === 0 && player.energy > 0) events.push({ kind: 'exhausted', playerId });
  return { state: withPlayer(state, next), events };
}

/**
 * The reel, pressed or released.
 *
 * Two jobs in one command, and they are one command on purpose: the press
 * that strikes at a bite and the press that holds the square up are the same
 * press as far as the player's hand is concerned, and splitting them would
 * mean the client had to know which phase the server thought it was in.
 *
 * Anything outside those two phases is dropped without a word. A client
 * hammering the reel at a float that has not moved is not doing anything
 * wrong, and a fuzzer doing it deserves no answer either.
 */
function applyReel(state: FarmState, playerId: PlayerId, down: boolean): ApplyResult {
  const player = state.players[playerId];
  if (!player?.fishing) return unchanged(state);

  const fishing = player.fishing;
  if (!acceptsReel(fishing)) return unchanged(state);

  if (fishing.phase === 'biting') {
    // Only the press strikes. Letting go at a bite is not a strike, and
    // treating it as one would hook a fish for anybody who happened to have
    // been holding the key when it took.
    const hooked = down ? hookFish(fishing) : null;
    return hooked ? { state: withPlayer(state, { ...player, fishing: hooked }), events: [] } : unchanged(state);
  }

  if (fishing.reeling === down) return unchanged(state);
  return {
    state: withPlayer(state, { ...player, fishing: { ...fishing, reeling: down } }),
    events: [],
  };
}

/** Winds the line back in. Refunds nothing — the energy is already gone. */
function applyCancelCast(state: FarmState, playerId: PlayerId): ApplyResult {
  const player = state.players[playerId];
  if (!player?.fishing) return unchanged(state);
  return {
    state: withPlayer(state, { ...player, fishing: null }),
    events: [say(playerId, 'Bạn thu dây lại.')],
  };
}

/**
 * One tick of every cast in the water.
 *
 * Run from `applyTick` on the raw frame delta rather than on the ten-minute
 * clock step, which is the one place fishing does not follow the pattern the
 * herd and the villagers follow — and it is the point of spec 12's hardest
 * paragraph. The bar is real-time; a bite window quantised to the wall clock
 * would be one tick wide and land on a beat a player could count.
 */
function advanceFishing(state: FarmState, deltaMs: number): ApplyResult {
  let players: Record<PlayerId, PlayerState> | null = null;
  const events: GameEvent[] = [];

  for (const player of Object.values(state.players)) {
    if (!player.fishing) continue;
    const before = player.fishing;
    const step = stepFishing(before, deltaMs, state.spawnSeed, player.id);

    let fishing = step.fishing;
    let inventory = player.inventory;

    if (step.outcome === 'bite') {
      events.push({ kind: 'bite', playerId: player.id });
    } else if (step.outcome === 'missed' || step.outcome === 'escaped') {
      events.push({
        kind: 'fishEscaped',
        playerId: player.id,
        fish: before.fish,
        struck: step.outcome === 'escaped',
      });
      events.push(
        say(
          player.id,
          step.outcome === 'escaped' ? 'Nó giật mạnh một cái rồi đi mất.' : 'Bạn lỡ mất cú cắn câu.',
        ),
      );
    }

    // A landed fish is retried every tick until there is a slot for it, which
    // is why this is asked of the state rather than of the outcome: the tick
    // it lands and the tick a slot finally frees up both come through here.
    if (fishing?.landed) {
      const filled = addItem(inventory, fishing.fish, 1);
      if (filled) {
        const def = fishDef(fishing.fish);
        inventory = filled;
        events.push({
          kind: 'fishCaught',
          playerId: player.id,
          fish: fishing.fish,
          size: fishing.size,
          difficulty: def?.difficulty ?? 1,
        });
        events.push(say(player.id, describeCatch(fishing)));
        fishing = null;
      } else if (step.outcome === 'caught') {
        // Said once, on the tick it landed, rather than every tick after it.
        events.push(say(player.id, 'Túi đồ đã đầy. Cá vẫn còn trên dây — dọn một ô đi.'));
      }
    }

    if (fishing === before && inventory === player.inventory) continue;
    players ??= { ...state.players };
    players[player.id] = { ...player, fishing, inventory };
  }

  if (!players) return { state, events };
  return { state: { ...state, revision: state.revision + 1, players }, events };
}

/**
 * Makes something out of what is in the satchel.
 *
 * No range check and no counter, because there is no workbench: spec 11 is
 * explicit that crafting happens wherever the player is standing, and it is
 * right. A bench would be one more walk in a game where walking is already
 * the expensive part of a morning.
 */
function applyCraft(
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
function applyPlaceItem(
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
function applyPickUpItem(state: FarmState, playerId: PlayerId, x: number, y: number): ApplyResult {
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
function applyChestMoveStack(
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
function applyChestStow(state: FarmState, playerId: PlayerId, chestId: string): ApplyResult {
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
function applyMachineLoad(state: FarmState, playerId: PlayerId, machineId: string): ApplyResult {
  const found = reachableMachine(state, playerId, machineId);
  if ('error' in found) return found.error;
  const { player, machine } = found;

  const held = slotAt(player.inventory, player.selectedSlot);
  if (!held) {
    return { state, events: [say(playerId, `${machineDef(machine.kind).label} cần bạn cầm sẵn thứ để nạp vào.`)] };
  }

  const load = loadMachine(machine, held.item, state.time.day);
  if (!load.ok) return { state, events: [say(playerId, load.reason)] };

  const inventory = removeItem(player.inventory, held.item, load.takes);
  if (!inventory) {
    return {
      state,
      events: [
        say(
          playerId,
          `${machineDef(machine.kind).label} cần ${load.takes} ${itemDef(held.item).label.toLowerCase()} một mẻ.`,
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

function applyMachineCollect(state: FarmState, playerId: PlayerId, machineId: string): ApplyResult {
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
function applyPlaceableAct(
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
function learnRecipes(
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
function runSprinklers(
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

/**
 * Resolves a context-sensitive action: talk to Rowan, sell at the market, or
 * use the equipped tool on a tile.
 *
 * What is interactive comes from the map rather than from constants here, so
 * moving the market stall in Tiled moves where crops can be sold.
 *
 * `target` is the tile the mouse named; without one the player acts on the
 * tile they face, which is the keyboard path and is unchanged by all of this.
 */
function applyAct(state: FarmState, playerId: PlayerId, target?: Point): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  // A line in the water takes the action key over everything below. The
  // client sends `reel` rather than `act` while fishing, so this is only
  // reached by a client that is behind or is not ours; either way, hoeing a
  // bed halfway through landing a sturgeon is not what the press meant.
  if (player.fishing) return unchanged(state);

  // Reach is enforced here because here is the only place a modified client
  // cannot edit it out. The greyed-out cursor on the client is a courtesy;
  // this is the rule.
  if (target && !isWithinReach(player, target.x, target.y)) {
    return { state, events: [say(playerId, 'Chỗ đó ngoài tầm với.')] };
  }

  const tile = target ?? targetTile(player.area, player, player.facing);
  const key = plotKey(player.area, tile.x, tile.y);
  const plot = state.plots[key];

  // Standing beside somebody is enough to talk to them, which is what keeps
  // the keyboard path one key. A named target overrides that only when it
  // names soil: clicking a plot at Rowan's feet should till it, and clicking
  // anything else while stood at his gate should still be hello.
  const atCounter = target && plot ? null : interactableAt(player.area, player);
  const villager = target && plot ? null : nearestNpc(state, player);

  // Villagers walk, so one of them can be standing at a counter — Maeve works
  // the forge yard every day. The nearer of the two wins, which is the rule
  // two props already follow and the only one that stays predictable when the
  // thing you are standing next to moves around.
  if (villager && (!atCounter || villager.gap < propGap(atCounter, player))) {
    return applyNpcAct(state, playerId, villager.actor);
  }

  const nearby = atCounter;

  if (nearby?.interact === 'bed') return applySleep(state, playerId);

  // One press does both halves of a market visit: the basket is emptied onto
  // the counter and the stall opens with the coins it just paid you. Keeping
  // the sale on the keypress means the common trip is still one key, and
  // opening the panel is what makes the coins worth having.
  if (nearby?.interact === 'market') {
    const sale = sellAllCrops(player.inventory);
    const events: GameEvent[] = [say(playerId, sale.message)];
    const next: PlayerState = {
      ...player,
      inventory: sale.changed ? sale.inventory : player.inventory,
      panel: 'market',
    };
    if (sale.changed) {
      events.push({ kind: 'sold', playerId, coins: sale.coinsEarned, count: sale.soldCount });
    }
    if (player.panel !== 'market') events.push({ kind: 'panelChanged', playerId, panel: 'market' });
    return {
      state: {
        ...state,
        revision: state.revision + 1,
        coins: state.coins + sale.coinsEarned,
        players: { ...state.players, [playerId]: next },
      },
      events,
    };
  }

  // The blacksmith has nothing to sell over the counter, so acting at his
  // anvil only opens the panel; what to hand over is chosen there.
  if (nearby?.interact === 'blacksmith') {
    const ready = player.pendingUpgrade && state.time.day >= player.pendingUpgrade.readyOnDay;
    const opened = setPanel(state, playerId, 'workshop');
    return {
      state: opened.state,
      events: [
        ...opened.events,
        say(
          playerId,
          ready
            ? `"Của bạn đây, làm ra cũng đẹp." ${itemDef(player.pendingUpgrade!.item).label} đang chờ.`
            : '"Cứ để đó cho tôi, tôi sẽ làm ra trò."',
        ),
      ],
    };
  }

  // The rancher sells livestock and hay and buys nothing over the counter, so
  // acting here only opens the panel; which animal and which house are chosen
  // in it, because neither is a thing a keypress can say.
  if (nearby?.interact === 'rancher') {
    const opened = setPanel(state, playerId, 'ranch');
    const houses = state.buildings.filter(
      (building) => isAnimalHouse(building.kind) && isComplete(building),
    );
    return {
      state: opened.state,
      events: [
        ...opened.events,
        say(
          playerId,
          houses.length > 0
            ? '"Chuồng dựng xong rồi à? Vậy thì chọn đi."'
            : '"Dựng chuồng trước đã. Tôi không bán gà cho người chưa có chỗ nhốt."',
        ),
      ],
    };
  }

  // An animal comes before the ground under it, which is the whole of the
  // rule: a chicken standing on a plot is a chicken, and swinging a hoe
  // through it to till the soil underneath is not what anybody meant.
  //
  // Found two ways, in this order. The tile is what a click names, so clicking
  // the animal reaches it exactly. Standing beside one is what the keyboard
  // path has to mean, because an animal ambles and the tile it is on this
  // second is not something anybody can aim at — the same bargain a villager
  // gets, at the same radius. A click that named soil takes neither: that is
  // somebody aiming at a plot, and they get the plot.
  const herd = animalsOn(state.animals, player.area);
  const grazing =
    animalAtTile(herd, tile.x, tile.y) ?? (target && plot ? null : nearestAnimal(herd, player));
  if (grazing) return applyAnimalAct(state, playerId, grazing);

  // Standing on the farm's own construction. A coop or a barn is a morning's
  // round — eggs and troughs — and everything else is worth a word, because a
  // scaffold is something you paid for that is not doing anything yet.
  const standing = buildingAt(buildingsOn(state.buildings, player.area), tile.x, tile.y);
  if (standing) {
    const def = buildingDef(standing.kind);
    if (isComplete(standing) && isAnimalHouse(standing.kind)) {
      return applyHouseChores(state, playerId, standing);
    }
    return {
      state,
      events: [
        say(
          playerId,
          isComplete(standing)
            ? `${def.label}. ${def.blurb}`
            : `${def.label} mới dựng được nửa. Xong vào ngày ${standing.readyOnDay}.`,
        ),
      ],
    };
  }

  // Something a player put down, before the ground under it and before the
  // tool in hand. Same rule the animals and the trees get one branch up: a
  // chest is a chest, and hoeing the soil it is standing on is not what
  // anybody aiming at it meant.
  const standingItem = placeableAt(state.placeables, player.area, tile.x, tile.y);
  if (standingItem) return applyPlaceableAct(state, playerId, standingItem);

  // What is in hand decides how much of the field one swing covers. A basic
  // tool passes a single key here and this is the code it has always taken.
  const held = slotAt(player.inventory, player.selectedSlot);

  // A rod aimed at water is a cast, and it is asked here — after the props,
  // the villagers, the herd and the buildings, before the ground — so that
  // standing at the market with a rod in hand still sells the day's catch.
  // Nothing else in the game does anything to a water tile, so there is no
  // ambiguity to resolve below this line.
  if (held && ITEMS[held.item]?.tool === 'rod' && tileAt(player.area, tile.x, tile.y)?.kind === 'water') {
    return applyCast(state, playerId, tile);
  }

  // Whatever is standing on the tile comes before the ground under it, which
  // is the same rule the animals get one branch above and for the same reason:
  // a tree is a tree, and hoeing the soil it is rooted in is not what anybody
  // aiming at it meant. It is asked before the plot branch so that a wild plot
  // with a bramble on it is a bramble to clear rather than soil to till.
  const standingNode = nodeAt(state.nodes, player.area, tile.x, tile.y);
  if (standingNode) return applyNodeAct(state, playerId, standingNode, tile, held?.item ?? null);

  // Holding something crafted and swinging at clear ground puts it down. The
  // same gesture as everything else — hold, face, press — rather than a
  // separate cursor mode, which is what a chest deserves given that planting a
  // seed and swinging an axe already work exactly this way. Asked after the
  // nodes above, so a keg is never set down on top of a bramble.
  if (held && isPlaceableItem(held.item)) {
    return applyPlaceItem(state, playerId, held.item, tile.x, tile.y);
  }

  // Nothing farmable there: describing the tile is what the old Inspect tool
  // did, and it is a better default than a silent swing.
  if (!plot) {
    return { state, events: [say(playerId, describeTile(player.area, tile.x, tile.y))] };
  }

  // Anything with something standing on it is skipped, not worked: a swing
  // that tilled the soil under a bramble would be the one place in the game
  // where the ground wins over the thing on top of it, and the aimed tile —
  // checked above — has already been shown to be clear.
  const keys = held
    ? areaOfEffectTiles(tile, areaOfEffectOf(held.item), player.area)
        .filter((covered) => !nodeAt(state.nodes, player.area, covered.x, covered.y))
        .map((covered) => plotKey(player.area, covered.x, covered.y))
    : [key];
  const result = applySweep(
    state.plots,
    keys,
    player.inventory,
    player.selectedSlot,
    state.season,
    held ? energyFactorOf(held.item) : 1,
  );

  const events: GameEvent[] = [say(playerId, result.message)];
  // A refused action costs nothing: the budget is spent on work done.
  if (result.changed.length === 0) return { state, events };

  const plots = { ...state.plots };
  for (const { key: changedKey, plot: changedPlot } of result.changed) {
    plots[changedKey] = changedPlot;
    events.push({ kind: 'plotChanged', key: changedKey, action: result.action ?? undefined });
  }

  let quest = state.quest;
  for (const crop of result.harvested) {
    quest = recordHarvest(quest, crop);
    events.push({ kind: 'harvested', playerId, crop });
  }

  const energy = Math.max(0, player.energy - result.energyCost);
  if (energy === 0 && player.energy > 0) events.push({ kind: 'exhausted', playerId });

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      plots,
      quest,
      players: { ...state.players, [playerId]: { ...player, inventory: result.inventory, energy } },
    },
    events,
  };
}

function applyTick(state: FarmState, deltaMs: number): ApplyResult {
  const elapsed = Math.min(deltaMs, MAX_TICK_MS);

  // The casts move first, and on the frame delta rather than the clock step.
  // This is the one simulation in the game that does not wait for the ten
  // minute hand: everything else here happens on the hour, and a bite window
  // that could only open on the hour would be a metronome.
  const fished = advanceFishing(state, elapsed);
  const fishEvents = fished.events;

  const clockMs = fished.state.clockMs + elapsed;
  if (clockMs < CLOCK_STEP_MS) {
    return { state: { ...fished.state, clockMs }, events: fishEvents };
  }

  const steps = Math.floor(clockMs / CLOCK_STEP_MS);
  let next: FarmState = {
    ...fished.state,
    clockMs: clockMs % CLOCK_STEP_MS,
    revision: fished.state.revision + 1,
  };
  const events: GameEvent[] = [...fishEvents];

  for (let i = 0; i < steps; i += 1) {
    const advanced = advanceTime(next.time, CLOCK_STEP_MINUTES);
    if (advanced.newDay) {
      // 02:00. Anybody still standing collapses; a farm nobody is awake on
      // simply turns over, because nobody stayed up to be charged for it.
      const rolled = stillAwake(next).length > 0 ? collapse(next) : startNewDay(next);
      // The roll resets clockMs; keep the remainder we already banked.
      next = { ...rolled.state, clockMs: next.clockMs };
      events.push(...rolled.events);
      continue;
    }

    next = { ...next, time: advanced.time };

    // The village moves on the clock step rather than the frame. Ten in-game
    // minutes of walking is a short hop, and the renderer smooths between the
    // hops — which keeps six villagers out of the state on every frame and
    // off the wire on every tick.
    const walked = advanceNpcs(next.npcs, next.season, next.weather, next.time, CLOCK_STEP_MINUTES);
    if (walked !== next.npcs) next = { ...next, npcs: walked };

    // The herd grazes on the same step and for the same reasons. Fourteen
    // animals is smaller than the six villagers already cost, and the walk
    // is a pure function of the clock, so two clients simulating the same
    // farm draw the same herd in the same places with nothing sent to say so.
    const grazed = advanceAnimals(
      next.animals,
      next.buildings,
      next.nodes,
      next.placeables,
      next.weather,
      next.time,
      CLOCK_STEP_MINUTES,
    );
    if (grazed !== next.animals) next = { ...next, animals: grazed };

    const slept = rollIfEveryoneAsleep(next);
    if (slept) {
      next = { ...slept.state, clockMs: next.clockMs };
      events.push(...slept.events);
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
