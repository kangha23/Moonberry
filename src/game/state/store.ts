import { createStore } from 'zustand/vanilla';
import type { ClientCommand, ClockMessage, MoveUpdate } from '../net/protocol';
import type { BuildingKind } from '../systems/buildings';
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
  /** The world's invite code while online, so it can be shared. */
  inviteCode: string | null;
  /** Set when the server refused the connection, with something to show. */
  connectionError: string | null;
  /**
   * Whether the full inventory grid is open over the canvas.
   *
   * Kept here rather than in React state because the scene has to know: while
   * it is open the game takes no keyboard input, so the key that drags a stack
   * does not also swing a hoe.
   */
  inventoryOpen: boolean;
  /**
   * The building this client is looking for a spot for, or null.
   *
   * Purely local, and deliberately so: choosing what to build is not something
   * that has happened on the farm, it is a mode this one player's mouse is in.
   * Nothing is spent and nothing is shared until a spot is clicked, and the
   * spot is then re-checked by the reducer. The scene has to know, because
   * while it is set a click places a building rather than swinging a hoe.
   */
  buildKind: BuildingKind | null;
  /**
   * True once the Phaser scene has finished starting up.
   *
   * A readiness flag, not game information: the shell uses it to stop
   * announcing a farm nobody can play yet, and the end-to-end tests use it
   * instead of watching a clock that no longer exists in the DOM.
   */
  sceneReady: boolean;
  /**
   * Whether the Escape menu is open over the canvas.
   *
   * The one part of the interface that is allowed to be a document rather than
   * a picture of the world, because it is about the program: the volume, the
   * invite code, full screen, starting over. Everything the page used to keep
   * in a column beside the game lives here now, and the game got the screen.
   */
  menuOpen: boolean;
  /**
   * Whether the morning summary is up in the canvas.
   *
   * Here for the same reason `inventoryOpen` is: something outside the scene
   * has to know. Escape must not open the menu over a panel that is already
   * open, and the scene is the only thing that can see this one.
   */
  summaryOpen: boolean;
}

const INITIAL_MESSAGE = 'Thức dậy ở Nông trại Amberfall.';
const RESTORED_MESSAGE = 'Chào mừng trở lại Nông trại Amberfall.';

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
  inviteCode: null,
  connectionError: null,
  inventoryOpen: false,
  buildKind: null,
  sceneReady: false,
  menuOpen: false,
  summaryOpen: false,
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
  if (localPlayerId) joinAsLocalPlayer(localPlayerId, 'Bạn');
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
  if (send === null) farmStore.setState({ inviteCode: null });
}

/** The world this client is in, learned from the server on connect. */
export function setInviteCode(code: string | null): void {
  farmStore.setState({ inviteCode: code });
}

/** Why the server would not take this connection, for the player to read. */
export function setConnectionError(message: string | null): void {
  farmStore.setState({ connectionError: message });
}

/** The scene has built its world and is listening for input. */
export function setSceneReady(): void {
  farmStore.setState({ sceneReady: true });
}

// --- the inventory screen ---------------------------------------------------

export function setInventoryOpen(open: boolean): void {
  farmStore.setState({ inventoryOpen: open });
}

export function toggleInventory(): void {
  farmStore.setState((state) => ({ inventoryOpen: !state.inventoryOpen }));
}

// --- the menu, and the one key that closes everything ------------------------

export function setMenuOpen(open: boolean): void {
  farmStore.setState({ menuOpen: open });
}

export function setSummaryOpen(open: boolean): void {
  if (farmStore.getState().summaryOpen === open) return;
  farmStore.setState({ summaryOpen: open });
}

/** What an Escape press did, so a caller can play the right sound — or none. */
export type EscapeResult = 'cancelledBuild' | 'closedPanel' | 'cancelledCast' | 'openedMenu';

/**
 * Escape, and the order it has to be read in.
 *
 * Escape now means three things, and the order between them is the whole
 * design. A player with a barn on the cursor and the satchel shut presses
 * Escape to put the barn down, not to open a settings menu; a player with
 * neither presses it expecting a menu, because that is what Escape has meant
 * in every game since the nineties.
 *
 *   1. Placing a building -> cancel the placement.
 *   2. A panel is open -> close the panel.
 *   3. A line is in the water -> wind it in.
 *   4. Nothing is open -> open the menu.
 *
 * In one function rather than in four keydown handlers. It used to be spread
 * across the scene, the satchel, the stall and the forge, each of them
 * claiming the key while it happened to be on screen, and adding a fourth
 * claimant to that arrangement is how a ladder ends up with its rungs in a
 * different order depending on what is open.
 */
