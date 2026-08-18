const crypto = require('crypto');

const rooms = new Map();

// Codes are read aloud across a room, so they are words rather than random letters.
// A random 4-letter code needs an ambiguity-free alphabet (no I/O/0/1/L) because it
// is spelled out; a word is *said*, and "ADDA" survives a noisy room in a way that
// "QXTL" does not.
//
// Every word is something a Bangladeshi table already says out loud, which is the
// point: the code is the first thing the game shows anybody, and "MAMA" or "BIRI" on
// a television sets the register of the whole evening before a question is asked.
// Grouped by what they are, because the bank is content and gets edited like content.
//
// Two standing rules for anything added here. It must be four ASCII letters, and it
// must be safe to put on a screen in somebody's living room — no slang that is rude
// in either language, and nothing that reads as a word you would not want a room to
// chant. Prefer the warm and the domestic; that is what the list is for.
const WORD_BANK = [
  // people at the table
  'MAMA', 'KAKA', 'DADA', 'DADU', 'NANA', 'NANI', 'BHAI', 'DIDI', 'BABA', 'MASI',
  // what is on it
  'BIRI', 'TONG', 'CHAA', 'MURI', 'DAAL', 'BHAT', 'RUTI', 'KOLA', 'PAAN', 'BORA',
  'CHOP', 'DUDH', 'JHAL', 'JHOL', 'MOJA',
  // out of the window
  'NODI', 'MEGH', 'HAWA', 'MATI', 'GHAT', 'KHAL', 'BAGH', 'HATI', 'MACH', 'PHUL',
  'TARA', 'RAAT', 'BEEL', 'CHAR', 'DHAN', 'KASH',
  // the life
  'ADDA', 'TAKA', 'GARI', 'NOKA', 'DHOL', 'JAMA', 'SARI', 'ALTA', 'MELA', 'PARA',
  'BARI', 'DESH', 'JADU', 'HASI', 'MAYA', 'SONA', 'RONG', 'SHUR', 'KHEL', 'MUKH',
  'NAAM', 'TUMI', 'EIDI', 'PUJO', 'ROZA', 'TALI',
  // what the game is about
  'CHOR', 'CHUP', 'BOKA', 'BHUT', 'UDAS', 'BAJE', 'DEKH',
];

// Reading N lies is O(N) attention, unlike guessing a number — at 15 players the
// vote screen is 16 options and 25 seconds, which makes voting random and means
// half the room never hears their own lie read out. The genre caps here for a
// reason; this is a game for a sofa, not a stadium.
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const NAME_MAX = 16;

const IDLE_ROOM_MS = 2 * 60 * 60 * 1000;
// A room nobody ever joined, whose host is also gone, is abandoned rather than idle.
// Holding those for the full 2h is what lets repeated create_room calls exhaust the
// code space and lock everyone out.
//
// Three minutes, swept every minute: an abandoned room is one whose host socket is
// *already gone*, so nothing is being taken away from anyone still looking at a
// screen. The old ten-minute hold meant a burst of junk rooms held their codes for
// up to fifteen minutes — long enough that one short attack outlasted most parties.
const EMPTY_LOBBY_MS = 3 * 60 * 1000;

// Unambiguous alphabet for the overflow tier: no I/O/0/1/L, because an overflow code
// is spelled out rather than said and those are the pairs a room mishears.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Never hand out a code belonging to a live room.
 *
 * Three tiers, widest-appeal first. The word bank is what a host actually wants —
 * "ADDA" survives a noisy room in a way "QXTL" does not — so it is always tried
 * first and the overflow only ever appears under load the game has never seen.
 *
 * The tiers matter because the first two are small: the bank and its digit forms are
 * a few hundred codes in total, and that used to be a hard global ceiling on
 * concurrent games. Reaching it is not a degraded experience, it is a total outage —
 * every host in the world gets "No rooms available" — and it was reachable from one
 * machine in under a minute. The random tier is 31^4, so the ceiling that binds is
 * now MAX_ROOMS_GLOBAL, which refuses politely and bounds memory instead.
 */
function generateCode() {
  const available = WORD_BANK.filter((w) => !rooms.has(w));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }
  for (let digit = 2; digit <= 9; digit++) {
    // Deduped, because the bank has words that share three letters — DADA and DADU,
    // NANA and NANI — and a plain map would deal the same code twice and quietly
    // shrink this tier.
    const pool = [...new Set(WORD_BANK.map((w) => w.slice(0, 3) + digit))].filter((c) => !rooms.has(c));
    if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
  }
  return randomCode();
}

/**
 * A random four-character code, guaranteed to contain a digit.
 *
 * The digit is not decoration: without it this generator eventually deals a real
 * four-letter word onto a television in someone's living room, and some of those
 * words are ones you would not want it to pick. A forced digit breaks the shape of
 * every one of them.
 */
function randomCode(attempts = 200) {
  const pick = (s) => s[crypto.randomInt(s.length)];
  const digits = '23456789';
  for (let i = 0; i < attempts; i++) {
    const chars = [pick(CODE_ALPHABET), pick(CODE_ALPHABET), pick(CODE_ALPHABET), pick(CODE_ALPHABET)];
    chars[crypto.randomInt(4)] = pick(digits);
    const code = chars.join('');
    if (!rooms.has(code)) return code;
  }
  return null; // caller surfaces an error rather than overwriting a live room
}

const ROUND_OPTIONS = [3, 5, 7];
const LIE_SECONDS_OPTIONS = [45, 60, 90];
const DECKS = ['mixed', 'desh', 'probash'];

