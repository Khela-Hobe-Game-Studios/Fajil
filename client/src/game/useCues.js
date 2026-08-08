import { useEffect, useRef, useSyncExternalStore } from 'react';
import { elapsedMs, remainingMs } from './clock';
import {
  cue, sequence, kill, killAll, setBed, setMuted, unlockAudio, audioReady,
} from './cues';

/**
 * Where the press room's voice meets the page.
 *
 * The pairing rule is that **audio reads the same clock the pixels do**. Every
 * phase arrives stamped with the server's time and the reveal arrives with an
 * explicit beat schedule; this hook turns both into AudioContext-time offsets and
 * hands the whole sequence to Web Audio at once. Nothing here reacts to a render,
 * counts down, or fires on an interval.
 *
 * Two consequences, and they are the same two `useRevealBeat` already obeys:
 *
 *   - A shared screen that reconnects mid-reveal seeds from `elapsedMs` and
 *     schedules only the beats still ahead of it. It does not re-stamp the truth.
 *   - Any phase can be cut short — everyone submits early, the host skips, the
 *     room pauses. `killAll()` runs on every transition, before the new phase's
 *     cue, so a skipped reveal is not still ticking under the scoreboard.
 *
 * Host device only, gated by the caller. Eight phones chirping would fight the
 * television and the one on hotel wifi is the one everybody hears; the phone
 * confirms with its motor instead (`haptics.js`).
 */

const SOUND_KEY = 'fajil_sound';

// The phases where the press is running. LOBBY and LANDING are not the game, and
// REVEAL is handled below — it wants the bed *off*.
const IN_GAME = new Set(['PROMPT', 'COLLECTING', 'VOTING', 'SCOREBOARD']);

// Only these two phases are a deadline the room can lose to. PROMPT, REVEAL and
// SCOREBOARD are also timed, but their clock is choreography, not pressure.
const TIMED = new Set(['COLLECTING', 'VOTING']);

// How long the press spends coming up to speed into the end of a timed phase.
const RISE_MS = 8000;

// How late a beat may be and still be worth playing — see `sequence`. Wide enough
// to cover a socket hop, a render and a phone that woke up slowly; far narrower
// than the 1500ms the reveal's shortest card is on screen, so a genuine mid-reveal
// reconnect still drops everything the shared screen has already drawn.
const BEAT_GRACE_MS = 600;

/**
 * The sound preference, remembered across games.
 *
 * On by default: this is a party game on a television and the reveal is half the
 * point of the sound, so a host who wants it off will say so once. Deliberately
 * *not* tied to `prefers-reduced-motion` — somebody who turned the animation down
 * still wants to hear the stamp land.
 *
 * A module store rather than state passed down, because the two readers sit at
 * opposite ends of the tree: the router drives the cues, and the toggle lives in
 * the masthead of whichever screen is up. Threading it between them would put a
 * prop on five views to serve one control.
 */
let soundOn = (() => {
  try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch { return true; }
})();
const soundSubs = new Set();