export function pressEscape(): EscapeResult {
  const state = farmStore.getState();

  if (state.buildKind) {
    setBuildKind(null);
    return 'cancelledBuild';
  }

  if (state.menuOpen) {
    setMenuOpen(false);
    return 'closedPanel';
  }

  // The morning panel is dismissed by any key at all, which the scene reads
  // for itself. All that is decided here is that Escape did not mean "menu".
  if (state.summaryOpen) return 'closedPanel';

  if (state.inventoryOpen) {
    setInventoryOpen(false);
    return 'closedPanel';
  }

  const player = state.localPlayerId ? state.farm.players[state.localPlayerId] : null;
  if (player?.panel) {
    // Leaving a counter is something that happened on the farm rather than in
    // this browser, so it goes through the reducer like every other action.
    sendAction({ type: 'closePanel' });
    return 'closedPanel';
  }

  // A cast is the fourth rung, and it sits below the panels on purpose: a
  // player fishing with the satchel open pressed Escape to shut the satchel.
  // It sits above the menu for the same reason the building does — somebody
  // with a line in the water who presses Escape wants out of the minigame,
  // not a settings screen over the top of it.
  if (player?.fishing) {
    sendAction({ type: 'cancelCast' });
    return 'cancelledCast';
  }

  setMenuOpen(true);
  return 'openedMenu';
}

// --- build mode -------------------------------------------------------------

/**
 * Arms, or disarms, placing a building.
 *
 * Local to this client: it changes what a click means and nothing else. No
 * coins move until a spot is chosen, and the spot is then re-checked by the
 * reducer — which is the only place that decides.
 */
export function setBuildKind(kind: BuildingKind | null): void {
  farmStore.setState({ buildKind: kind });
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

/** Sends a non-movement command: hold a slot, rearrange the grid, or act. */
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
    case 'selectSlot':
      dispatch({ type: 'player/selectSlot', playerId: localPlayerId, slot: command.slot });
      return;
    case 'moveStack':
      dispatch({ type: 'player/moveStack', playerId: localPlayerId, from: command.from, to: command.to });
      return;
    case 'splitStack':
      dispatch({ type: 'player/splitStack', playerId: localPlayerId, from: command.from, to: command.to });
      return;
    case 'act':
      dispatch({ type: 'player/act', playerId: localPlayerId, target: command.target });
      return;
    case 'sleep':
      dispatch({ type: 'player/sleep', playerId: localPlayerId });
      return;
    case 'buy':
      dispatch({ type: 'shop/buy', playerId: localPlayerId, item: command.item, count: command.count });
      return;
    case 'closePanel':
      dispatch({ type: 'panel/close', playerId: localPlayerId });
      return;
    case 'upgradeTool':
      dispatch({ type: 'player/upgradeTool', playerId: localPlayerId, item: command.item });
      return;
    case 'collectTool':
      dispatch({ type: 'player/collectTool', playerId: localPlayerId });
      return;
    case 'placeBuilding':
      dispatch({
        type: 'player/placeBuilding',
        playerId: localPlayerId,
        kind: command.kind,
        x: command.x,
        y: command.y,
      });
      return;
    case 'buyAnimal':
      dispatch({
        type: 'player/buyAnimal',
        playerId: localPlayerId,
        kind: command.kind,
        home: command.home,
        name: command.name,
      });
      return;
    case 'sellAnimal':
      dispatch({ type: 'player/sellAnimal', playerId: localPlayerId, animalId: command.animalId });
      return;
    case 'buyHay':
      dispatch({ type: 'player/buyHay', playerId: localPlayerId, count: command.count });
      return;
    case 'petAnimal':
      dispatch({ type: 'player/petAnimal', playerId: localPlayerId, animalId: command.animalId });
      return;
    case 'collectProduce':
      dispatch({ type: 'player/collectProduce', playerId: localPlayerId, animalId: command.animalId });
      return;
    case 'feedAnimal':
      dispatch({ type: 'player/feedAnimal', playerId: localPlayerId, animalId: command.animalId });
      return;
    case 'toggleDoor':
      dispatch({ type: 'animals/toggleDoor', playerId: localPlayerId, buildingId: command.buildingId });
      return;
    case 'craft':
      dispatch({
        type: 'player/craft',
        playerId: localPlayerId,
        recipe: command.recipe,
        count: command.count,
      });
      return;
    case 'placeItem':
      dispatch({
        type: 'player/placeItem',
        playerId: localPlayerId,
        item: command.item,
        x: command.x,
        y: command.y,
      });
      return;
    case 'pickUpItem':
      dispatch({ type: 'player/pickUpItem', playerId: localPlayerId, x: command.x, y: command.y });
      return;
    case 'chestMoveStack':
      dispatch({
        type: 'chest/moveStack',
        playerId: localPlayerId,
        chestId: command.chestId,
        from: command.from,
        to: command.to,
      });
      return;
    case 'chestStow':
      dispatch({ type: 'chest/stow', playerId: localPlayerId, chestId: command.chestId });
      return;
    case 'loadMachine':
      dispatch({ type: 'machine/load', playerId: localPlayerId, machineId: command.machineId });
      return;
    case 'collectMachine':
      dispatch({ type: 'machine/collect', playerId: localPlayerId, machineId: command.machineId });
      return;
    case 'cast':
      dispatch({ type: 'player/cast', playerId: localPlayerId, target: command.target });
      return;
    case 'reel':
      dispatch({ type: 'player/reel', playerId: localPlayerId, down: command.down });
      return;
    case 'cancelCast':
      dispatch({ type: 'player/cancelCast', playerId: localPlayerId });
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