const DEFAULT_SETTINGS = {
  rounds: 5,
  lieSeconds: 60,
  deck: 'mixed',
};

function normalizeSettings(raw = {}, base = DEFAULT_SETTINGS) {
  const rounds = Number(raw.rounds);
  const lieSeconds = Number(raw.lieSeconds);
  return {
    rounds: ROUND_OPTIONS.includes(rounds) ? rounds : base.rounds,
    lieSeconds: LIE_SECONDS_OPTIONS.includes(lieSeconds) ? lieSeconds : base.lieSeconds,
    deck: DECKS.includes(raw.deck) ? raw.deck : base.deck,
  };
}

function createRoom({ hostSocketId, settings, creatorIp = null }) {
  const code = generateCode();
  if (!code) return null;

  const room = {
    code,
    hostSocketId,
    // The address that opened this room, so the per-IP ceiling can be counted by
    // scanning live rooms rather than by a running total that drifts. Never emitted.
    creatorIp,
    // The host's half of what a player's pid already is: a secret the client holds,
    // minted here, required back on rejoin. Codes are a small bank of words, so
    // granting host control on the code alone means anyone who guesses one takes
    // over the game — and demotes the real host, whose socket id no longer matches.
    // Never broadcast; only ever sent to the socket that created the room.
    hostToken: crypto.randomBytes(24).toString('base64url'),
    hostConnected: true,
    state: 'LOBBY',
    players: [],
    settings: normalizeSettings(settings),

    round: 0,              // 0-indexed internally; payloads carry it 1-indexed
    questions: [],         // pre-drawn at start, no repeats
    current: null,         // RoundState, see gameManager.startRound

    // Keyed by the player's STABLE pid, never by socket id — socket ids change on
    // every reconnect, which silently resets a returning player's score to zero.
    scores: {},            // pid -> number
    knewIt: {},            // pid -> count of rounds they typed the real answer

    _nextColorIndex: 0,
    _timers: {},
    lastActivityAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return code ? rooms.get(code) : null;
}

function touchRoom(room) {
  if (room) room.lastActivityAt = Date.now();
}

function sanitizeName(raw) {
  const name = String(raw ?? '')
    // Strip C0/C1 control characters only — Bengali script and emoji names survive.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, NAME_MAX);
  return name || null;
}

// Identity is the pid, but the reveal copy says names out loud ("Rumi wrote this"),
// and two Rumis in one room makes that sentence a lie of its own.
function uniqueName(room, name) {
  const taken = new Set(room.players.map((p) => p.name));
  if (!taken.has(name)) return name;
  for (let n = 2; n < 100; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
  return name;
}

function addPlayer(room, { pid, socketId, name }) {
  const existing = room.players.find((p) => p.id === pid);
  if (existing) {
    // Same device coming back — reattach the transport, keep score and colour.
    existing.socketId = socketId;
    existing.connectionState = 'connected';
    existing.seatHoldUntil = null;
    return existing;
  }
  if (room.players.length >= MAX_PLAYERS) return null;

  const player = {
    id: pid,
    socketId,
    name: uniqueName(room, name),
    score: 0,
    // Handed out from a counter, never from the roster index: the roster is filtered
    // on removal, so an index-derived colour re-paints everyone after whoever left.
    colorIndex: room._nextColorIndex++,
    connectionState: 'connected',
    seatHoldUntil: null,
  };
  room.players.push(player);
  room.scores[pid] = room.scores[pid] ?? 0;
  return player;
}

function findPlayerByPid(room, pid) {
  return pid ? room.players.find((p) => p.id === pid) : undefined;
}

function findPlayerBySocket(room, socketId) {
  return room.players.find((p) => p.socketId === socketId);
}

// Only ever a lobby no-show — a mid-game drop keeps its seat and its score. Drop the
// score row with them or an abandoned lobby accumulates one forever.
function removePlayer(room, pid) {
  room.players = room.players.filter((p) => p.id !== pid);
  delete room.scores[pid];
  delete room.knewIt[pid];
}

function clearRoomTimers(room) {
  if (!room?._timers) return;
  for (const t of Object.values(room._timers)) clearTimeout(t);
  room._timers = {};
}

function setRoomTimer(room, key, fn, ms) {
  clearTimeout(room._timers[key]);
  room._timers[key] = setTimeout(fn, ms);
  return room._timers[key];
}

function clearRoomTimer(room, key) {
  clearTimeout(room._timers[key]);
  delete room._timers[key];
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearRoomTimers(room);
  // The host grace timer lives outside _timers. Left running it fires against a room
  // that no longer exists, pausing a detached object and pinning it in memory.
  if (room._hostTimer) { clearTimeout(room._hostTimer); delete room._hostTimer; }
  for (const p of room.players) {
    if (p._disconnectTimer) clearTimeout(p._disconnectTimer);
  }
  rooms.delete(code);
}

function startIdleSweeper(intervalMs = 60 * 1000) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const idle = now - room.lastActivityAt;
      const abandoned =
        room.state === 'LOBBY' &&
        room.players.length === 0 &&
        !room.hostConnected &&
        idle > EMPTY_LOBBY_MS;

      if (abandoned || idle > IDLE_ROOM_MS) {
        console.log('[rooms] reaping', abandoned ? 'abandoned' : 'idle', 'room', code);
        deleteRoom(code);
      }
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  rooms,
  WORD_BANK,
  CODE_ALPHABET,
  generateCode,
  MAX_PLAYERS,
  MIN_PLAYERS,
  DEFAULT_SETTINGS,
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
  clearRoomTimers,
  clearRoomTimer,
  setRoomTimer,
  startIdleSweeper,
};
