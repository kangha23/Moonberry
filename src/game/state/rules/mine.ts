/**
 * The mine: going down it, fighting in it, fainting in it, and which floors
 * have monsters awake on them.
 *
 * Spec 13. Everything here is a function of the state and the seed on it:
 * floors are rebuilt with `floorFor`, loot with `rollLoot`, and nothing draws
 * a random number. Monsters walk straight at the nearest player — no path
 * finding, which the spec rules out and the two-wide tunnels make unneeded.
 */
import { addItem, countItem, removeItem, slotAt } from '../../systems/inventory';
import { ITEMS, type ItemId } from '../../systems/items';
import { createNode, oreRequires } from '../../systems/resources';
import {
  ELEVATOR_EVERY,
  FAINT_ORE_LOSS_SHARE,
  INVULNERABLE_MINUTES,
  MAX_DEPTH,
  MINED_ITEMS,
  MONSTER_ATTACK,
  MONSTER_ATTACK_COOLDOWN,
  MONSTER_REACH_PX,
  MONSTER_SIGHT_TILES,
  MONSTER_STEP_PX,
  SWORD_FAN_COS,
  SWORD_REACH_PX,
  floorFor,
  rollLoot,
  strikeDamage,
  type Monster,
} from '../../systems/mine';
import {
  TILE_SIZE,
  interactableAt,
  mineArea,
  mineDepth,
  mineMouth,
  resolveMove,
  worldToTile,
  type AreaId,
  type Blockers,
  type Direction,
  type Point,
} from '../../world/areas';
import type { ApplyResult, GameEvent } from '../intents';
import type { FarmState, PlayerId, PlayerState } from '../types';
import { blockersFor, onlineMembers, say, surfaceSpot, unchanged, withPlayer } from './common';
import { collapseCoinLoss } from './day';

/** What a map prop at the mouth of the mine says it is. Placed in Tiled by the client slice. */
export const MINE_ENTRANCE_INTERACT = 'mine';

function tileCentre(tile: Point): Point {
  return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
}

function playerIndex(state: FarmState, playerId: PlayerId): number {
  return Object.keys(state.players).indexOf(playerId);
}

/** Standing somewhere a clock step later, not mid-cast, not at a counter. */
function leaveWhereYouAre(player: PlayerState): PlayerState {
  return { ...player, panel: null, openChest: null, fishing: null };
}

/**
 * Puts one player at the top of a floor. Only them: in a shared world the
 * ladder is not a party decision, and the group splitting up is acceptable.
 */
function arrive(state: FarmState, playerId: PlayerId, depth: number): ApplyResult {
  const player = state.players[playerId];
  const floor = floorFor(state.mineSeed, depth);
  const area = mineArea(depth);
  const moved: PlayerState = { ...leaveWhereYouAre(player), area, ...tileCentre(floor.entrance) };
  const events: GameEvent[] = [
    { kind: 'areaChanged', playerId, area },
    { kind: 'descended', playerId, depth },
    say(playerId, `Tầng ${depth}.`),
  ];
  let next = withPlayer(state, moved);
  if (depth > state.deepestFloor) {
    next = { ...next, deepestFloor: depth };
    events.push({ kind: 'newDepthRecord', depth });
  }
  return { state: next, events };
}

export function applyDescend(state: FarmState, playerId: PlayerId): ApplyResult {
  const player = state.players[playerId];
  if (!player || player.asleep || player.fishing) return unchanged(state);

  const depth = mineDepth(player.area);
  if (depth === null) {
    if (interactableAt(player.area, player)?.interact !== MINE_ENTRANCE_INTERACT) {
      return { state, events: [say(playerId, 'Ở đây không có lối nào đi xuống.')] };
    }
    return arrive(state, playerId, 1);
  }

  const ladder = floorFor(state.mineSeed, depth).ladder;
  const onLadder =
    ladder !== null && worldToTile(player.x) === ladder.x && worldToTile(player.y) === ladder.y;
  if (!onLadder) return { state, events: [say(playerId, 'Phải đứng trên thang mới xuống được.')] };
  if (depth >= MAX_DEPTH) return { state, events: [say(playerId, 'Đây đã là đáy mỏ.')] };
  return arrive(state, playerId, depth + 1);
}

