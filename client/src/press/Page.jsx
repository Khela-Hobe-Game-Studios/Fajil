/**
 * The page furniture: the sheet, the masthead, and the rules that separate things.
 *
 * Both roles use these. The shared screen and the phone are the same newspaper at
 * different column widths, so there is no host-only or phone-only primitive here.
 */

export function Page({ children, className = '' }) {
  return <div className={`pr-page ${className}`}>{children}</div>;
}

export function PageBody({ children, className = '' }) {
  return <div className={`pr-body ${className}`}>{children}</div>;
}

/**
 * The masthead.
 *
 * `left` is the nameplate, `right` is the dateline furniture — the room code, the
 * round, the clock. It wraps rather than truncating: on a narrow phone the dateline
 * drops under the nameplate, which is what a real narrow-column masthead does.
 */
export function Masthead({ children, right }) {
  return (
    <header className="pr-masthead">
      {children}
      {right ? <div className="pr-dateline">{right}</div> : null}
    </header>
  );
}

export function Nameplate({ sub = 'the bluffing game', size }) {
  return (
    <div className="pr-nameplate" style={size ? { fontSize: size } : undefined}>
      FAJIL
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

export function Kicker({ children, ink = false, className = '' }) {
  return (
    <div className={`pr-kicker ${ink ? 'pr-kicker--ink' : ''} ${className}`}>{children}</div>
  );
}

export function Rule({ variant = 'thin' }) {
  const cls = variant === 'thick' ? 'pr-rule-thick' : variant === 'double' ? 'pr-rule-double' : 'pr-rule';
  return <hr className={cls} />;
}

/**
 * A prompt, with its blank set as an actual blank.
 *
 * The bank writes prompts as "Bangladesh's national fruit is the ___." Rendering
 * that string raw puts three underscores in a headline, which reads as a rendering
 * bug rather than as a space to fill. Splitting on the token and drawing a ruled
 * gap is the difference between a fill-in-the-blank and a typo.
 */
export function Prompt({ text, className = '' }) {
  const parts = String(text ?? '').split('___');
  return (
    <h1 className={`pr-headline ${className}`}>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? <span className="pr-blank" aria-label="blank" /> : null}
        </span>
      ))}
    </h1>
  );
}
