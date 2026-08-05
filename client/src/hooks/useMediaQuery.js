import { useEffect, useState } from 'react';

/**
 * The one breakpoint this app has an opinion about: is this device plausibly the
 * shared screen? It only ever seeds the landing's suggestion — nothing about the
 * layout depends on it, because the page is fluid rather than switched.
 */
export const WIDE = '(min-width: 900px)';

/**
 * matchMedia as state.
 *
 * Reads on mount and then follows the query, which is the point: sampling
 * window.innerWidth in a useState initialiser means a browser dragged narrow, or a
 * tablet turned over, never changes its mind.
 */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    // Re-read on subscribe: the viewport can have changed between the initialiser
    // and this effect, and under StrictMode it reliably has.
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
