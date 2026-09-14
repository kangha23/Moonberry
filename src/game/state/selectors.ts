import { CROP_DEFINITIONS } from '../systems/farming';
import { countCrops } from '../systems/satchel';
import { LANDMARKS, isNear } from '../world/layout';
import type { FarmStoreState } from './store';
import { TOOL_LABELS, type FarmState, type PlayerId, type PlayerState } from './types';

export const CONTROLS_HINT = 'Move WASD/Arrows • Tools 1-5 • Seed Q • Space/Enter to act';

export function localPlayer(store: FarmStoreState): PlayerState | null {
  const { farm, localPlayerId } = store;
  return localPlayerId ? (farm.players[localPlayerId] ?? null) : null;
}

function rowanHint(farm: FarmState, player: PlayerState): string | null {
  if (!isNear(player, LANDMARKS.rowan)) return null;
  const { quest } = farm;
  if (quest.rewarded) return 'Rowan: The village market is watching Amberfall now.';
  if (quest.completed) return 'Rowan: Those turnips look perfect. Press Space to collect your reward.';
  const remaining = quest.target - quest.progress;
  return `Rowan: Bring me ${remaining} more turnip${remaining === 1 ? '' : 's'} and I will pay well.`;
}

function marketHint(player: PlayerState): string | null {
  if (!isNear(player, LANDMARKS.market)) return null;
  const basket = countCrops(player.satchel);
  if (basket <= 0) return 'Market stall: harvest crops, then press Space/Enter here to sell your basket.';
  return `Market stall: press Space/Enter to sell ${basket} crop${basket === 1 ? '' : 's'} for coins.`;
}

/**
 * What the player should be told right now: a proximity hint if they are
 * standing next to something interactive, otherwise the last action message.
 */
export function promptFor(store: FarmStoreState): string {
  const player = localPlayer(store);
  if (!player) return store.message;
  return rowanHint(store.farm, player) ?? marketHint(player) ?? store.message;
}

export function formatClock(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = (totalMinutes % 60).toString().padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${minutes} ${suffix}`;
}

export function toolLabel(player: PlayerState | null): string {
  return player ? TOOL_LABELS[player.tool] : '—';
}

export function seedLabel(player: PlayerState | null): string {
  return player ? CROP_DEFINITIONS[player.seed].label : '—';
}

/** Other players on the farm, for rendering remote avatars. */
export function remotePlayers(farm: FarmState, localPlayerId: PlayerId | null): PlayerState[] {
  return Object.values(farm.players).filter((player) => player.id !== localPlayerId);
}
