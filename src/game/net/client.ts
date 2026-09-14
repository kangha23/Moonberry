import {
  applyServerClock,
  applyServerEvents,
  applyServerMoves,
  applyServerSync,
  applyServerWelcome,
  setConnectionError,
  setInviteCode,
  setTransport,
} from '../state/store';
import { farmSocketUrl, readInviteCode, readToken, rememberToken, showInviteCode } from './identity';
import type { FarmState } from '../state/types';
import {
  MSG,
  decodeFrame,
  encodeFrame,
  type ClientCommand,
  type ClockMessage,
  type EventsMessage,
  type IdentityMessage,
  type MoveUpdate,
  type WelcomeMessage,
} from './protocol';

export interface FarmConnection {
  /** Closes the socket and returns the store to local play. */
  disconnect(): void;
}

/** How long to wait for the socket to open before giving up. */
const CONNECT_TIMEOUT_MS = 4000;

/** Why the server hung up, and what to tell the player about it. */
const CLOSE_REASONS: Record<number, string> = {
  4001: 'That farm already has four farmhands. Playing offline instead.',
  4002: 'No farm with that code. Check the invite link, or clear it to start your own.',
};

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

  // Who we are and where we are going travel in the URL, so the server knows
  // both before the first frame and can refuse with a reason.
  const socket = await open(farmSocketUrl(url, readInviteCode(), readToken()));
  if (!socket) return null;

  setConnectionError(null);

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    const frame = decodeFrame(event.data);
    if (frame) route(frame);
  });

  socket.addEventListener('close', (event) => {
    setTransport(null);
    const reason = CLOSE_REASONS[event.code];
    if (reason) {
      setConnectionError(reason);
      console.warn(`[net] ${reason}`);
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
    case MSG.identity: {
      const message = frame.d as IdentityMessage;
      // Kept so the next visit is recognised as the same player, and shown in
      // the address bar so the world can be reloaded or shared.
      rememberToken(message.token);
      setInviteCode(message.code);
      showInviteCode(message.code);
      return;
    }
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
