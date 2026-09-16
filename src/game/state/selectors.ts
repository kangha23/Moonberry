import {
  ANIMAL_DEFS,
  HAY_PRICE,
  animalsIn,
  capacityOf,
  gradeFor,
  hasProduce,
  hayCapacity,
  heartsFor,
  isAnimalHouse,
  nearestAnimal,
  type Animal,
} from '../systems/animals';
import {
  BUILDING_AREA,
  buildingDef,
  buildingTiles,
  isComplete,
  type Building,
} from '../systems/buildings';
import {
  HOTBAR_SIZE,
  countItem,
  countProduce,
  slotAt,
  type Inventory,
  type ItemStack,
} from '../systems/inventory';
import { ITEMS, upgradeFor, type ItemDef, type ItemId } from '../systems/items';
import {
  ALL_RECIPES,
  describeShortfall,
  ingredientsFor,
  type Ingredient,
  type Recipe,
} from '../systems/crafting';
import {
  describeMachine,
  isChest,
  isMachine,
  machineIsReady,
  placeableById,
  type Chest,
  type Machine,
} from '../systems/placeables';
import { checkTool, nodeAt, nodeDef, type ResourceNode } from '../systems/resources';
import { ELEVATOR_EVERY, floorFor } from '../systems/mine';
import { PHO_DISHES, STALLS, shopStock, type ShopEntry, type StallId } from '../systems/shop';
import { npcDef } from '../npcs/definitions';
import { GIFTS_PER_WEEK, heartsWith, isGiftable, relationshipWith } from '../npcs/relationships';
import { activityAt, activityLabel, type NpcActor } from '../npcs/schedule';
import {
  areaMap,
  interactableAt,
  isNear,
  isWithinReach,
  propGap,
  mineDepth,
  targetTile,
  worldToTile,
} from '../world/areas';
import { mineFixtureAt } from '../world/mineMap';
import { closedStallMessage, stallAt, stallOpen } from './rules/counters';
import type { FarmStoreState } from './store';
import type { FarmState, PanelId, PlayerId, PlayerState } from './types';

export const CONTROLS_HINT =
  'Di chuyển WASD/Phím mũi tên • Bấm vào một ô hoặc nhấn Space/Enter để hành động, giữ để lặp lại • Ô đồ 1-9, Q/E hoặc lăn chuột • Tab hoặc I để mở túi • B để đi ngủ';

export function localPlayer(store: FarmStoreState): PlayerState | null {
  const { farm, localPlayerId } = store;
  return localPlayerId ? (farm.players[localPlayerId] ?? null) : null;
}

/**
 * The villager this player is standing next to, and how far off they are.
 *
 * The gap comes back so the prompt can resolve the same way the reducer does
 * when a counter and a person are both in reach: nearest wins. Two answers to
 * "what does Space do here" would be worse than either of them.
 */
export function nearestVillager(
  farm: FarmState,
  player: PlayerState,
): { actor: NpcActor; gap: number } | null {
  let best: { actor: NpcActor; gap: number } | null = null;
  for (const actor of farm.npcs) {
    if (actor.area !== player.area || !isNear(player, actor)) continue;
    const gap = Math.hypot(actor.x - player.x, actor.y - player.y);
    if (!best || gap < best.gap) best = { actor, gap };
  }
  return best;
}

/** Hearts, as the little row of them the prompt bar draws in text. */
function heartBar(hearts: number): string {
  return hearts > 0 ? ` ${'♥'.repeat(hearts)}` : '';
}

/**
 * What standing next to somebody offers.
 *
 * Says which of the two things Space will do, because that depends on what is
 * in hand and guessing wrong costs a gift you cannot take back today.
 */
