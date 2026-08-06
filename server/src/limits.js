/**
 * Abuse limits that survive a reconnect.
 *
 * The original limits all lived on `socket.data` — the token buckets and the
 * per-socket room ceiling alike. A socket is free to create, so every one of them
 * reset by disconnecting and dialling back in. Measured against the real server:
 * one laptop, unauthenticated, took every room code in the space in under a minute
 * and locked out every host in the world until the sweeper caught up.
 *
 * So the state that matters is keyed by client IP and lives here, outside any
 * socket's lifetime.
 *
 * IP is a weak identity — it is shared behind NAT and cheap to rotate with a botnet.
 * It is not trying to be an identity. It raises the cost of the cheap attack from
 * "one laptop, one minute" to "hundreds of distinct hosts", and the global ceilings
 * below bound the damage even when that fails.
 */

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

// Concurrent sockets from one address. A living room is nine (eight phones and the
// television); a NAT'd venue is more, so this is deliberately loose. It exists to
// stop a socket flood, not to police households.
const MAX_SOCKETS_PER_IP = num(process.env.MAX_SOCKETS_PER_IP, 40);

// Concurrent *rooms* one address may hold open. This is the ceiling that actually
// closes the exhaustion hole: taking the code space now needs many distinct hosts
// rather than many reconnects from one.
const MAX_ROOMS_PER_IP = num(process.env.MAX_ROOMS_PER_IP, 8);

// A global ceiling on live rooms, independent of codes.
//
// Widening the code space without this would only trade a code-exhaustion DoS for a
// memory-exhaustion one — the failure mode gets worse, not better, because the
// process dies instead of refusing politely.
const MAX_ROOMS_GLOBAL = num(process.env.MAX_ROOMS_GLOBAL, 5000);

/**
 * Whether to believe `X-Forwarded-For`.
 *
 * Behind Render (or any proxy) the socket's own address is the proxy's, so without
 * this every player in the world shares one bucket and the limits above lock the
 * game out entirely. Trusting the header when there is *no* proxy is the opposite
 * mistake: it is client-controlled, so every limit here becomes opt-out.
 *
 * There is no safe default that covers both, so it is explicit, inferred only from
 * an unambiguous signal, and logged loudly at startup.
 */
const TRUST_PROXY =
  process.env.TRUST_PROXY !== undefined
    ? /^(1|true|yes)$/i.test(process.env.TRUST_PROXY)
    : Boolean(process.env.RENDER);

function describeTrustProxy() {
  const base = TRUST_PROXY
    ? 'trusting X-Forwarded-For (behind a proxy)'
    : 'using the socket address (no proxy trusted)';
  return EXEMPT_LOOPBACK ? `${base}; loopback exempt` : `${base}; loopback policed`;
}

/**
 * Loopback is exempt from the per-address ceilings.
 *
 * Not a convenience hole: anything connecting from 127.0.0.1 is already running on
 * the box and does not need a socket to cause trouble. What it buys is that the test
 * suite, `capture-screens` and a developer with `npm run dev` left up all afternoon
 * do not silently trip a limit meant for the open internet — a gate that starts
 * failing on the fifth run of the day teaches people to disable the gate.
 *
 * In production the client's real address arrives via X-Forwarded-For, so nothing
 * reaching a deployed server ever matches this.
 */
function isLoopback(ip) {
  return (
    ip === '::1' ||
    ip === 'localhost' ||
    /^127\./.test(ip) ||
    /^::ffff:127\./.test(ip)
  );
}

/** The address to charge this connection to. */
function clientIp(socket) {
  if (TRUST_PROXY) {
    const xff = socket.handshake?.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) {
      // Leftmost entry is the originating client; the rest are proxy hops.
      const first = xff.split(',')[0].trim();
      if (first) return first;
    }
  }
  return socket.handshake?.address || 'unknown';
}

// ─── token buckets, keyed by ip ──────────────────────────────────────────────

const buckets = new Map(); // `${ip}|${key}` -> { tokens, last }
const sockets = new Map(); // ip -> concurrent socket count

