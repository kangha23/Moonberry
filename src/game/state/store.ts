import { createStore } from 'zustand/vanilla';
import type { GameEvent, Intent } from './intents';
import { applyIntent, createFarmState } from './reducer';
import type { FarmState, PlayerId } from './types';

export interface FarmStoreState {
  farm: FarmState;
  /** Which player this client controls. Null until the local player joins. */
  localPlayerId: PlayerId | null;
  /** Latest message addressed to the local player, shown in the HUD. */
  message: string;
}

const INITIAL_MESSAGE = 'Wake up on Amberfall Farm.';

type EventListener = (events: GameEvent[]) => void;

const listeners = new Set<EventListener>();

export const farmStore = createStore<FarmStoreState>(() => ({
  farm: createFarmState(),
  localPlayerId: null,
  message: INITIAL_MESSAGE,
}));

/**
 * Subscribes to game events. Today every event originates from a local
 * `dispatch`; once the server exists, events pushed down the socket are fed
 * through `publish` and reach the same listeners unchanged.
 */
export function onGameEvent(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(events: GameEvent[]): void {
  if (events.length === 0) return;
  for (const listener of listeners) listener(events);
}

/**
 * Applies an intent locally.
 *
 * This is the single seam that multiplayer replaces: instead of reducing
 * locally, it will send the intent to the server and apply the authoritative
 * state that comes back. Nothing outside this module needs to change.
 */
export function dispatch(intent: Intent): GameEvent[] {
  const { farm, localPlayerId } = farmStore.getState();
  const result = applyIntent(farm, intent);

  if (result.state !== farm) farmStore.setState({ farm: result.state });

  const mine = result.events.filter(
    (event) => event.kind === 'message' && event.playerId === localPlayerId,
  );
  const latest = mine.at(-1);
  if (latest && latest.kind === 'message') farmStore.setState({ message: latest.text });

  publish(result.events);
  return result.events;
}

/** Seats the local player and remembers which player this client drives. */
export function joinAsLocalPlayer(playerId: PlayerId, name: string): void {
  farmStore.setState({ localPlayerId: playerId });
  dispatch({ type: 'player/join', playerId, name });
}

/** Resets the farm. Used when the Phaser scene is torn down and remounted. */
export function resetFarm(): void {
  listeners.clear();
  farmStore.setState({ farm: createFarmState(), localPlayerId: null, message: INITIAL_MESSAGE });
}
