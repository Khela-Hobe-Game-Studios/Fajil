const express = require('express');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const {
  rooms,
  MAX_PLAYERS,
  MIN_PLAYERS,
  normalizeSettings,
  createRoom,
  getRoom,
  touchRoom,
  sanitizeName,
  addPlayer,
  findPlayerByPid,
  findPlayerBySocket,
  removePlayer,
  deleteRoom,
  startIdleSweeper,
} = require('./roomManager');
const { handleGameEvent, syncPlayerState, setQuestions, resetToLobby } = require('./gameManager');
const { sanitizePlayers } = require('./sanitize');
const { loadQuestions } = require('./questionsLoader');
const { LIE_MAX } = require('./lies');
const {
  clientIp,
  checkRoomCreate,
  checkJoin,
  checkConnect,
  removeSocket,
  startLimitSweeper,
  limitStats,
  describeTrustProxy,
  MAX_ROOMS_GLOBAL,
  TRUST_PROXY,
} = require('./limits');

/**
 * Which origins may drive this backend.
 *
 * `*` let any page on the internet open rooms and drive games against this server,
 * which is both an abuse surface and the reason the limits in `limits.js` cannot be
 * reasoned about — you cannot rate-limit a caller you have not scoped. Set
 * `ALLOWED_ORIGINS` to the deployed client (comma-separated for a custom domain
 * alongside the Pages URL). Unset stays open, because a LAN dev session and a
 * self-hosted copy both legitimately have no fixed origin.
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOrigin = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : '*';

const app = express();
app.set('trust proxy', true);
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '16kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin },
  // Phones sleep aggressively and mobile data drops for seconds at a time. These are
  // deliberately slack: a backgrounded tab or a lift ride should not be read as a
  // disconnect at all, because the cheapest reconnect is the one that never happens.
  pingInterval: 20000,
  pingTimeout: 25000,
  // The largest thing a client ever legitimately sends is a 60-character lie. The
  // default ceiling is 1MB per message, which is four orders of magnitude of free
  // memory pressure per socket for anyone who wants it.
  maxHttpBufferSize: 8 * 1024,
});

app.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    rooms: rooms.size,
    maxRooms: MAX_ROOMS_GLOBAL,
    // The two settings that fail *silently* rather than loudly, reported so a
    // misconfigured deploy is visible without shell access to read the boot log.
    // `trustProxy: false` behind a proxy puts every player on earth in one
    // rate-limit bucket; `cors: "open"` means any site can drive this backend.
    // Neither is sensitive — both are observable from outside anyway, one by
    // probing the limits and one by reading a preflight response.
    trustProxy: TRUST_PROXY,
    cors: ALLOWED_ORIGINS.length ? 'allowlist' : 'open',
    sockets: io.engine?.clientsCount ?? 0,
    players: [...rooms.values()].reduce((n, r) => n + r.players.length, 0),
    rssMb: Math.round(mem.rss / 1048576),
    heapMb: Math.round(mem.heapUsed / 1048576),
    uptimeS: Math.round(process.uptime()),
    ...limitStats(),
  });
});

// ─── how long a seat is held ─────────────────────────────────────────────────
//
// A player who refreshes, locks their phone, walks into a tunnel or switches apps
// must come back to the same seat with the same score. Identity is the durable pid
// the client keeps in localStorage, so "the same player" survives a new socket, a
// new tab and a full page reload.
//
// In the lobby a no-show is just gone — nothing is lost by removing them and the
// roster should reflect who is actually in the room. Mid-game they are never
// removed: after the hold expires they are marked `dropped` but keep their row and
// their score, so a phone that dies in round 3 is still on the final standings.
const LOBBY_GRACE_MS = 20000;
const GAME_GRACE_MS = 120000;
const HOST_GRACE_MS = 30000;
const GAME_OVER_ROOM_TTL = 15 * 60 * 1000;

// ─── validation ──────────────────────────────────────────────────────────────

function isValidCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9]{4}$/.test(code);
}

function isValidPid(pid) {
  return typeof pid === 'string' && pid.length > 0 && pid.length <= 64;
}

function isValidText(t, max) {
  return typeof t === 'string' && t.length > 0 && t.length <= max * 4;
}

// Constant-time compare so a wrong host token cannot be narrowed down by timing.
// Length is checked first because timingSafeEqual throws on a length mismatch
// rather than returning false.
function timingSafeEqual(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Token bucket per socket, for the in-room actions.
//
// Deliberately still per-socket: a spammed submit fans a broadcast out to every
// device in the room, and the socket is the right thing to charge because the
// spammer must already hold a seat in that room to do it. The limits that had to
// move to an IP are the ones a stranger can reach *before* being admitted anywhere —
// creating and joining — because those reset for free on reconnect. See limits.js.
function allow(socket, key, perSec = 5) {
  const now = Date.now();
  socket.data._buckets ??= {};
  const b = (socket.data._buckets[key] ??= { tokens: perSec, last: now });
  b.tokens = Math.min(perSec, b.tokens + ((now - b.last) / 1000) * perSec);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    state: room.state,
    players: sanitizePlayers(room.players),
    settings: room.settings,
  };
}

function broadcastPlayers(code, room) {
  io.to(code).emit('room:updated', { players: sanitizePlayers(room.players) });
}

/** Cancel a pending seat-expiry. Called on every path that brings a player back. */
function cancelDrop(player) {
  if (player?._disconnectTimer) {
    clearTimeout(player._disconnectTimer);
    delete player._disconnectTimer;
  }
}

