import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { FarmRoom, TICK_MS, type Connection } from './FarmRoom';

const port = Number(process.env.PORT ?? 2567);

/**
 * One farm for now. Phase 5 turns this into a map of farms keyed by an invite
 * code, with each farm loaded from and saved to the database.
 */
const room = new FarmRoom();

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

server.on('connection', (socket: WebSocket) => {
  const connection: Connection = {
    id: randomUUID(),
    send: (data) => {
      if (socket.readyState === socket.OPEN) socket.send(data);
    },
    close: () => socket.close(),
  };

  if (!room.join(connection)) {
    socket.close(4001, 'This farm is full.');
    return;
  }

  socket.on('message', (data) => room.receive(connection.id, data.toString()));
  socket.on('close', () => room.leave(connection.id));
  socket.on('error', () => room.leave(connection.id));
});

let last = Date.now();
const loop = setInterval(() => {
  const now = Date.now();
  const deltaMs = now - last;
  last = now;
  room.tick(deltaMs);
}, TICK_MS);

function shutdown() {
  clearInterval(loop);
  room.closeAll();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('listening', () => {
  console.log(`Moonberry farm server listening on ws://localhost:${port}`);
});
