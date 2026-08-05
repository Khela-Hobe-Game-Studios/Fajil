import { useCountdown } from '../game/clock';

/** Player ink. Eight stamps, matching --p0..--p7 in tokens.css. */
export function playerInk(colorIndex) {
  return `var(--p${((colorIndex ?? 0) % 8 + 8) % 8})`;
}

export function Btn({ children, variant, block, ...rest }) {
  const cls = [
    'pr-btn',
    variant === 'red' ? 'pr-btn--red' : '',
    variant === 'ghost' ? 'pr-btn--ghost' : '',
    block ? 'pr-btn--block' : '',
  ].filter(Boolean).join(' ');
  return <button type="button" className={cls} {...rest}>{children}</button>;
}

export function Stamp({ children, tone = 'red', animate = false, className = '' }) {
  const cls = [
    'pr-stamp',
    tone === 'blue' ? 'pr-stamp--blue' : '',
    tone === 'ink' ? 'pr-stamp--ink' : '',
    animate ? 'pr-anim-stamp' : '',
    className,
  ].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}

/**
 * A player, as a named colour block.
 *
 * `state` drives the two ways a player can be not-here. `reconnecting` pulses,
 * because the room should be able to see that a phone is on its way back rather
 * than assume somebody walked out; `dropped` is struck through but still present,
 * since a mid-game drop keeps its seat and its score.
 */
export function Chip({ name, colorIndex, state = 'connected', suffix }) {
  const cls = [
    'pr-chip',
    state === 'dropped' ? 'pr-chip--out' : '',
    state === 'reconnecting' ? 'pr-chip--wait' : '',
  ].filter(Boolean).join(' ');
  return (
    <span className={cls} style={{ '--chip': playerInk(colorIndex) }}>
      <span className="pr-chip-dot" />
      <span className="pr-chip-name">{name}</span>
      {suffix != null ? <b className="pr-num">{suffix}</b> : null}
    </span>
  );
}

export function Num({ children, className = '' }) {
  return <span className={`pr-num ${className}`}>{children}</span>;
}

export function Score({ value }) {
  return <span className="pr-num pr-score">{(value ?? 0).toLocaleString()}</span>;
}

/**
 * The phase clock.
 *
 * Reads `timing` — the four server-stamped fields every phase carries — rather than
 * a number of seconds, so a device that slept through half a phase shows the right
 * number the moment it wakes. Renders nothing at all for a phase with no clock.
 */
export function Clock({ timing, urgentAt = 10 }) {
  const left = useCountdown(timing);
  if (left === null) return null;
  return (
    <span className={`pr-clock ${left <= urgentAt ? 'pr-clock--urgent' : ''}`}>
      <span aria-hidden="true">{left}</span>
      <span className="pr-sr">{left} seconds left</span>
    </span>
  );
}

/** How many of the room have acted. Not a timer — a headcount. */
export function Meter({ count, total }) {
  const pct = total > 0 ? Math.min(100, (count / total) * 100) : 0;
  return (
    <div
      className="pr-meter"
      role="progressbar"
      aria-valuenow={count}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${count} of ${total} in`}
    >
      <div className="pr-meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
