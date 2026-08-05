import { useEffect, useState } from 'react';
import { elapsedMs } from './clock';

/**
 * Plays the reveal schedule the server sent.
 *
 * The screen computes nothing about the sequence — it is handed a list of beat
 * offsets and asks the clock which of them have passed. Two things fall out of
 * that: the shared screen and every phone show the same card at the same moment,
 * and a phone that rejoins eight seconds into a reveal seeds from `startedAt` and
 * lands on the right beat instead of replaying the whole sequence from zero.
 *
 * Returns how many option cards are showing, which one is landing right now, and
 * whether the "why it matters" panel has arrived.
 */
export function useRevealBeat(timing, schedule) {
  const [now, setNow] = useState(() => elapsedMs(timing));

  useEffect(() => {
    if (!schedule) return undefined;

    let cancelled = false;
    let timer;

    const tick = () => {
      if (cancelled) return;
      const elapsed = elapsedMs(timing);
      setNow(elapsed);

      // Sleep until the next moment something actually changes, rather than
      // running an interval. Nothing here animates between beats, so a 60fps
      // ticker would be eight phones burning battery to render the same frame.
      const marks = [...schedule.beats.map((b) => b.at), schedule.whyAt, schedule.total];
      const next = marks.find((m) => m > elapsed);
      if (next === undefined) return;
      timer = setTimeout(tick, Math.max(16, next - elapsed));
    };

    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [timing, schedule]);

  if (!schedule) return { shown: 0, activeIndex: -1, showWhy: false };

  const shown = schedule.beats.filter((b) => b.at <= now).length;
  return {
    shown,
    activeIndex: shown - 1,
    showWhy: now >= schedule.whyAt,
  };
}