function villagerHint(
  farm: FarmState,
  player: PlayerState,
  actor: NpcActor,
  message: string,
): string {
  const def = npcDef(actor.id);
  const hearts = heartsWith(player.relationships, actor.id);
  const who = `${def.name}${heartBar(hearts)}`;
  const held = heldStack(player);

  // What they just said outranks the offer to make them say it. Without this
  // the hint paints straight back over the line the moment it is spoken, and
  // the dialogue — the entire point of walking over here — is never readable.
  // Recognised by the name it is prefixed with rather than by a timer, so the
  // selector stays pure and the line clears itself the moment anything else
  // happens.
  if (message.startsWith(`${def.name}: `)) return `${heartBar(hearts).trim()} ${message}`.trim();

  if (farm.quest.completed && !farm.quest.rewarded && def.questGiver) {
    return `${who}: nhấn Space/Enter để giao nông sản và nhận thưởng.`;
  }

  if (held && isGiftable(held.item)) {
    const relationship = relationshipWith(player.relationships, actor.id);
    const label = (ITEMS[held.item]?.label ?? held.item).toLowerCase();
    if (relationship.giftedToday) {
      return `Hôm nay ${who} đã nhận quà rồi. Space/Enter để trò chuyện.`;
    }
    if (relationship.giftsThisWeek >= GIFTS_PER_WEEK) {
      return `Tuần này ${who} đã nhận ${GIFTS_PER_WEEK} món quà của bạn. Space/Enter để trò chuyện.`;
    }
    return `${who}: nhấn Space/Enter để tặng ${label}.`;
  }

  const doing = activityLabel(activityAt(def, farm.season, farm.weather, farm.time));
  return doing
    ? `${who}, ${doing}. Nhấn Space/Enter để trò chuyện.`
    : `${who}: nhấn Space/Enter để trò chuyện.`;
}

function marketHint(player: PlayerState): string {
  if (player.panel === 'market') {
    return 'Sạp chợ: mua hạt giống cho mùa này, hoặc nhấn Escape để rời đi.';
  }
  const basket = countProduce(player.inventory);
  if (basket <= 0) return 'Sạp chợ: nhấn Space/Enter để xem sạp đang có hạt giống gì.';
  return `Sạp chợ: nhấn Space/Enter để bán ${basket} nông sản và mở sạp.`;
}

/**
 * Bà Xoan's cart, which is the market's hint with two differences: it can be
 * shut, and it only buys the three dishes — so the count it promises to sell
 * is of those, not of everything in the basket.
 */
function xoiStallHint(farm: FarmState, player: PlayerState): string {
  const { label } = STALLS['xoi-stall'];
  if (!stallOpen(farm, 'xoi-stall')) return closedStallMessage('xoi-stall');
  if (player.panel === 'market') {
    return `${label}: mua hạt nếp, hạt đậu xanh, hoặc nhấn Escape để rời đi.`;
  }
  const dishes = player.inventory.reduce(
    (total, slot) => (slot && PHO_DISHES.includes(slot.item) ? total + slot.count : total),
    0,
  );
  if (dishes <= 0) return `${label}: nhấn Space/Enter để xem bà có hạt gì.`;
  return `${label}: nhấn Space/Enter để bán ${dishes} món cho bà Xoan.`;
}

function blacksmithHint(player: PlayerState, day: number): string {
  const pending = player.pendingUpgrade;
  if (pending) {
    const label = ITEMS[pending.item]?.label ?? pending.item;
    if (day >= pending.readyOnDay) return `Lò rèn: ${label.toLowerCase()} của bạn đã xong. Nhấn Space/Enter.`;
    const days = pending.readyOnDay - day;
    return `Lò rèn: ${label} còn ${days} ngày nữa.`;
  }
  if (player.panel === 'workshop') {
    return 'Lò rèn: giao một nông cụ, hoặc đặt dựng một công trình. Escape để rời đi.';
  }
  return 'Lò rèn: nhấn Space/Enter để bàn về nông cụ và nhà cửa.';
}

/**
 * What the rancher's pen offers.
 *
 * It says the thing a player standing there most needs to know, which is not
 * the prices: it is whether the farm has anywhere to put an animal. Somebody
 * who walks over with 3000g and no coop should find that out here rather than
 * after opening the panel and reading four greyed-out rows.
 */
