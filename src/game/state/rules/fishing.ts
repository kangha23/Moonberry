/**
 * The cast, the bite and the reel, as rules over the farm state.
 *
 * The minigame itself lives in `systems/fishing.ts`; this module is what
 * checks the rod, the water, the reach and the energy, and what advances every
 * line in the water on the frame rather than the clock step.
 */
import { addItem, countItem, removeItem, slotAt } from '../../systems/inventory';
import { ITEMS, barWidthOf, fishDef } from '../../systems/items';
import {
  BAIT_ITEM,
  CAST_ENERGY,
  acceptsReel,
  describeCatch,
  hookFish,
  startCast,
  stepFishing,
  type FishDraw,
} from '../../systems/fishing';
import { isWithinReach, tileAt, worldToTile, type Point } from '../../world/areas';
import type { ApplyResult, GameEvent } from '../intents';
import type { FarmState, PlayerId, PlayerState } from '../types';
import { facingFor, unchanged, say, withPlayer } from './common';

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
export function applyCast(state: FarmState, playerId: PlayerId, target: Point): ApplyResult {
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
export function applyReel(state: FarmState, playerId: PlayerId, down: boolean): ApplyResult {
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
export function applyCancelCast(state: FarmState, playerId: PlayerId): ApplyResult {
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
export function advanceFishing(state: FarmState, deltaMs: number): ApplyResult {
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
