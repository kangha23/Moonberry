import { createStore } from 'zustand/vanilla';
import type { ClientCommand, ClockMessage, MoveUpdate } from '../net/protocol';
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
  /** True while an authoritative server, not this browser, owns the farm. */
  online: boolean;
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
  online: false,
}));

/**
 * How far, in pixels, the server's idea of where the local player stands may
 * drift from the predicted position before the server wins. Small corrections
 * are ignored so ordinary latency does not make walking stutter.
 */
const RECONCILE_THRESHOLD = 24;

/** Set while connected to a server; null when playing against the local reducer. */
let transport: ((command: ClientCommand) => void) | null = null;

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

// --- networking -------------------------------------------------------------

/**
 * Points the store at a server. Once set, commands travel to the server and
 * the authoritative farm comes back; the local reducer is used only to predict
 * the local player's movement so walking stays responsive under latency.
 */
export function setTransport(send: ((command: ClientCommand) => void) | null): void {
  transport = send;
  farmStore.setState({ online: send !== null });
}

/**
 * Sends a movement input.
 *
 * Only a direction crosses the wire, never a timestep: the server advances
 * movement on its own clock, so a modified client cannot walk faster by
 * claiming a larger delta. `deltaMs` here is used purely for local prediction.
 */
export function sendMove(dx: number, dy: number, deltaMs: number): void {
  const { localPlayerId } = farmStore.getState();
  if (!localPlayerId) return;

  if (transport) {
    // The server keeps applying the last input it was given, so a packet is
    // only needed when the direction actually changes, including on stop.
    if (dx !== lastSentDx || dy !== lastSentDy) {
      lastSentDx = dx;
      lastSentDy = dy;
      transport({ type: 'move', dx, dy });
    }
  }

  if (dx === 0 && dy === 0) return;
  dispatch({ type: 'player/move', playerId: localPlayerId, dx, dy, deltaMs });
}

let lastSentDx = 0;
let lastSentDy = 0;

/** Sends a non-movement command: equip a tool, change seed, or use the tool. */
export function sendAction(command: Exclude<ClientCommand, { type: 'move' }>): void {
  const { localPlayerId } = farmStore.getState();
  if (!localPlayerId) return;

  if (transport) {
    // Actions change shared state, so they are never predicted: showing a
    // harvest that the server then refuses is worse than a moment's wait.
    transport(command);
    return;
  }

  switch (command.type) {
    case 'selectTool':
      dispatch({ type: 'player/selectTool', playerId: localPlayerId, tool: command.tool });
      return;
    case 'cycleSeed':
      dispatch({ type: 'player/cycleSeed', playerId: localPlayerId });
      return;
    case 'act':
      dispatch({ type: 'player/act', playerId: localPlayerId });
  }
}

/** The server has seated this connection and handed over the current farm. */
export function applyServerWelcome(playerId: PlayerId, farm: FarmState): void {
  farmStore.setState({ farm, localPlayerId: playerId, message: INITIAL_MESSAGE, restored: false });
  publish([{ kind: 'farmReplaced' }]);
}

/** A full authoritative farm: adopt it wholesale. */
export function applyServerSync(farm: FarmState): void {
  farmStore.setState({ farm });
  publish([{ kind: 'farmReplaced' }]);
}

export function applyServerClock(clock: ClockMessage): void {
  const { farm } = farmStore.getState();
  farmStore.setState({
    farm: { ...farm, time: clock.time, season: clock.season, weather: clock.weather },
  });
}

/**
 * Positions from the server.
 *
 * Remote players are placed exactly where the server says. The local player is
 * left on its predicted position unless it has drifted too far, which keeps
 * walking smooth while still letting the server have the final word.
 */
export function applyServerMoves(moves: MoveUpdate[]): void {
  const { farm, localPlayerId } = farmStore.getState();
  let players = farm.players;
  let changed = false;

  for (const move of moves) {
    const player = players[move.id];
    if (!player) continue;

    if (move.id === localPlayerId) {
      const drift = Math.hypot(player.x - move.x, player.y - move.y);
      if (drift < RECONCILE_THRESHOLD) continue;
    }

    if (player.x === move.x && player.y === move.y && player.facing === move.facing) continue;

    if (!changed) {
      players = { ...players };
      changed = true;
    }
    players[move.id] = { ...player, x: move.x, y: move.y, facing: move.facing };
  }

  if (changed) farmStore.setState({ farm: { ...farm, players } });
}

/** Events the server produced, including messages meant for this player. */
export function applyServerEvents(events: GameEvent[]): void {
  const { localPlayerId } = farmStore.getState();
  const latest = events
    .filter((event) => event.kind === 'message' && event.playerId === localPlayerId)
    .at(-1);
  if (latest && latest.kind === 'message') farmStore.setState({ message: latest.text });
  publish(events);
}