// ─── socket handlers ─────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  // Charged to the address, not the connection, so a flood cannot buy more room by
  // opening more sockets. Released on disconnect below.
  const ip = clientIp(socket);
  socket.data.ip = ip;
  if (!checkConnect(ip)) {
    socket.emit('error', { message: 'Too many connections from this network' });
    return socket.disconnect(true);
  }

  // Clients derive every countdown from the server's clock rather than from a number
  // handed to them once, so they measure their offset here first.
  socket.on('time:ping', (clientSent, ack) => {
    // Echo only what a clock sync needs. Reflecting the client's own value back
    // unbounded makes this a free amplifier; the client only ever sends a number.
    const echoed = typeof clientSent === 'number' ? clientSent : null;
    const payload = { clientSent: echoed, serverNow: Date.now() };
    if (typeof ack === 'function') return ack(payload);
    socket.emit('time:pong', payload);
  });

  socket.on('host:create_room', (settings = {}) => {
    if (!allow(socket, 'create', 2)) return;

    // The real ceiling, keyed by address so it survives a reconnect. The per-socket
    // counter this replaces was measured taking the entire code space from one
    // machine in under a minute.
    const refusal = checkRoomCreate(rooms, ip);
    if (refusal) return socket.emit('error', { message: refusal });

    const room = createRoom({ hostSocketId: socket.id, settings, creatorIp: ip });
    if (!room) return socket.emit('error', { message: 'No rooms available right now — try again shortly' });

    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.isHost = true;
    // The token goes to this socket only, never over a broadcast.
    socket.emit('room:created', { code: room.code, settings: room.settings, hostToken: room.hostToken });
    console.log('room created:', room.code);
  });

  socket.on('host:update_settings', (settings = {}) => {
    const room = getRoom(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.state !== 'LOBBY') return;
    if (!allow(socket, 'settings', 5)) return;

    room.settings = normalizeSettings(settings, room.settings);
    touchRoom(room);
    io.to(room.code).emit('room:settings', { settings: room.settings });
  });

  socket.on('player:join', ({ code, name, pid } = {}) => {
    if (!allow(socket, 'join', 3)) return;
    // Charged per address here but deliberately NOT on player:rejoin below. A first
    // join is a stranger guessing at codes; a rejoin is someone who already holds a
    // seat and whose phone just came back. Refusing the second one to slow the first
    // strands a player mid-game, which is the failure this whole codebase is built
    // to avoid — and it is bounded anyway, because a room holds at most 8 seats.
    if (!checkJoin(ip)) return socket.emit('error', { message: 'Slow down a moment, then try again' });
    if (!isValidCode(code)) return socket.emit('error', { message: 'Room not found' });
    if (!isValidPid(pid)) return socket.emit('error', { message: 'Invalid session — please refresh' });

    const room = getRoom(String(code).toUpperCase());
    if (!room) return socket.emit('error', { message: 'Room not found' });

    const clean = sanitizeName(name);
    if (!clean) return socket.emit('error', { message: 'Please enter a name' });

    // A device that was already in this room is always allowed back, mid-game or
    // not — this is the path a refresh during a round takes. Only a genuinely new
    // device is turned away once play has started.
    const existing = findPlayerByPid(room, pid);
    if (!existing && room.state !== 'LOBBY') {
      return socket.emit('error', { message: 'Game already started' });
    }

    const player = addPlayer(room, { pid, socketId: socket.id, name: clean });
    if (!player) return socket.emit('error', { message: `Room is full (max ${MAX_PLAYERS} players)` });

    cancelDrop(player);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.pid = pid;
    touchRoom(room);

    broadcastPlayers(room.code, room);
    socket.emit('player:joined', {
      room: sanitizeRoom(room),
      you: { id: pid, name: player.name, colorIndex: player.colorIndex },
    });
    if (room.state !== 'LOBBY') syncPlayerState(socket, room, pid);
    console.log(`${player.name} joined room ${room.code}`);
  });

  /**
   * Fires on every reconnect, not just an explicit refresh.
   *
   * This is the handler that makes a dropped connection a non-event: the client
   * re-announces itself with its stored pid on every `connect`, and the server
   * reattaches the transport to the existing player and replays the live phase with
   * real elapsed time.
   */
  socket.on('player:rejoin', ({ code, pid, name } = {}) => {
    // In the lobby this can also create a player, so it needs the same ceiling
    // player:join has or it is simply the unlimited way in.
    if (!allow(socket, 'join', 3)) return;
    if (!isValidCode(code) || !isValidPid(pid)) {
      return socket.emit('error', { message: 'Room not found' });
    }
    const room = getRoom(String(code).toUpperCase());
    if (!room) return socket.emit('error', { message: 'Room not found' });

    let player = findPlayerByPid(room, pid);

    // Dropped out of the lobby and came back — let them straight back in.
    if (!player && room.state === 'LOBBY') {
      const clean = sanitizeName(name);
      if (clean) player = addPlayer(room, { pid, socketId: socket.id, name: clean });
    }
    if (!player) return socket.emit('error', { message: 'Player not found in room' });

    cancelDrop(player);
    player.socketId = socket.id;
    player.connectionState = 'connected';
    player.seatHoldUntil = null;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.pid = pid;
    touchRoom(room);

    socket.emit('player:joined', {
      room: sanitizeRoom(room),
      you: { id: pid, name: player.name, colorIndex: player.colorIndex },
    });
    syncPlayerState(socket, room, pid);
    broadcastPlayers(room.code, room);
    console.log(`${player.name} rejoined room ${room.code}`);
  });

  socket.on('host:rejoin', ({ code, hostToken } = {}) => {
    if (!allow(socket, 'hostrejoin', 3)) return;
    if (!isValidCode(code)) return socket.emit('error', { message: 'Room not found' });
    const room = getRoom(String(code).toUpperCase());
    if (!room) return socket.emit('error', { message: 'Room not found' });

    if (!timingSafeEqual(hostToken, room.hostToken)) {
      return socket.emit('error', { message: 'Not the host of this room' });
    }

    room.hostSocketId = socket.id;
    room.hostConnected = true;
    if (room._hostTimer) { clearTimeout(room._hostTimer); delete room._hostTimer; }

    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.isHost = true;
    touchRoom(room);

    socket.emit('room:created', { code: room.code, settings: room.settings, hostToken: room.hostToken });
    socket.emit('room:updated', { players: sanitizePlayers(room.players) });
    if (room.paused) handleGameEvent(io, room, 'HOST_BACK');
    else syncPlayerState(socket, room, null);
    console.log(`host rejoined room ${room.code}`);
  });

  socket.on('host:start_game', () => {
    const room = getRoom(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.state !== 'LOBBY') return;
    if (room.players.length < MIN_PLAYERS) {
      return socket.emit('error', { message: `Need at least ${MIN_PLAYERS} players` });
    }
    handleGameEvent(io, room, 'START');
  });

  socket.on('host:skip', () => {
    const room = getRoom(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    if (!allow(socket, 'skip', 2)) return;
    handleGameEvent(io, room, 'SKIP');
  });

  socket.on('host:end_game', () => {
    const room = getRoom(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    handleGameEvent(io, room, 'END');
  });

  socket.on('host:play_again', () => {
    const room = getRoom(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    resetToLobby(io, room);
  });

  socket.on('player:submit_lie', ({ text } = {}) => {
    if (!allow(socket, 'lie', 4)) return;
    const room = getRoom(socket.data?.roomCode);
    const pid = socket.data?.pid;
    if (!room || !pid) return;
    if (!isValidText(text, LIE_MAX)) {
      return socket.emit('error', { message: 'Write something first' });
    }
    handleGameEvent(io, room, 'LIE', { pid, text });
  });

  socket.on('player:submit_vote', ({ optionId } = {}) => {
    if (!allow(socket, 'vote', 4)) return;
    const room = getRoom(socket.data?.roomCode);
    const pid = socket.data?.pid;
    if (!room || !pid) return;
    if (typeof optionId !== 'string' || optionId.length > 8) return;
    handleGameEvent(io, room, 'VOTE', { pid, optionId });
  });

  socket.on('disconnect', () => {
    // Before any early return below, or the per-IP socket count only ever climbs and
    // a household is locked out after enough ordinary reconnects.
    removeSocket(ip);

    const code = socket.data?.roomCode;
    if (!code) return;
    const room = getRoom(code);
    if (!room) return;

    // The host holds the shared screen — the prompt and the options live there, so
    // the room is playing blind without it. Freeze rather than run the clock down.
    if (socket.data.isHost && room.hostSocketId === socket.id) {
      room.hostConnected = false;
      room._hostTimer = setTimeout(() => {
        if (!room.hostConnected) handleGameEvent(io, room, 'HOST_LOST');
      }, HOST_GRACE_MS);
      return;
    }

    const player = findPlayerBySocket(room, socket.id);
    if (!player) return;

    // A socket that has already been superseded — the player reconnected on a new
    // socket before this teardown ran. Ignore it, or the late disconnect of the old
    // transport marks a player who is sitting right there as reconnecting.
    if (player.socketId !== socket.id) return;

    const inLobby = room.state === 'LOBBY';
    const timeout = inLobby ? LOBBY_GRACE_MS : GAME_GRACE_MS;

    player.connectionState = 'reconnecting';
    player.seatHoldUntil = Date.now() + timeout;
    if (!inLobby) handleGameEvent(io, room, 'PLAYER_DISCONNECTED');
    broadcastPlayers(code, room);

    player._disconnectTimer = setTimeout(() => {
      if (player.connectionState !== 'reconnecting') return;

      if (inLobby) {
        removePlayer(room, player.id);
      } else {
        // Never removed mid-game. They keep their row and their score and can walk
        // back in on the same device at any point before the room is reaped.
        player.connectionState = 'dropped';
        player.seatHoldUntil = null;
      }
      broadcastPlayers(code, room);

      const anyoneLeft = room.players.some((p) => p.connectionState === 'connected');
      if (!anyoneLeft && !room.hostConnected) deleteRoom(code);
    }, timeout);
  });
});

// Reap finished rooms a while after the podium so codes return to the pool — but
// not so fast that a player who wants to see the final standings again loses them.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.state === 'GAME_OVER' && now - room.lastActivityAt > GAME_OVER_ROOM_TTL) {
      deleteRoom(code);
    }
  }
}, 60000).unref?.();