export function setSound(next) {
  if (next === soundOn) return;
  soundOn = next;
  try { localStorage.setItem(SOUND_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  soundSubs.forEach((f) => f());
}

export function useSoundPref() {
  return useSyncExternalStore(
    (f) => { soundSubs.add(f); return () => soundSubs.delete(f); },
    () => soundOn,
    () => true,
  );
}

/** The reveal, as offsets in ms from the moment the reveal began. */
function revealCues(reveal) {
  const s = reveal?.schedule;
  if (!s) return [];

  // Keyed by option id rather than by index. The two lists are built from the same
  // ordered array today, but a sequence that silently mis-pairs is the kind of bug
  // that only shows up as "the stamp landed on the wrong card" in a living room.
  const atOf = new Map(s.beats.map((b) => [b.optionId, b.at]));
  const out = [];

  // The page turning to the corrections.
  out.push({ at: 0, name: 'platen', opts: { level: 1.15 } });

  for (const step of reveal.steps ?? []) {
    const at = atOf.get(step.id);
    if (at == null) continue;

    if (step.truth) {
      // A room that found nothing gets the anti-stamp. The truth still lands, but
      // it lands on a table that got it wrong, and a triumphant sound there reads
      // as the screen enjoying itself at their expense.
      out.push({ at, name: step.voters.length > 0 ? 'stamp' : 'sigh' });
      continue;
    }

    // A lie that took three people down is a louder event than one nobody touched,
    // and the reveal orders them so that gets steadily truer as it goes.
    const bit = Math.min(step.voters.length, 3);
    out.push({ at, name: 'rule', opts: { level: 1 + bit * 0.16 } });
    if (step.points > 0) out.push({ at: at + 260, name: 'slug', opts: { level: 0.65 } });
  }

  // "Why it matters" arriving — the same punctuation, quieter.
  out.push({ at: s.whyAt, name: 'platen', opts: { level: 0.6 } });
  return out;
}

/** The clock running out, as offsets in ms from now. */
function clockCues(left) {
  if (!left || left <= 1200) return [];

  const out = [];
  const riseAt = Math.max(left - RISE_MS, 40);
  out.push({ at: riseAt, name: 'rollRise', opts: { dur: (left - riseAt) / 1000 } });

  for (let s = 5; s >= 1; s -= 1) {
    const at = left - s * 1000;
    if (at > 0) out.push({ at, name: 'bell', opts: { last: s === 1 } });
  }
  return out;
}

export default function useCues({ enabled, state }) {
  const { phase, timing, reveal, lieCount, voteCount, paused } = state;
  const on = !!enabled;

  const prev = useRef({ phase: null, timing: null, lies: 0, votes: 0 });

  useEffect(() => { setMuted(!on); }, [on]);

  /* The bed is the press switched on and left on, so it drops for the reveal —
   * the corrections should land in a room that has just gone quiet — and for game
   * over, so the final edition rings on silence rather than on a hum. */
  useEffect(() => {
    setBed(on && IN_GAME.has(phase) && !paused);
    // The shared screen dropped mid-round. Everything scheduled is about to be
    // wrong: the resume re-stamps the phase and it all gets scheduled again.
    if (paused) killAll();
  }, [on, phase, paused]);

  // ── phase transitions ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!on) return;
    const was = prev.current.phase;
    const wasTiming = prev.current.timing;
    prev.current.phase = phase;
    prev.current.timing = timing;

    /* Only a real phase change resets the counters. `timing` also changes on
     * game:resumed, and resetting there made the next lie_count look like a fresh
     * submission and fire a slug for a player who had already written theirs. */
    if (phase === was) return;
    prev.current.lies = 0;
    prev.current.votes = 0;

    if (!audioReady()) return;

    killAll();

    // Leaving a timed phase is either the room beating the clock or the clock
    // beating the room, and those are different sounds. Both COLLECTING and
    // VOTING end early the moment everyone has acted, which is the quiet case.
    if (TIMED.has(was) && wasTiming?.endsAt) {
      const overrun = remainingMs(wasTiming);
      if (overrun !== null && overrun < 400) cue('deadline');
    }

    if (phase === 'PROMPT') cue('platen', { level: 1.15 });
    else if (phase === 'COLLECTING') cue('platen', { level: 0.7 });
    else if (phase === 'VOTING') { cue('riffle'); cue('platen', { level: 0.8 }); }
    else if (phase === 'SCOREBOARD') cue('platen', { level: 0.85 });
    else if (phase === 'GAME_OVER') cue('finalEdition');
  }, [on, phase, timing]);

  // ── the reveal ─────────────────────────────────────────────────────────────
  //
  // Scheduled once, in full, from the server's own beat schedule. `elapsedMs` is
  // what makes a mid-reveal reconnect land on the card the screen is already on.
  useEffect(() => {
    if (!on || phase !== 'REVEAL' || !reveal?.schedule) return;
    /* Clear this channel first. `killAll()` only runs on a *change* of phase, and
     * the one path that re-delivers `round:reveal` without one is the shared screen
     * reconnecting mid-reveal — which is precisely when a second copy of the
     * sequence would be scheduled on top of the one still playing. */
    kill('reveal');
    sequence(revealCues(reveal), elapsedMs(timing), 'reveal', BEAT_GRACE_MS);
    /* `timing` is read but deliberately not a dependency: it is re-stamped on
     * every resume, and re-running for that would reschedule a sequence that is
     * already correctly in flight. A resume goes through `paused`, which kills it. */
  }, [on, phase, reveal]);

  // ── the clock ──────────────────────────────────────────────────────────────
  //
  // Its own channel because `timing` also changes on game:resumed, which has to
  // reschedule the countdown against the new deadline without silencing the phase
  // cue that just played.
  useEffect(() => {
    if (!on) return;
    kill('clock');
    if (!TIMED.has(phase) || !timing?.endsAt) return;
    sequence(clockCues(remainingMs(timing)), 0, 'clock');
  }, [on, phase, timing]);

  // ── lies filed and votes cast ──────────────────────────────────────────────
  //
  // One per submission, and the last lands at full weight: on the shared screen
  // that is the moment the room has been waiting for.
  useEffect(() => {
    if (!on || phase !== 'COLLECTING') return;
    const { count = 0, total = 0 } = lieCount ?? {};
    if (count <= prev.current.lies) { prev.current.lies = count; return; }
    prev.current.lies = count;
    cue('slug', { level: total && count === total ? 1 : 0.55 });
  }, [on, phase, lieCount]);

  useEffect(() => {
    if (!on || phase !== 'VOTING') return;
    const { count = 0, total = 0 } = voteCount ?? {};
    if (count <= prev.current.votes) { prev.current.votes = count; return; }
    prev.current.votes = count;
    cue('ballot', { level: total && count === total ? 1.5 : 1 });
  }, [on, phase, voteCount]);

  // Autoplay needs a gesture, and the host clicks "Open the room" and then "Start
  // the game" before a single cue is due. Arming on any click means the platen
  // that opens round one — the first sound of the night, and the one that sets the
  // tone — is never the one that gets swallowed.
  useEffect(() => {
    if (!enabled) return undefined;
    const arm = () => unlockAudio();
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, [enabled]);

  useEffect(() => () => { killAll(); setBed(false); }, []);
}
