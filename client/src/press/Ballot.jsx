/**
 * The ballot — the shuffled options the room votes on.
 *
 * Used by the shared screen (read-only, for the room to read together) and by the
 * phone (tappable). One component, because the two must agree letter-for-letter:
 * players call options out by their letter across the room, and a screen that
 * lettered them differently from the phones would make that impossible.
 */

// Ambiguity-free and long enough for the worst case: eight players' lies plus the
// truth is nine options. 'I' is omitted because it is read as a 1 across a room.
const LETTERS = 'ABCDEFGHJKMN';

export function Ballot({ options, onPick, chosen, ownId, disabled = false, single = false }) {
  // The shared screen is not an input. It used to render the same buttons with no
  // handler, which made every one of them `:disabled` — so the whole board wore the
  // "this is your own lie" hatching and the room was asked to vote on nine options
  // that all looked struck out.
  const readOnly = !onPick;

  return (
    <ul className={`pr-ballot ${single ? 'pr-ballot--single' : ''}`}>
      {options.map((o, i) => {
        const isOwn = o.id === ownId;
        const letter = LETTERS[i] ?? String(i + 1);
        const body = (
          <>
            <span className="pr-ballot-letter" aria-hidden="true">{letter}</span>
            <span>{o.text}</span>
          </>
        );

        if (readOnly) {
          return (
            <li key={o.id}>
              <div className="pr-ballot-item" data-testid={`option-${o.id}`}>{body}</div>
            </li>
          );
        }

        return (
          <li key={o.id}>
            <button
              type="button"
              className={`pr-ballot-item ${isOwn ? 'pr-ballot-item--own' : ''}`}
              // Your own lie is shown but never selectable. Removing it would make
              // the board a different length for you than for everyone else, and
              // the room refers to options by letter out loud.
              disabled={disabled || isOwn}
              aria-pressed={o.id === chosen}
              onClick={() => onPick(o.id)}
              data-testid={`option-${o.id}`}
            >
              {body}
              {isOwn ? <span className="pr-sr">— your own lie, not selectable</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export { LETTERS };
