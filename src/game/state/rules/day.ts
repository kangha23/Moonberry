/**
 * The night: turning in, the vote that ends it, the collapse at 02:00, and the
 * morning that follows.
 *
 * Everything that happens "overnight" is gathered in `startNewDay`, which is
 * why this module reaches into the sprinklers and the recipes — the order the
 * morning runs in is a design decision, and it is easier to keep when it is all
 * in one place.
 */
import { startAnimalDay } from '../../systems/animals';
import { startRelationshipDay } from '../../npcs/relationships';
import { spawnNpcs } from '../../npcs/schedule';
import { advancePlotDay, killOutOfSeasonCrops, type PlotState } from '../../systems/farming';
import { refillCharges } from '../../systems/inventory';
import { itemDef } from '../../systems/items';
import { isMachine } from '../../systems/placeables';
import { startNodeDay } from '../../systems/resources';
import { createTimeState, isRainy, seasonForDay, weatherForDay } from '../../systems/time';
import { interactableAt } from '../../world/areas';
import type { ApplyResult, GameEvent } from '../intents';
import {
  COLLAPSE_COIN_CAP,
  COLLAPSE_COIN_SHARE,
  type FarmState,
  type PlayerId,
  type PlayerState,
} from '../types';
import { unchanged, say, onlineMembers } from './common';
import { learnRecipes, runSprinklers } from './placeables';

/**
 * Who is still on their feet.
 *
 * Only people who are here count. An offline member must not hold the night
 * open, or one person going out for the evening freezes the farm for everyone
 * else; and an empty farm must not vote itself into tomorrow.
 */
export function stillAwake(state: FarmState): PlayerState[] {
  return onlineMembers(state).filter((player) => !player.asleep);
}

/**
 * Rolls the farm over to the next morning: crops drink, the clock resets to
 * 6am, weather and season are redrawn, every watering can refills, and
 * everybody wakes up rested — unless the night ended in a collapse, which
 * costs half of it.
 */
export function startNewDay(state: FarmState, collapsed = false): ApplyResult {
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
export function collapse(state: FarmState): ApplyResult {
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
export function rollIfEveryoneAsleep(state: FarmState): ApplyResult | null {
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
export function applySleep(state: FarmState, playerId: PlayerId): ApplyResult {
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
