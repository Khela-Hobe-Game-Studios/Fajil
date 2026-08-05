/**
 * The ballot — the shuffled options the room votes on.
 *
 * Used by the shared screen (read-only, for the room to read together) and by the
 * phone (tappable). One component, because the two must agree letter-for-letter:
 * players call options out by their letter across the room, and a screen that
 * lettered them differently from the phones would make that impossible.
 */

const LETTERS = 'ABCDEFGH';

export function Ballot({ options, onPick, chosen, ownId, disabled = false, single = false }) {
  return (
    <ul className={`pr-ballot ${single ? 'pr-ballot--single' : ''}`}>
      {options.map((o, i) => {
        const isOwn = o.id === ownId;
        const isChosen = o.id === chosen;
        return (
          <li key={o.id}>
            <button
              type="button"
              className="pr-ballot-item"
              // Your own lie is shown but never selectable. Removing it would make
              // the board a different length for you than for everyone else, and
              // the room refers to options by letter out loud.
              disabled={disabled || isOwn || !onPick}
              aria-pressed={onPick ? isChosen : undefined}
              onClick={onPick ? () => onPick(o.id) : undefined}
              data-testid={`option-${o.id}`}
            >
              <span className="pr-ballot-letter" aria-hidden="true">{LETTERS[i] ?? i + 1}</span>
              <span>{o.text}</span>
              {isOwn ? <span className="pr-sr">— your own lie, not selectable</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export { LETTERS };
