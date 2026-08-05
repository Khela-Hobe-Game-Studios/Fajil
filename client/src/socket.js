import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

/**
 * One socket for the whole app.
 *
 * The reconnection settings are deliberately stubborn. This game is played on
 * phones, at a party, on whatever wifi is in the room — a socket that gives up
 * after a handful of attempts strands a player mid-game with no way back except a
 * manual refresh, and they will simply put the phone down instead. Retrying
 * forever costs nothing: identity is a durable pid, so the reconnect is always
 * able to restore the player exactly.
 */
const socket = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  // Without jitter, fifteen phones that dropped together on the same flaky router
  // all retry on exactly the same schedule and keep colliding.
  randomizationFactor: 0.5,
  timeout: 20000,
});

/**
 * iOS suspends timers and sockets for a backgrounded tab and does not always fire
 * a clean disconnect when it resumes — the socket can sit in a state that believes
 * it is connected while nothing is arriving. Locking a phone between rounds is the
 * single most common thing that happens during a game, so on every return to the
 * foreground we check for real and reconnect if not.
 */
if (typeof document !== 'undefined') {
  const wake = () => {
    if (document.visibilityState === 'visible' && !socket.connected) socket.connect();
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
}

export default socket;
export { SERVER_URL };
