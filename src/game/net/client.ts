import {
  applyServerClock,
  applyServerEvents,
  applyServerMoves,
  applyServerSync,
  applyServerWelcome,
  setTransport,
} from '../state/store';
import type { FarmState } from '../state/types';
import {
  MSG,
  decodeFrame,
  encodeFrame,
  type ClientCommand,
  type ClockMessage,
  type EventsMessage,
  type MoveUpdate,
  type WelcomeMessage,
} from './protocol';

export interface FarmConnection {
  /** Closes the socket and returns the store to local play. */
  disconnect(): void;
}

/** How long to wait for the socket to open before giving up. */
const CONNECT_TIMEOUT_MS = 4000;

/** Close code the server uses when a farm already has its four players. */
const FARM_FULL = 4001;

/**
 * Connects to the authoritative server and wires it to the store.
 *
 * Returns null when no server is configured or it cannot be reached, in which
 * case the caller keeps playing against the local reducer. The game is meant
 * to run online, but refusing to start at all when the server is down is a
 * worse outcome than a clearly-labelled offline farm.
 */
export async function connectToFarm(url: string | undefined): Promise<FarmConnection | null> {
  if (!url) return null;

  const socket = await open(url);
  if (!socket) return null;

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    const frame = decodeFrame(event.data);
    if (frame) route(frame);
  });

  socket.addEventListener('close', (event) => {
    setTransport(null);
    if (event.code === FARM_FULL) {
      console.warn('[net] this farm already has four players; playing offline instead.');
    }
  });

  setTransport((command: ClientCommand) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encodeFrame({ t: MSG.command, d: command }));
    }
  });

  return {
    disconnect() {
      setTransport(null);
      socket.close();
    },
  };
}

/** Opens a socket, resolving null rather than throwing on any failure. */
function open(url: string): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      console.warn('[net] could not reach the farm server, playing offline:', error);
      resolve(null);
      return;
    }

    const timer = setTimeout(() => {
      socket.close();
      console.warn('[net] farm server did not answer in time, playing offline.');
      resolve(null);
    }, CONNECT_TIMEOUT_MS);

    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve(socket);
      },
      { once: true },
    );

    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        console.warn('[net] could not reach the farm server, playing offline.');
        resolve(null);
      },
      { once: true },
    );
  });
}

function route(frame: { t: string; d: unknown }): void {
  switch (frame.t) {
    case MSG.welcome: {
      const message = frame.d as WelcomeMessage;
      applyServerWelcome(message.playerId, message.farm);
      return;
    }
    case MSG.sync:
      applyServerSync(frame.d as FarmState);
      return;
    case MSG.moves:
      applyServerMoves(frame.d as MoveUpdate[]);
      return;
    case MSG.clock:
      applyServerClock(frame.d as ClockMessage);
      return;
    case MSG.events:
      applyServerEvents((frame.d as EventsMessage).events);
  }
}