/**
 * Refill-over-time bucket. `perSec` is the sustained rate, `burst` the ceiling —
 * the two are separate so a host can open a room immediately and a script cannot
 * open four hundred.
 */
function take(ip, key, perSec, burst = perSec) {
  const now = Date.now();
  const k = `${ip}|${key}`;
  const b = buckets.get(k) ?? { tokens: burst, last: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.last) / 1000) * perSec);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(k, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(k, b);
  return true;
}

function addSocket(ip) {
  const n = (sockets.get(ip) ?? 0) + 1;
  sockets.set(ip, n);
  return n <= MAX_SOCKETS_PER_IP;
}

function removeSocket(ip) {
  const n = (sockets.get(ip) ?? 1) - 1;
  if (n <= 0) sockets.delete(ip);
  else sockets.set(ip, n);
}

/**
 * How many live rooms this address already holds.
 *
 * Counted by scanning the rooms map rather than kept as a running total on purpose:
 * a counter has to be decremented on every path that destroys a room — the sweeper,
 * the game-over reaper, the last-player-left branch — and the one that gets missed
 * leaks quota until the address can never open a room again. The scan cannot drift.
 * Room creation is rare and the map is bounded by MAX_ROOMS_GLOBAL, so the cost is
 * irrelevant.
 */
function roomsHeldBy(rooms, ip) {
  let n = 0;
  for (const room of rooms.values()) if (room.creatorIp === ip) n++;
  return n;
}

// Set LIMIT_EXEMPT_LOOPBACK=0 to police loopback like any other address — used to
// exercise these limits in a test, and the right setting if the server sits behind a
// same-host reverse proxy with TRUST_PROXY off.
const EXEMPT_LOOPBACK = !/^(0|false|no)$/i.test(process.env.LIMIT_EXEMPT_LOOPBACK ?? '1');

function exempt(ip) {
  return EXEMPT_LOOPBACK && isLoopback(ip);
}

/**
 * The single gate on opening a room. Returns null to allow, or a player-facing
 * reason to refuse.
 */
function checkRoomCreate(rooms, ip) {
  // Checked even for loopback: this one bounds the process's memory, and a machine
  // that OOMs takes every live game with it regardless of who filled it.
  if (rooms.size >= MAX_ROOMS_GLOBAL) {
    return 'The server is at capacity right now — try again shortly';
  }
  if (exempt(ip)) return null;

  if (roomsHeldBy(rooms, ip) >= MAX_ROOMS_PER_IP) {
    return 'Too many open rooms from this network';
  }
  // Sustained: one room every 12s, up to 5 back to back.
  if (!take(ip, 'create', 1 / 12, 5)) {
    return 'Slow down a moment, then try again';
  }
  return null;
}

/**
 * Sockets are cheap to open, so joining is charged per address too.
 *
 * The burst is generous because a household is one address: eight phones and a
 * television all reconnecting the instant a router comes back is a completely
 * ordinary event, and it must not look like an attack.
 */
function checkJoin(ip) {
  if (exempt(ip)) return true;
  return take(ip, 'join', 2, 20);
}

function checkConnect(ip) {
  // Still counted when exempt, so /health reports the truth; only the ceiling is
  // waived.
  const withinCap = addSocket(ip);
  return exempt(ip) ? true : withinCap;
}

// Buckets are created per address seen, so without this the map is an unbounded
// leak keyed by whoever showed up — which is the same attacker who prompted all of
// the above. A bucket at full tokens carries no information and is safe to drop.
function startLimitSweeper(intervalMs = 5 * 60 * 1000) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now - b.last > 30 * 60 * 1000) buckets.delete(k);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

function limitStats() {
  return { trackedIps: sockets.size, buckets: buckets.size };
}

module.exports = {
  MAX_SOCKETS_PER_IP,
  MAX_ROOMS_PER_IP,
  MAX_ROOMS_GLOBAL,
  TRUST_PROXY,
  describeTrustProxy,
  clientIp,
  take,
  checkRoomCreate,
  checkJoin,
  checkConnect,
  removeSocket,
  roomsHeldBy,
  startLimitSweeper,
  limitStats,
};
