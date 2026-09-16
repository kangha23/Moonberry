/**
 * The counters a player stands at: which one they are at, the panel that opens
 * there, and the trades that only make sense in front of it — seeds at the
 * stall, tools at the anvil, and buildings from the carpenter.
 *
 * Every rule in here re-derives where the player is standing, because a panel
 * being open on a client proves nothing.
 */
import {
  BUILDING_AREA,
  buildingDef,
  checkPlacement,
  nextBuildingId,
  type Building,
  type BuildingKind,
} from '../../systems/buildings';
import { addItem, countItem, removeItem } from '../../systems/inventory';
import { ITEMS, itemDef, upgradeFor, type ItemId } from '../../systems/items';
import { placeableById } from '../../systems/placeables';
import { isStaffed } from '../../npcs/schedule';
import { STALLS, buyFromStall, stallFor, type StallId } from '../../systems/shop';
import { interactableAt, isWithinReach } from '../../world/areas';
import type { ApplyResult, GameEvent } from '../intents';
import {
  PANEL_FOR_INTERACT,
  UPGRADE_DAYS,
  type FarmState,
  type PanelId,
  type PlayerId,
  type PlayerState,
} from '../types';
import { unchanged, say, withPlayer } from './common';

/**
 * Which counter this player is standing at, if any.
 *
 * Asked of the player's own position, which came from the server's movement
 * simulation — never of anything the client sent alongside the purchase. This
 * is the check that keeps `buy` and `upgradeTool` honest: a client that only
 * sends them while its panel is open is a client we have decided to believe.
 */
export function counterAt(player: PlayerState): PanelId | null {
  const interact = interactableAt(player.area, player)?.interact;
  return interact ? (PANEL_FOR_INTERACT[interact] ?? null) : null;
}

/** Which stall this player is standing at, if any. The same position `counterAt` reads. */
export function stallAt(player: PlayerState): StallId | null {
  return stallFor(interactableAt(player.area, player)?.interact);
}

/**
 * Whether a stall is trading right now.
 *
 * The market always is. A stall with a keeper is open while somebody's
 * schedule has them keeping it, which for the xôi cart is seven till noon and
 * two till five — asked of the clock rather than of anybody's position.
 */
export function stallOpen(state: FarmState, stall: StallId): boolean {
  const { keptBy } = STALLS[stall];
  return keptBy === null || isStaffed(keptBy, state.season, state.weather, state.time);
}

/** What a closed stall says to somebody who walks up to it. */
export function closedStallMessage(stall: StallId): string {
  return `${STALLS[stall].label} đã dọn hàng. Bà Xoan bán từ 7 giờ đến trưa, và từ 2 đến 5 giờ chiều.`;
}

/** Sets a player's open panel, or returns the state untouched if it is already so. */
export function setPanel(state: FarmState, playerId: PlayerId, panel: PanelId | null): ApplyResult {
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
export function panelSurvivesStep(state: FarmState, player: PlayerState): boolean {
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
export function applyBuy(state: FarmState, playerId: PlayerId, item: string, count: number): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const stall = stallAt(player);
  if (counterAt(player) !== 'market' || !stall) {
    return { state, events: [say(playerId, 'Bạn không đứng ở sạp chợ.')] };
  }
  if (!stallOpen(state, stall)) {
    return { state, events: [say(playerId, closedStallMessage(stall))] };
  }

  const result = buyFromStall(player.inventory, state.coins, state.season, item, count, stall);
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

/**
 * Hands a tool over the counter.
 *
 * The tool is *gone*: it comes out of the satchel now and comes back two
 * mornings later, which is the whole mechanic. Buying an upgrade that arrived
 * instantly would be a purchase; giving up watering at scale for two days,
 * chosen deliberately in the week before you need it, is a decision.
 */
export function applyUpgradeTool(state: FarmState, playerId: PlayerId, item: ItemId): ApplyResult {
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

  // Bars before gold, and out of what is left once the tool is off the
  // satchel: both are refusals, and neither removal is written until the end.
  const barred = upgrade.bars ? removeItem(inventory, upgrade.bars.item, upgrade.bars.count) : inventory;
  if (!barred) {
    const bars = upgrade.bars!;
    const have = countItem(player.inventory, bars.item);
    return {
      state,
      events: [
        say(
          playerId,
          `${itemDef(upgrade.item).label} cần ${bars.count} ${itemDef(bars.item).label.toLowerCase()}, bạn mới có ${have}.`,
        ),
      ],
    };
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
  const next: PlayerState = { ...player, inventory: barred, pendingUpgrade: { item: upgrade.item, readyOnDay } };
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
export function applyCollectTool(state: FarmState, playerId: PlayerId): ApplyResult {
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
export function applyPlaceBuilding(
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
