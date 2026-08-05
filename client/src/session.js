const SESSION_KEY = 'fajil_session';
const PID_KEY = 'fajil_pid';

/**
 * The ?join=CODE deep link, read exactly once and then stripped from the URL.
 *
 * Left in place, a refresh mid-game re-triggers it and bounces a player who is
 * three rounds in back to the join form.
 */
export const JOIN_CODE = (() => {
  try {
    const raw = new URLSearchParams(window.location.search).get('join') || '';
    if (!/^[A-Za-z0-9]{4}$/.test(raw)) return '';
    const url = new URL(window.location.href);
    url.searchParams.delete('join');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    return raw.toUpperCase();
  } catch {
    return '';
  }
})();

/**
 * Durable per-device id — the thing that makes a refresh a non-event.
 *
 * The server keys scores, lies and votes off this, never off the socket id, which
 * changes on every reconnect. Stored separately from the session so that clearing
 * the session (on "room not found", say) does not also change who this device is.
 */
export function getPlayerId() {
  let pid = null;
  try { pid = localStorage.getItem(PID_KEY); } catch { /* private mode */ }
  if (!pid) {
    pid = crypto.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem(PID_KEY, pid); } catch { /* ignore */ }
  }
  return pid;
}

export function saveSession(data) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

export function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
