import { useEffect, useState } from 'react';

/**
 * The room's clock.
 *
 * Every phase arrives stamped with the server's time. Clients never count down from
 * a number they were handed once — they measure their offset from the server and
 * derive the remainder from `endsAt`. That is what keeps a television and eight
 * phones on the same second: a slow socket, a backgrounded tab, a phone that slept
 * through a round and a player who joined mid-vote all compute the same answer,
 * because they are reading the same clock rather than each running their own.
 */

let offset = 0; // serverNow - clientNow, in ms
let bestRoundTrip = Infinity;

export function serverNow() {
  return Date.now() + offset;
}

/** Re-measured on every connect, which is the point — a device that slept for an
 * hour comes back with a drifted clock. */
export function syncClock(socket, samples = 3) {
  bestRoundTrip = Infinity;

  const probe = (left) => {
    if (left <= 0 || !socket.connected) return;
    const sent = Date.now();
    socket.emit('time:ping', sent, (pong) => {
      const received = Date.now();
      const roundTrip = received - sent;
      // Keep the least-delayed sample: on a jittery link the fastest round trip is
      // the one whose half-latency estimate is closest to true.
      if (roundTrip < bestRoundTrip) {
        bestRoundTrip = roundTrip;
        offset = pong.serverNow + roundTrip / 2 - received;
      }
      setTimeout(() => probe(left - 1), 120);
    });
  };

  probe(samples);
}

/** Milliseconds left in a phase, or null when the phase has no clock. */
export function remainingMs(timing) {
  if (!timing?.endsAt) return null;
  return Math.max(0, timing.endsAt - serverNow());
}

/** Milliseconds since a phase began — what the reveal plays against. */
export function elapsedMs(timing) {
  if (!timing?.startedAt) return 0;
  return Math.max(0, serverNow() - timing.startedAt);
}

/**
 * Seconds left, ticking on the second boundary rather than every 1000ms from mount.
 * An interval started mid-second shows each number for a fraction of a second and
 * then holds the last one too long, which on a large numeral is very visible.
 */
export function useCountdown(timing) {
  const [, force] = useState(0);
  const left = remainingMs(timing);

  useEffect(() => {
    if (left === null || left <= 0) return undefined;
    const untilNextTick = left % 1000 || 1000;
    const t = setTimeout(() => force((n) => n + 1), untilNextTick);
    return () => clearTimeout(t);
  }, [left, timing]);

  return left === null ? null : Math.ceil(left / 1000);
}