function ranchHint(farm: FarmState, player: PlayerState): string {
  if (player.panel === 'ranch') {
    return 'Bãi quây: mua gia súc và cỏ khô, hoặc nhấn Escape để rời đi.';
  }
  const houses = farm.buildings.filter(
    (building) => isAnimalHouse(building.kind) && isComplete(building),
  );
  if (houses.length === 0) {
    return 'Bãi quây gia súc: cần một chuồng đã dựng xong trước đã. Space/Enter để hỏi.';
  }
  return `Bãi quây gia súc: nhấn Space/Enter để mua gia súc, hoặc cỏ khô ${HAY_PRICE}g một bó.`;
}

/**
 * The animal a player is standing beside, if any.
 *
 * The reducer's own function, called with the reducer's own arguments, so the
 * hint cannot promise a collection the key then declines to make. Only the
 * ones out of doors: an animal inside its house is reached through the house,
 * which is a building and says its own thing.
 */
export function animalBeside(farm: FarmState, player: PlayerState): Animal | null {
  if (player.area !== BUILDING_AREA) return null;
  return nearestAnimal(farm.animals, player);
}

/**
 * What walking up to an animal offers, which is one of exactly two things.
 *
 * Going hungry rides along as a clause rather than as its own line, because it
 * is a *state* and the rest of this is an *offer*: one press does the same
 * thing whether or not the trough is empty, and a hint that swapped the offer
 * out for the news would leave a player pressing a key that no longer says
 * what it does.
 */
function animalHint(farm: FarmState, animal: Animal): string {
  const def = ANIMAL_DEFS[animal.kind];
  const hearts = heartBar(heartsFor(animal.affection));
  const hungry = animal.fedToday ? '' : ', chưa được ăn';
  const who = `${animal.name} (${def.label.toLowerCase()})${hearts}${hungry}`;

  if (hasProduce(animal, farm.time.day)) {
    return `${who}: nhấn Space/Enter để ${def.collectVerb}.`;
  }
  if (animal.pettedToday) return `${who} — hôm nay đã được vuốt rồi.`;
  return `${who}: nhấn Space/Enter để vuốt.`;
}

/**
 * The coop or barn a player is standing at, if any.
 *
 * Buildings are farm state rather than map props, so `interactableAt` cannot
 * see them and this has to ask separately — which is the cost, stated when the
 * buildings went in, of collision no longer being purely a map property.
 * Measured with the reducer's own reach rule, so the prompt promises exactly
 * what the key will do.
 */
export function nearbyAnimalHouse(farm: FarmState, player: PlayerState): Building | null {
  if (player.area !== BUILDING_AREA) return null;
  return (
    farm.buildings.find(
      (building) =>
        isAnimalHouse(building.kind) &&
        isComplete(building) &&
        buildingTiles(building).some((tile) => isWithinReach(player, tile.x, tile.y)),
    ) ?? null
  );
}

/**
 * What a press at the coop door will actually do.
 *
 * One key does three things there, resolved in the reducer in a fixed order,
 * so the prompt has to work out which one it will be rather than listing all
 * three. Anything else and the player learns that Space at a coop is a lottery.
 */
function houseHint(farm: FarmState, building: Building): string {
  const label = buildingDef(building.kind).label;
  const housed = animalsIn(farm.animals, building.id);
  if (housed.length === 0) {
    return `${label} còn trống. Ra chỗ Bram ngoài làng mà mua gia súc.`;
  }

  const ready = housed.filter((animal) => hasProduce(animal, farm.time.day)).length;
  const hungry = housed.filter((animal) => !animal.fedToday).length;
  if (ready > 0 || (hungry > 0 && farm.hay > 0)) {
    const jobs = [ready > 0 ? `thu ${ready} món` : '', hungry > 0 && farm.hay > 0 ? `cho ăn` : '']
      .filter(Boolean)
      .join(' và ');
    return `${label}: nhấn Space/Enter để ${jobs}.`;
  }
  if (hungry > 0) return `${label}: ${hungry} con chưa được ăn, mà kho cỏ đã cạn.`;
  return building.doorOpen
    ? `${label}: cửa đang mở. Space/Enter để đóng lại.`
    : `${label}: cửa đang đóng. Space/Enter để mở cho chúng ra ngoài.`;
}

