import { useEffect, useRef } from 'react';

/**
 * The phone's half of the cue system.
 *
 * The shared screen is the only audio source — eight phones chirping would fight
 * the television, and the one a beat behind on hotel wifi is the one everybody
 * hears. So the phone answers with the motor instead: the same acknowledgement,
 * no acoustic conflict, and it works with the ringer off, which is how a phone is
 * carried to a party.
 *
 * Two of these are not confirmations but summonses. A phone spends most of a round
 * face-down on the table while its owner watches the television, and the two
 * moments it has to be picked up — the box opening for a lie, the ballot going up
 * — are exactly the moments nothing on the phone is being looked at. That is worth
 * more here than any of the taps.
 *
 * Silently absent on iOS Safari, which has never implemented the Vibration API.
 * Progressive enhancement rather than something to polyfill: nothing here is the
 * only feedback for anything, and every one of these moments is also a full screen
 * change the player will see the instant they look.
 */

const can = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

const PATTERNS = {
  write: [18, 60, 18],     // the box is open — pick the phone up
  vote: [14, 45, 14, 45, 14], // the ballot is up — pick the phone up
  filed: [12, 28, 20],     // your lie is in
  cast: 16,                // your vote is in
  knew: [30, 70, 30, 70, 60], // you typed the real answer, privately
};

function buzz(kind) {
  if (!can) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* some browsers gate this behind engagement; there is nothing to recover */
  }
}

/**
 * Binds the phone's motor to the same reducer state the screens read.
 *
 * Driven off state rather than off the tap handlers on purpose: a submission is
 * only real once the server has accepted it, and buzzing on the tap would confirm
 * a lie that a rate limit or a closed phase is about to refuse.
 */
export default function useHaptics({ enabled, state }) {
  const { phase, lieSubmitted, myVote, notice } = state;
  const on = can && !!enabled;
  const prev = useRef({ phase: null, filed: false, voted: null, notice: null });

  useEffect(() => {
    if (!on) return;
    if (phase === prev.current.phase) return;
    const was = prev.current.phase;
    prev.current.phase = phase;
    // Not on a mid-game reconnect: `player:joined` lands the player straight into
    // whatever phase the room is already in, and a phone that just came back
    // should not buzz for a box it may have already filled.
    if (was === null) return;
    if (phase === 'COLLECTING') buzz('write');
    else if (phase === 'VOTING') buzz('vote');
  }, [on, phase]);

  useEffect(() => {
    if (!on) return;
    const was = prev.current.filed;
    prev.current.filed = lieSubmitted;
    if (lieSubmitted && !was) buzz('filed');
  }, [on, lieSubmitted]);

  useEffect(() => {
    if (!on) return;
    const was = prev.current.voted;
    prev.current.voted = myVote;
    if (myVote && myVote !== was) buzz('cast');
  }, [on, myVote]);

  // The truth collision. It scores nothing by design, so the phone is most of what
  // marks it at all until the badge shows up on the final standings.
  useEffect(() => {
    if (!on) return;
    const kind = notice?.kind ?? null;
    const was = prev.current.notice;
    prev.current.notice = kind;
    if (kind === 'knew' && was !== 'knew') buzz('knew');
  }, [on, notice]);
}