export function applyUseElevator(state: FarmState, playerId: PlayerId, depth: number): ApplyResult {
  const player = state.players[playerId];
  if (!player || player.asleep || player.fishing) return unchanged(state);
  if (!Number.isInteger(depth) || depth < ELEVATOR_EVERY || depth > MAX_DEPTH || depth % ELEVATOR_EVERY !== 0) {
    return unchanged(state);
  }
  // The rule the elevator exists to keep: it remembers floors, it does not open them.
  if (depth > state.deepestFloor) {
    return { state, events: [say(playerId, `Chưa ai xuống tới tầng ${depth}.`)] };
  }

  const here = mineDepth(player.area);
  const atElevator =
    here === null
      ? interactableAt(player.area, player)?.interact === MINE_ENTRANCE_INTERACT
      : floorFor(state.mineSeed, here).hasElevator;
  if (!atElevator) return { state, events: [say(playerId, 'Ở đây không có thang máy.')] };
  if (here === depth) return unchanged(state);
  return arrive(state, playerId, depth);
}

export function applyExitMine(state: FarmState, playerId: PlayerId): ApplyResult {
  const player = state.players[playerId];
  if (!player || player.asleep || mineDepth(player.area) === null) return unchanged(state);
  // Out the way you came in. The farm is where fainting and the morning take
  // you; climbing the ladder takes you to the top of the ladder.
  const spot = mineMouth() ?? surfaceSpot(playerIndex(state, playerId));
  return {
    state: withPlayer(state, { ...leaveWhereYouAre(player), ...spot }),
    events: [
      { kind: 'areaChanged', playerId, area: spot.area },
      say(playerId, 'Bạn leo lên khỏi mỏ, chớp mắt vì ánh sáng.'),
    ],
  };
}

const FACING_VECTORS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** True when the player's hand holds something that fights. */
export function holdsSword(player: PlayerState): boolean {
  const held = slotAt(player.inventory, player.selectedSlot);
  return Boolean(held && ITEMS[held.item]?.tool === 'sword');
}

/**
 * A sword swing: every monster in a fan in front of the player, within reach.
 *
 * Costs no energy — the scythe's reasoning, and spec 13's. A monster that was
 * hit this clock step cannot be hit again until the next, which is what stops
 * a client that sends `attack` every frame from out-damaging one that does not.
 */
export function applyAttack(state: FarmState, playerId: PlayerId, target?: Point): ApplyResult {
  const player = state.players[playerId];
  if (!player || !holdsSword(player)) return unchanged(state);
  if (player.asleep || player.fishing || player.health <= 0) return unchanged(state);
  const depth = mineDepth(player.area);
  if (depth === null) return unchanged(state);

  const weapon = ITEMS[slotAt(player.inventory, player.selectedSlot)!.item];
  let aim = FACING_VECTORS[player.facing];
  if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    const centre = tileCentre(target);
    const length = Math.hypot(centre.x - player.x, centre.y - player.y);
    if (length > 0) aim = { x: (centre.x - player.x) / length, y: (centre.y - player.y) / length };
  }

  const now = state.time.totalMinutes;
  let inventory = player.inventory;
  let coins = state.coins;
  let struck = false;
  const events: GameEvent[] = [];
  const monsters: Monster[] = [];

  for (const monster of state.monsters) {
    const dx = monster.x - player.x;
    const dy = monster.y - player.y;
    const distance = Math.hypot(dx, dy);
    const inFan =
      monster.area === player.area &&
      distance <= SWORD_REACH_PX &&
      (distance === 0 || (dx * aim.x + dy * aim.y) / distance >= SWORD_FAN_COS);
    if (!inFan || now < monster.invulnerableUntil) {
      monsters.push(monster);
      continue;
    }

    struck = true;
    const health = monster.health - strikeDamage(weapon.damage ?? 1, 0);
    if (health > 0) {
      monsters.push({ ...monster, health, invulnerableUntil: now + 1 });
      continue;
    }

    const loot = rollLoot(state.mineSeed, monster.id, depth);
    const drops: Array<{ item: ItemId; count: number }> = [];
    for (const drop of loot.drops) {
      // A full satchel loses the ore rather than the kill: there are no items
      // on the ground to leave it as.
      const packed = addItem(inventory, drop.item, drop.count);
      if (!packed) continue;
      inventory = packed;
      drops.push(drop);
    }
    coins += loot.coins;
    events.push({ kind: 'monsterKilled', playerId, id: monster.id, monster: monster.kind, drops });
  }

  if (!struck) return unchanged(state);
  return {
    state: {
      ...withPlayer(state, { ...player, inventory }),
      coins,
      monsters,
    },
    events,
  };
}

