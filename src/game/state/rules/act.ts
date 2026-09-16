/**
 * The action key.
 *
 * One press means a dozen different things depending on what is in front of
 * the player, and deciding which is the whole job of this module. It sits at
 * the top of the rules because it hands off to nearly all of them.
 */
import {
  animalAtTile,
  animalsOn,
  nearestAnimal,
  hayCapacity,
  isAnimalHouse,
} from '../../systems/animals';
import { buildingAt, buildingDef, buildingsOn, isComplete } from '../../systems/buildings';
import { applySweep } from '../../systems/farming';
import { slotAt } from '../../systems/inventory';
import {
  ITEMS,
  areaOfEffectOf,
  isPlaceableItem,
  energyFactorOf,
  itemDef,
  type ItemId,
} from '../../systems/items';
import { placeableAt } from '../../systems/placeables';
import { sellAtStall, stallFor } from '../../systems/shop';
import { recordHarvest } from '../../systems/quest';
import { nodeAt, nodeDef, workNodes, type ResourceNode } from '../../systems/resources';
import {
  areaOfEffectTiles,
  describeTile,
  interactableAt,
  isWithinReach,
  mineDepth,
  plotKey,
  worldToTile,
  propGap,
  targetTile,
  tileAt,
  type Point,
} from '../../world/areas';
import type { ApplyResult, GameEvent } from '../intents';
import type { FarmState, PlayerId, PlayerState } from '../types';
import { unchanged, say } from './common';
import { applySleep } from './day';
import { closedStallMessage, setPanel, stallOpen } from './counters';
import { applyAnimalAct, applyHouseChores } from './ranch';
import { nearestNpc, applyNpcAct } from './village';
import { applyCast } from './fishing';
import { applyPlaceItem, applyPlaceableAct } from './placeables';
import { applyAttack, applyDescend, holdsSword } from './mine';
import { floorFor } from '../../systems/mine';

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
export function applyAct(state: FarmState, playerId: PlayerId, target?: Point): ApplyResult {
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

  // Underground the action key means one of two things (spec 13): a sword in
  // hand swings it, and standing on the ladder goes down it. A click with a
  // sword is always a swing; the bare key on the ladder is always the ladder,
  // so a player holding a sword never has to put it away to descend.
  const depth = mineDepth(player.area);
  if (depth !== null) {
    const ladder = floorFor(state.mineSeed, depth).ladder;
    const onLadder =
      ladder !== null && worldToTile(player.x) === ladder.x && worldToTile(player.y) === ladder.y;
    if (holdsSword(player) && (target || !onLadder)) return applyAttack(state, playerId, target);
    if (onLadder) return applyDescend(state, playerId);
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
  //
  // Bà Xoan's cart is the same visit with its own stock, and only while she is
  // keeping it: walked up to out of hours it says when to come back, and sells
  // nothing and opens nothing.
  const stall = stallFor(nearby?.interact);
  if (stall) {
    if (!stallOpen(state, stall)) return { state, events: [say(playerId, closedStallMessage(stall))] };
    const sale = sellAtStall(player.inventory, stall);
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
