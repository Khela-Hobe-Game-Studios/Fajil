import { Btn } from '../press';
import { useSoundPref, setSound } from '../game/useCues';

/**
 * The sound switch, in the masthead's dateline.
 *
 * Shared-screen only, because the shared screen is the only thing that makes a
 * sound. It sits in the dateline rather than behind a settings screen for the
 * same reason the deck and the round count sit on the landing page: the host is
 * standing at a television with people watching, and a party that has to be
 * paused while somebody finds a menu is a party that just turns the television
 * off instead.
 */
export function SoundToggle() {
  const on = useSoundPref();
  // The visible word is the state, so the accessible name is the thing rather than
  // the state: "Muted, not pressed" reads as a double negative.
  return (
    <button
      type="button"
      className={`sh-sound ${on ? '' : 'sh-sound--off'}`}
      aria-label="Sound"
      aria-pressed={on}
      onClick={() => setSound(!on)}
      data-testid="sound-toggle"
    >
      <span className="sh-sound-mark" aria-hidden="true" />
      <span>{on ? 'Sound' : 'Muted'}</span>
    </button>
  );
}

/**
 * The connection banner.
 *
 * A dropped socket is the most common thing that happens during a real game, and
 * the worst version of it is the silent one — a player taps and nothing happens
 * and they assume the game is broken. So it is stated plainly, and it says the
 * reassuring part: the seat is held. Nothing else on screen is disabled, because
 * the socket usually comes back within a second or two and blanking the game for
 * every blip would be far more disruptive than the blip.
 */
export function ConnectionBanner({ state }) {
  // Nothing to say before the first connection — the landing has its own copy for
  // a server that is still waking up.
  if (!state.everConnected || state.connected) return null;

  return (
    <div className="sh-banner" role="status" aria-live="polite">
      <span className="sh-banner-dot" />
      <span>
        Reconnecting…{' '}
        <b>{state.code ? 'your seat and score are held' : 'hold on'}</b>
      </span>
    </div>
  );
}

/**
 * The host went away, so the room is frozen.
 *
 * The prompt and the options live on the shared screen — without it the room is
 * playing blind, so the server stops the clock rather than running the round down.
 * Both sides get this overlay; only the host is told what to do about it.
 */
export function PausedOverlay({ isHost }) {
  return (
    <div className="sh-paused" role="alertdialog" aria-label="Game paused">
      <div className="sh-paused-card">
        <div className="pr-kicker">Stop press</div>
        <h2 className="pr-headline">Paused</h2>
        <p className="pr-article">
          {isHost
            ? 'The shared screen dropped off. It will pick up exactly where it stopped.'
            : 'The big screen dropped off. Nothing is lost — the round resumes where it stopped.'}
        </p>
      </div>
    </div>
  );
}

/** A dismissible error strip. Errors here are refusals, not crashes. */
export function ErrorNote({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="sh-error" role="alert">
      <span>{message}</span>
      {onDismiss ? (
        <Btn variant="ghost" onClick={onDismiss} aria-label="Dismiss">✕</Btn>
      ) : null}
    </div>
  );
}