/**
 * Health ran out.
 *
 * Home, a tenth of the wallet, and some of what was dug — and the day over
 * for this player alone. They go to bed where they stand on the farm and
 * cannot get up again; everybody else carries on, and the vote to end the
 * night counts them as asleep, which is what they are.
 */
function faint(state: FarmState, playerId: PlayerId): ApplyResult {
  const player = state.players[playerId];
  const coinsLost = collapseCoinLoss(state.coins);

  let inventory = player.inventory;
  for (const item of MINED_ITEMS) {
    const held = countItem(inventory, item);
    if (held === 0) continue;
    inventory = removeItem(inventory, item, Math.ceil(held * FAINT_ORE_LOSS_SHARE)) ?? inventory;
  }

  const spot = surfaceSpot(playerIndex(state, playerId));
  const fainted: PlayerState = {
    ...leaveWhereYouAre(player),
    ...spot,
    inventory,
    health: 0,
    asleep: true,
    invulnerableUntil: 0,
  };
  return {
    state: { ...withPlayer(state, fainted), coins: state.coins - coinsLost },
    events: [
      { kind: 'faint', playerId, coinsLost },
      { kind: 'areaChanged', playerId, area: spot.area },
      { kind: 'sleepChanged', playerId, asleep: true },
      say(playerId, 'Mọi thứ tối sầm lại. Bạn tỉnh dậy ở nhà, nhẹ ví và nhẹ túi.'),
    ],
  };
}

function canBeHunted(player: PlayerState, area: AreaId): boolean {
  return player.online && !player.asleep && player.health > 0 && player.area === area;
}

/**
 * One clock step of every awake monster: chase, then strike.
 *
 * Monsters go in list order, so two slimes in one step always resolve the
 * same way, and the second one meets the invulnerability the first one set.
 */