/**
 * The thing standing on the tile this player is facing, if any.
 *
 * The faced tile rather than proximity, unlike the animals and the villagers,
 * and the difference is not an oversight: a tree does not move. It is exactly
 * where the keyboard swing is going to land, so the hint is the truth about
 * the next keypress rather than a guess about the nearest object.
 */
export function nodeAhead(farm: FarmState, player: PlayerState): ResourceNode | null {
  const tile = targetTile(player.area, player, player.facing);
  return nodeAt(farm.nodes, player.area, tile.x, tile.y);
}

/**
 * What swinging at this would do, or why it would not — or nothing at all.
 *
 * Nothing at all is the important case, and it took a bug to find. Since the
 * farm grows its own brambles there is nearly always *something* standing in
 * front of a player, so a hint that fired on every one of them sat on the
 * prompt bar permanently and swallowed everything else the game had to say —
 * including "Ngày 2 bắt đầu" on the morning it rolled over.
 *
 * So the bar only offers what the thing in your hand is for: a swing that
 * would actually land, or a refusal from the right family of tool ("that stump
 * wants copper", which is the one worth walking to the blacksmith about).
 * Holding a watering can in front of a bramble says nothing, because watering
 * is what you were doing. Pressing the key still explains itself in full —
 * that message comes from the reducer and is not this function's business.
 */
function nodeHint(player: PlayerState, node: ResourceNode): string {
  const def = nodeDef(node.kind);
  const held = heldStack(player);
  const check = checkTool(node, held?.item ?? null);
  if (!check.ok) return check.tooWeak ? check.reason : '';

  const swings = node.health > 1 ? ` Còn ${node.health} nhát.` : '';
  const cost = def.energy > 0 ? ` Mỗi nhát ${def.energy} sức.` : '';
  return `${def.label}: nhấn Space/Enter.${swings}${cost}`;
}

function bedHint(player: PlayerState): string {
  if (player.asleep) return 'Đang nằm trên giường. Nhấn Space/Enter hoặc B để dậy.';
  return `Nhấn Space/Enter hoặc B để đi ngủ. Thể lực ${player.energy}/${player.maxEnergy}.`;
}

/**
 * What the player should be told right now: a proximity hint if they are
 * standing next to something interactive, otherwise the last action message.
 */
export function promptFor(store: FarmStoreState): string {
  const player = localPlayer(store);
  if (!player) return store.message;

  const mine = mineHint(store.farm, player);
  if (mine) return mine;

  const nearby = interactableAt(player.area, player);
  // Nearest wins between a person and a counter, exactly as it does in the
  // reducer — the prompt has to promise what the key will actually do.
  const villager = nearestVillager(store.farm, player);
  if (villager && (!nearby || villager.gap < propGap(nearby, player))) {
    return villagerHint(store.farm, player, villager.actor, store.message);
  }

  if (nearby?.interact === 'market') return marketHint(player);
  if (nearby?.interact === 'xoi-stall') return xoiStallHint(store.farm, player);
  if (nearby?.interact === 'blacksmith') return blacksmithHint(player, store.farm.time.day);
  if (nearby?.interact === 'rancher') return ranchHint(store.farm, player);
  if (nearby?.interact === 'bed') return bedHint(player);

  // After the props rather than before them, because the farm has no
  // interactive props on it and the village has no animals: the two can never
  // compete, and asking in this order keeps the cheap check first.
  const animal = animalBeside(store.farm, player);
  if (animal) return animalHint(store.farm, animal);

  const house = nearbyAnimalHouse(store.farm, player);
  if (house) return houseHint(store.farm, house);

  // Last of the lot, because it is the only one aimed rather than stood beside:
  // everything above is something you have walked up to, and a swing at the
  // ground is what is left when you have not.
  const node = nodeAhead(store.farm, player);
  const offer = node ? nodeHint(player, node) : '';
  if (offer) return offer;

  return store.message;
}

// --- the herd ----------------------------------------------------------------

