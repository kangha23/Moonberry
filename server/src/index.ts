import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_MS, type Connection } from './FarmRoom';
import { GameDatabase, createToken } from './db';
import { SAVE_INTERVAL_MS, Worlds } from './Worlds';

const port = Number(process.env.PORT ?? 2567);
const dbFile = process.env.DATABASE_FILE ?? 'data/moonberry.sqlite';

const db = new GameDatabase(dbFile);
const worlds = new Worlds(db);

const server = new WebSocketServer({ port });

server.on('error', (error: Error & { code?: string }) => {
  // Without this the process dies on an unhandled 'error' event and prints a
  // stack trace, which buries the one line that says what actually went wrong.
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other server or set PORT.`);
  } else {
    console.error('Farm server error:', error.message);
  }
  process.exit(1);
});

/** Close codes, so the client can say something useful instead of "it broke". */
const CLOSE = {
  worldFull: 4001,
  unknownWorld: 4002,
};

/**
 * Reads the invite code and player token off the connection URL.
 *
 * Both are optional: with neither, a brand new player gets a brand new world,
 * which is what makes the game playable without a lobby or a sign-up form.
 */
function readQuery(url: string | undefined): { code: string | null; token: string | null } {
  try {
    const params = new URL(url ?? '/', 'ws://localhost').searchParams;
    const code = params.get('code');
    const token = params.get('token');
    return {
      // Codes are stored upper-case; accept whatever case the player typed.
      code: code ? code.trim().toUpperCase() : null,
      token: token && token.length >= 16 ? token : null,
    };
  } catch {
    return { code: null, token: null };
  }
}

server.on('connection', (socket: WebSocket, request) => {
  const { code, token: presentedToken } = readQuery(request.url);

  // An unrecognised token is treated as a new player rather than an error: a
  // token is how a returning player is recognised, not a credential that can
  // be wrong. See the README for what this does and does not protect.
  const token = presentedToken ?? createToken();
  const identity =
    (presentedToken ? db.findIdentity(presentedToken) : null) ??
    db.createIdentity(token, randomUUID(), `Farmhand ${db.worldCount() + 1}`);

  const connection: Connection = {
    id: identity.playerId,
    send: (data) => {
      if (socket.readyState === socket.OPEN) socket.send(data);
    },
    close: () => socket.close(),
  };

  const result = worlds.join(code, connection, identity.name);

  if ('error' in result) {
    socket.close(
      result.error === 'world-full' ? CLOSE.worldFull : CLOSE.unknownWorld,
      result.error === 'world-full' ? 'This farm already has four farmhands.' : 'No farm with that code.',
    );
    return;
  }

  // The client needs these back: the token to be recognised next time, the
  // code to invite somebody else.
  socket.send(JSON.stringify({ t: 'id', d: { token, code: result.code, playerId: identity.playerId } }));

  socket.on('message', (data) => result.room.receive(connection.id, data.toString()));
  socket.on('close', () => worlds.leave(result.code, connection.id));
  socket.on('error', () => worlds.leave(result.code, connection.id));
});

let last = Date.now();
const loop = setInterval(() => {
  const now = Date.now();
  const deltaMs = now - last;
  last = now;
  worlds.tick(deltaMs);
}, TICK_MS);

const saveLoop = setInterval(() => worlds.maintain(), SAVE_INTERVAL_MS);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(loop);
  clearInterval(saveLoop);
  // Save before the socket closes, so a restart never costs the last minute.
  worlds.shutdown();
  db.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('listening', () => {
  console.log(`Moonberry farm server listening on ws://localhost:${port}`);
  console.log(`Worlds stored in ${dbFile} (${db.worldCount()} so far)`);
});
