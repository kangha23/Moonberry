import { createStore } from 'zustand/vanilla';
import type { GameEvent, Intent } from './intents';
import { clearSave, loadFarm, saveFarm, type SaveStorage } from './persistence';
import { applyIntent, createFarmState } from './reducer';
import type { FarmState, PlayerId } from './types';

export interface FarmStoreState {
  farm: FarmState;
  /** Which player this client controls. Null until the local player joins. */
  localPlayerId: PlayerId | null;
  /** Latest message addressed to the local player, shown in the HUD. */
  message: string;
  /** True when the farm on screen was restored from a save. */
  restored: boolean;
}

const INITIAL_MESSAGE = 'Wake up on Amberfall Farm.';
const RESTORED_MESSAGE = 'Welcome back to Amberfall Farm.';

/** How long the farm must sit unchanged before it is written to storage. */
const AUTOSAVE_DEBOUNCE_MS = 1000;

type EventListener = (events: GameEvent[]) => void;

const listeners = new Set<EventListener>();

export const farmStore = createStore<FarmStoreState>(() => ({
  farm: createFarmState(),
  localPlayerId: null,
  message: INITIAL_MESSAGE,
  restored: false,
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

/**
 * Starts a session: restores the saved farm if there is a usable one,
 * otherwise begins a fresh farm. A corrupt or outdated save is discarded
 * rather than repaired.
 */
export function initFarm(storage?: SaveStorage): void {
  listeners.clear();
  const restored = loadFarm(storage);
  farmStore.setState({
    farm: restored ?? createFarmState(),
    localPlayerId: null,
    message: restored ? RESTORED_MESSAGE : INITIAL_MESSAGE,
    restored: restored !== null,
  });
}

/** Discards the save and starts a brand new farm. */
export function startNewFarm(storage?: SaveStorage): void {
  clearSave(storage);
  const { localPlayerId } = farmStore.getState();
  farmStore.setState({
    farm: createFarmState(),
    localPlayerId: null,
    message: INITIAL_MESSAGE,
    restored: false,
  });
  if (localPlayerId) joinAsLocalPlayer(localPlayerId, 'You');
  publish([{ kind: 'farmReplaced' }]);
}

/**
 * Writes the farm to storage whenever it settles.
 *
 * Keyed on `revision`, which only moves when an intent actually changed
 * something, so the sub-second clock accumulator does not trigger writes.
 */
export function startAutosave(storage?: SaveStorage): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSaved = farmStore.getState().farm.revision;

  const flush = () => {
    timer = null;
    const { farm } = farmStore.getState();
    if (farm.revision === lastSaved) return;
    lastSaved = farm.revision;
    saveFarm(farm, storage);
  };

  const unsubscribe = farmStore.subscribe(() => {
    if (farmStore.getState().farm.revision === lastSaved) return;
    if (timer) return;
    timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  });

  // A closing tab never reaches the debounce, so write the pending farm now.
  const onHide = () => {
    if (timer) clearTimeout(timer);
    flush();
  };
  globalThis.addEventListener?.('pagehide', onHide);

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
    globalThis.removeEventListener?.('pagehide', onHide);
  };
}