/**
 * One row of the ranch panel's house picker.
 *
 * Derived rather than stored, and memoised on the two arrays it reads, for the
 * same reason `stockFor` is: zustand compares selector results by identity, so
 * a fresh array on every read is a re-render on every read.
 */
export interface HouseSlot {
  id: string;
  label: string;
  kind: Building['kind'];
  taken: number;
  capacity: number;
}

const NO_HOUSES: HouseSlot[] = [];

let houseCache: { buildings: Building[]; animals: Animal[]; houses: HouseSlot[] } | null = null;

export function animalHouses(farm: FarmState): HouseSlot[] {
  if (houseCache?.buildings === farm.buildings && houseCache.animals === farm.animals) {
    return houseCache.houses;
  }

  const found = farm.buildings
    .filter((building) => isAnimalHouse(building.kind) && isComplete(building))
    .map((building) => ({
      id: building.id,
      label: buildingDef(building.kind).label,
      kind: building.kind,
      taken: animalsIn(farm.animals, building.id).length,
      capacity: capacityOf(building.kind),
    }));

  const houses = found.length > 0 ? found : NO_HOUSES;
  houseCache = { buildings: farm.buildings, animals: farm.animals, houses };
  return houses;
}

/**
 * How much hay the silos can hold, which is nought without one.
 *
 * A number rather than a `{ held, capacity }` pair, and that is not a style
 * choice: these selectors are read through zustand, which compares results by
 * identity, and a fresh object on every read is a re-render on every read —
 * which is a render loop. Anything here that is not already stable in the
 * state has to be either a primitive or memoised. See `NO_INVENTORY`.
 */
export function hayCapacityOf(farm: FarmState): number {
  return hayCapacity(farm.buildings);
}

/** What an animal's affection is worth, in words a panel row can print. */
export function gradeLabel(animal: Animal): string {
  const grade = gradeFor(animal.affection);
  if (grade === 'fine') return 'thượng hạng';
  if (grade === 'good') return 'loại tốt';
  if (grade === 'normal') return 'loại thường';
  return 'chưa cho gì';
}

/**
 * Who is here and still on their feet.
 *
 * The night waits on exactly these people, and the list has to be read live
 * rather than computed once: somebody connecting mid-night arrives awake and
 * re-opens the vote.
 */
export function stillAwake(farm: FarmState): PlayerState[] {
  return Object.values(farm.players).filter((player) => player.online && !player.asleep);
}

/** Why nothing is happening, for a player who has already turned in. */
export function waitingOnLabel(farm: FarmState, localPlayerId: PlayerId | null): string {
  const others = stillAwake(farm).filter((player) => player.id !== localPlayerId);
  if (others.length === 0) return '';
  const names = others.map((player) => player.name).join(', ');
  return `Đang chờ ${others.length} nông dân nữa đi ngủ: ${names}`;
}

/** How full the energy bar is, from 0 to 1. */
// --- the mine ----------------------------------------------------------------

/** True when the player's hand holds a sword. */
export function holdingSword(player: PlayerState | null): boolean {
  const held = player ? slotAt(player.inventory, player.selectedSlot) : null;
  return Boolean(held && ITEMS[held.item]?.tool === 'sword');
}

/**
 * What the action key does in or at the mouth of the mine, or null when it
 * does whatever it does everywhere else.
 *
 * The client picks which intent to send and the reducer decides whether it
 * happens — the fishing reel's bargain. `aimed` is a click on a tile: with a
 * sword in hand a click is always a swing, while the bare key on a ladder is
 * always the ladder, so nobody has to put the sword away to go down.
 */
export type MineAction = 'attack' | 'descend' | 'exitMine' | 'elevator';

export function mineActionFor(farm: FarmState, player: PlayerState, aimed: boolean): MineAction | null {
  const sword = holdingSword(player);
  const depth = mineDepth(player.area);
  if (depth === null) {
    // Above ground a sword is just something in hand: there is nothing to
    // hit, and a swing must not take the key from the market or a villager.
    return interactableAt(player.area, player)?.interact === 'mine' ? 'descend' : null;
  }
  if (sword && aimed) return 'attack';
  const fixture = mineFixtureAt(floorFor(farm.mineSeed, depth), {
    x: worldToTile(player.x),
    y: worldToTile(player.y),
  });
  if (fixture === 'ladder') return 'descend';
  if (fixture === 'exit') return 'exitMine';
  if (fixture === 'elevator') return 'elevator';
  return sword ? 'attack' : null;
}