startIdleSweeper();
startLimitSweeper();

/**
 * Say goodbye before dying.
 *
 * Every room is in memory, so a deploy, a crash-restart or a free-tier spin-down
 * destroys every live game. That is a known limitation, but the *silent* version of
 * it is much worse than it needs to be: clients retry forever by design, so without
 * this a room full of people sits watching a frozen screen reconnect to a server
 * that has already forgotten them, and only finds out when a phase never advances.
 *
 * One frame costs nothing and turns that into an honest message. The client already
 * treats "Room not found" on the way back as fatal and clears the session.
 */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} — notifying ${io.engine?.clientsCount ?? 0} clients`);
  io.emit('server:shutdown', { message: 'The server is restarting — this game cannot continue.' });

  // Let the frame reach the wire before tearing the transport down.
  setTimeout(() => {
    io.close(() => server.close(() => process.exit(0)));
    // Render sends SIGKILL after 30s; leaving well before that avoids a hard kill
    // mid-write, and there is no state on disk worth waiting for.
    setTimeout(() => process.exit(0), 3000).unref?.();
  }, 250);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// An unhandled rejection would otherwise take the process down on newer Node with no
// indication of which room was mid-phase when it happened.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

const PORT = process.env.PORT || 3001;
loadQuestions()
  .then((q) => {
    setQuestions(q);
    server.listen(PORT, () => {
      console.log(`Fajil server on ${PORT} — ${q.length} questions`);
      console.log(`[limits] ${describeTrustProxy()}; max ${MAX_ROOMS_GLOBAL} rooms`);
      console.log(`[cors] ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'open (ALLOWED_ORIGINS unset)'}`);
    });
  })
  .catch((err) => {
    console.error('[questions] failed to load:', err.message);
    process.exit(1);
  });