export function advanceMonsters(state: FarmState): ApplyResult {
  if (state.monsters.length === 0) return unchanged(state);

  const now = state.time.totalMinutes;
  const sight = MONSTER_SIGHT_TILES * TILE_SIZE;
  const blockers = new Map<AreaId, Blockers>();
  let next = state;
  const events: GameEvent[] = [];
  const monsters: Monster[] = [];

  for (const monster of state.monsters) {
    let nearest: PlayerState | null = null;
    let nearestDistance = Infinity;
    for (const player of Object.values(next.players)) {
      if (!canBeHunted(player, monster.area)) continue;
      const distance = Math.hypot(player.x - monster.x, player.y - monster.y);
      if (distance < nearestDistance) {
        nearest = player;
        nearestDistance = distance;
      }
    }
    if (!nearest || nearestDistance > sight) {
      monsters.push(monster);
      continue;
    }

    let walls = blockers.get(monster.area);
    if (!walls) {
      walls = blockersFor(state, monster.area);
      blockers.set(monster.area, walls);
    }
    // Straight at them, a step at a time, sliding along walls. Stops short
    // rather than overshooting, so a slime on top of you stays on top of you.
    const position = resolveMove(
      monster.area,
      monster,
      nearest.x - monster.x,
      nearest.y - monster.y,
      1000,
      Math.min(MONSTER_STEP_PX, nearestDistance),
      walls,
    );
    let moved: Monster = { ...monster, x: position.x, y: position.y };

    const reach = Math.hypot(nearest.x - moved.x, nearest.y - moved.y);
    if (reach <= MONSTER_REACH_PX && now >= moved.nextAttackAt) {
      moved = { ...moved, nextAttackAt: now + MONSTER_ATTACK_COOLDOWN };
      if (now >= nearest.invulnerableUntil) {
        const amount = strikeDamage(MONSTER_ATTACK[moved.kind], 0);
        const health = Math.max(0, nearest.health - amount);
        next = withPlayer(next, { ...nearest, health, invulnerableUntil: now + INVULNERABLE_MINUTES });
        events.push({ kind: 'damaged', playerId: nearest.id, amount });
        if (health === 0) {
          const fainted = faint(next, nearest.id);
          next = fainted.state;
          events.push(...fainted.events);
        }
      }
    }
    monsters.push(moved);
  }

  return { state: { ...next, monsters }, events };
}

/** The floors an online player is standing on. Offline bodies keep nothing awake. */
function occupiedFloors(state: FarmState): Set<number> {
  const floors = new Set<number>();
  for (const player of onlineMembers(state)) {
    const depth = mineDepth(player.area);
    if (depth !== null) floors.add(depth);
  }
  return floors;
}

/**
 * Wakes a floor that has just gained its first player, and forgets one that
 * has just lost its last: its monsters, and since spec 16 its veins of ore.
 *
 * Run after every intent, comparing the farm before it with the farm after,
 * which is why no "live floors" list has to be stored: the transition is the
 * list. A floor woken twice in a day is rebuilt from the same seed, so it
 * comes back exactly as it was first found — ore and all, which is why the
 * elevator only goes to floors already opened. Monsters and veins share this
 * one pass because they share one lifetime: a floor with fresh monsters and
 * yesterday's ore is a floor no seed ever made.
 */
export function reconcileFloors(before: FarmState, result: ApplyResult): ApplyResult {
  const after = result.state;
  if (after === before) return result;

  const was = occupiedFloors(before);
  const is = occupiedFloors(after);
  const woken = [...is].filter((depth) => !was.has(depth)).sort((a, b) => a - b);
  const keep = (area: string) => {
    const depth = mineDepth(area);
    return depth === null || (is.has(depth) && !woken.includes(depth));
  };
  const staleMonsters = after.monsters.some((monster) => mineDepth(monster.area) === null || !keep(monster.area));
  const staleNodes = after.nodes.some((node) => !keep(node.area));
  if (!staleMonsters && !staleNodes && woken.length === 0) return result;

  const monsters = after.monsters.filter((monster) => mineDepth(monster.area) !== null && keep(monster.area));
  const nodes = after.nodes.filter((node) => keep(node.area));
  for (const depth of woken) {
    const floor = floorFor(after.mineSeed, depth);
    for (const spawn of floor.monsters) {
      monsters.push({
        id: spawn.id,
        kind: spawn.kind,
        area: mineArea(depth),
        ...tileCentre(spawn),
        health: spawn.health,
        nextAttackAt: 0,
        invulnerableUntil: 0,
      });
    }
    floor.ores.forEach((ore, index) => {
      nodes.push(
        createNode(`mine:${depth}:ore:${index}`, 'ore', mineArea(depth), ore.x, ore.y, {
          item: ore.ore,
          requires: oreRequires(ore.ore),
        }),
      );
    });
  }
  return { state: { ...after, monsters, nodes }, events: result.events };
}