/** The elevator's stops this farm has opened, shallowest first. */
export function elevatorStops(farm: FarmState): number[] {
  const stops: number[] = [];
  for (let depth = ELEVATOR_EVERY; depth <= farm.deepestFloor; depth += ELEVATOR_EVERY) stops.push(depth);
  return stops;
}

function mineHint(farm: FarmState, player: PlayerState): string {
  const action = mineActionFor(farm, player, false);
  const depth = mineDepth(player.area);
  if (action === 'descend') {
    return depth === null ? 'Space: xuống mỏ.' : `Space: xuống tầng ${depth + 1}.`;
  }
  if (action === 'exitMine') return 'Space: leo lên khỏi mỏ.';
  if (action === 'elevator') {
    return elevatorStops(farm).length > 0 ? 'Space: gọi thang máy.' : 'Thang máy. Chưa mở tầng nào để tới.';
  }
  if (depth !== null) {
    return holdingSword(player)
      ? `Tầng ${depth}. Space hoặc bấm chuột để vung kiếm.`
      : `Tầng ${depth}. Cầm kiếm để đánh quái; tìm thang để xuống sâu hơn.`;
  }
  return '';
}

/** Health as a fraction of its ceiling, for the tube. */
export function healthRatio(player: PlayerState | null): number {
  if (!player || player.maxHealth <= 0) return 0;
  return Math.max(0, Math.min(1, player.health / player.maxHealth));
}

/**
 * Whether the health tube is on screen: underground, or hurt. Spec 13 — a
 * bar that sat at full on the farm all day would be a number nobody reads.
 */
export function showHealthBar(player: PlayerState | null): boolean {
  if (!player) return false;
  return player.health < player.maxHealth || mineDepth(player.area) !== null;
}

export function energyRatio(player: PlayerState | null): number {
  if (!player || player.maxEnergy <= 0) return 0;
  return Math.max(0, Math.min(1, player.energy / player.maxEnergy));
}

/** The human-readable name of the area a player is standing in. */
export function areaName(player: PlayerState | null): string {
  return player ? areaMap(player.area).name : '';
}

/** How many members of this world are connected right now. */
export function onlineCount(farm: FarmState): number {
  return Object.values(farm.players).filter((player) => player.online).length;
}

/**
 * The clock face, which moves in tens even though the clock underneath does not.
 * A face ticking 6:02, 6:04, 6:06 is a stopwatch, and nobody plans a farm day
 * to the two minutes.
 */
export function formatClock(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = (Math.floor((totalMinutes % 60) / 10) * 10).toString().padStart(2, '0');
  const suffix = hours >= 12 ? 'CH' : 'SA';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${minutes} ${suffix}`;
}

/** The stack in hand, which is whatever the selected hotbar slot holds. */
export function heldStack(player: PlayerState | null): ItemStack | null {
  return player ? slotAt(player.inventory, player.selectedSlot) : null;
}

export function itemFor(stack: ItemStack | null): ItemDef | null {
  return stack ? (ITEMS[stack.item] ?? null) : null;
}

/** What the HUD calls whatever is in hand. */
export function heldLabel(player: PlayerState | null): string {
  return itemFor(heldStack(player))?.label ?? 'Tay không';
}

/**
 * The first twelve slots, padded so the hotbar always draws twelve cells.
 *
 * Padding matters: a hotbar that shrinks when the last slot empties would move
 * every other slot out from under the number key that selects it.
 */
export function hotbarSlots(player: PlayerState | null): Inventory {
  const inventory = player?.inventory ?? [];
  return Array.from({ length: HOTBAR_SIZE }, (_, index) => inventory[index] ?? null);
}

/**
 * Stood in for an inventory that does not exist yet.
 *
 * One shared array rather than a fresh `[]` per call: these selectors are read
 * through zustand, which compares results by identity, and a new empty array
 * every read is a state change every read — which is an infinite render loop.
 */
const NO_INVENTORY: Inventory = [];

/** Every slot, for the full grid. Empty until the local player has joined. */
export function inventorySlots(player: PlayerState | null): Inventory {
  return player ? player.inventory : NO_INVENTORY;
}

/** How many free slots are left, which is what a full basket costs you. */
export function freeSlotCount(player: PlayerState | null): number {
  return player ? player.inventory.filter((slot) => slot === null).length : 0;
}

/**
 * Which place-bound panel is up for this client, if any.
 *
 * Read off the player rather than off a local flag, because the server owns
 * it: walking out of range closes the counter, and the panel has to go with
 * it. A player can never have two open, because `panel` is one field.
 */
export function openPanel(store: FarmStoreState): PanelId | null {
  return localPlayer(store)?.panel ?? null;
}

/** Whether any world-owned panel is holding this client's input. */
export function panelIsOpen(store: FarmStoreState): boolean {
  return openPanel(store) !== null;
}

/**
 * Everything in the satchel the blacksmith would take, with what it becomes.
 *
 * Derived from the item table rather than listed, so a tool added there shows
 * up at the anvil without anybody remembering to come back here.
 */
export interface UpgradeOffer {
  item: ItemId;
  label: string;
  into: ItemId;
  intoLabel: string;
  cost: number;
  /** What the anvil also wants, and how much of it this satchel holds. */
  bars: { item: ItemId; label: string; needs: number; has: number } | null;
}

/**
 * Memoised on the inventory's identity, for the same reason `stockFor` is:
 * zustand compares selector results by identity, and a fresh array on every
 * read is a re-render on every read, which is a render loop. The reducer is
 * immutable, so an inventory that has not changed is the same array.
 */
let offerCache: { inventory: Inventory; offers: UpgradeOffer[] } | null = null;

export function upgradeOffers(player: PlayerState | null): UpgradeOffer[] {
  if (!player) return NO_OFFERS;
  if (offerCache?.inventory === player.inventory) return offerCache.offers;

  const seen = new Set<ItemId>();
  const found: UpgradeOffer[] = [];
  for (const slot of player.inventory) {
    if (!slot || seen.has(slot.item)) continue;
    seen.add(slot.item);
    const upgrade = upgradeFor(slot.item);
    if (!upgrade) continue;
    found.push({
      item: slot.item,
      label: ITEMS[slot.item].label,
      into: upgrade.item,
      intoLabel: ITEMS[upgrade.item].label,
      cost: upgrade.cost,
      bars: upgrade.bars
        ? {
            item: upgrade.bars.item,
            label: ITEMS[upgrade.bars.item].label,
            needs: upgrade.bars.count,
            has: countItem(player.inventory, upgrade.bars.item),
          }
        : null,
    });
  }

  const offers = found.length > 0 ? found : NO_OFFERS;
  offerCache = { inventory: player.inventory, offers };
  return offers;
}

/** Stood in for a satchel with nothing worth upgrading — see NO_INVENTORY. */
const NO_OFFERS: UpgradeOffer[] = [];

/** Whether the tool at the blacksmith can be picked up today. */
export function upgradeIsReady(player: PlayerState | null, day: number): boolean {
  return player?.pendingUpgrade ? day >= player.pendingUpgrade.readyOnDay : false;
}

/** Stood in for a season with nothing in stock — see NO_INVENTORY above. */
const NO_STOCK: ShopEntry[] = [];

/**
 * What the stall is selling. Memoised on the season for the same reason
 * `NO_INVENTORY` exists: zustand compares by identity, and a fresh array on
 * every read is a re-render on every read.
 */
let stockCache: { season: string; stall: StallId; stock: ShopEntry[] } | null = null;

/**
 * Which stall the local player is at, for the panel's heading. The market when
 * they are at neither, which is only ever read while no panel is open.
 */
export function stallFor(store: FarmStoreState): StallId {
  const player = localPlayer(store);
  return (player && stallAt(player)) ?? 'market';
}

export function stockFor(store: FarmStoreState): ShopEntry[] {
  const season = store.farm.season;
  const stall = stallFor(store);
  if (stockCache?.season !== season || stockCache.stall !== stall) {
    const stock = shopStock(season, stall);
    stockCache = { season, stall, stock: stock.length > 0 ? stock : NO_STOCK };
  }
  return stockCache.stock;
}

/** Other players on the farm, for rendering remote avatars. */
export function remotePlayers(farm: FarmState, localPlayerId: PlayerId | null): PlayerState[] {
  return Object.values(farm.players).filter((player) => player.id !== localPlayerId);
}

// --- crafting, chests and machines -------------------------------------------

/**
 * A recipe as the crafting tab needs to draw it.
 *
 * Everything the row shows, worked out once: whether it can be made right now,
 * what is short if not, and the ingredient list with both numbers so a cell
 * can be greyed rather than merely absent. "You need wood" is a worse sentence
 * than "wood 34/50".
 */
export interface RecipeRow {
  recipe: Recipe;
  label: string;
  blurb: string;
  ingredients: Ingredient[];
  /** True when the satchel covers it and there is somewhere to put the result. */
  canMake: boolean;
  /** Empty when nothing is short. */
  shortfall: string;
}

const NO_ROWS: RecipeRow[] = [];

/**
 * Memoised on the pair the answer depends on, for the reason every other cache
 * in this file exists: zustand compares selector results by identity, and a
 * fresh array on every read is a render loop.
 */
let recipeCache: { inventory: Inventory; known: ItemId[]; rows: RecipeRow[] } | null = null;

/**
 * Every recipe this player knows, in catalogue order.
 *
 * Only the ones they know. A tab that listed the twenty they cannot make yet,
 * greyed, would read as a checklist of things the game is withholding; a tab
 * that grows as they play reads as the farm getting better at things. What is
 * greyed is the row they know and cannot currently afford, which is a
 * shopping list rather than a tease.
 */
export function knownRecipeRows(player: PlayerState | null): RecipeRow[] {
  if (!player) return NO_ROWS;
  if (recipeCache?.inventory === player.inventory && recipeCache.known === player.knownRecipes) {
    return recipeCache.rows;
  }

  const rows: RecipeRow[] = [];
  for (const recipe of ALL_RECIPES) {
    if (!player.knownRecipes.includes(recipe.id)) continue;
    const ingredients = ingredientsFor(recipe, player.inventory);
    const shortfall = describeShortfall(recipe, player.inventory);
    rows.push({
      recipe,
      label: ITEMS[recipe.id].label,
      blurb: ITEMS[recipe.id].blurb,
      ingredients,
      canMake: shortfall === '',
      shortfall,
    });
  }

  const result = rows.length > 0 ? rows : NO_ROWS;
  recipeCache = { inventory: player.inventory, known: player.knownRecipes, rows: result };
  return result;
}

/** How many of this player's known recipes they could make right now. */
export function readyRecipeCount(player: PlayerState | null): number {
  return knownRecipeRows(player).filter((row) => row.canMake).length;
}

/** The chest this client has open, if the panel is up and it still exists. */
export function openChest(store: FarmStoreState): Chest | null {
  const player = localPlayer(store);
  if (!player || player.panel !== 'chest' || !player.openChest) return null;
  const found = placeableById(store.farm.placeables, player.openChest);
  return found && isChest(found) ? found : null;
}

/** Every machine on this player's map that has something waiting in it. */
export function readyMachines(farm: FarmState, player: PlayerState | null): Machine[] {
  if (!player) return NO_MACHINES;
  const ready = farm.placeables.filter(
    (placeable): placeable is Machine =>
      placeable.area === player.area && isMachine(placeable) && machineIsReady(placeable, farm.time.day),
  );
  return ready.length > 0 ? ready : NO_MACHINES;
}

const NO_MACHINES: Machine[] = [];

/** A sentence for the prompt bar when the player is stood at a machine. */
export function machineSummary(machine: Machine, day: number): string {
  return describeMachine(machine, day);
}
