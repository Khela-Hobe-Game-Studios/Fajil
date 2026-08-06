import { useEffect, useRef } from 'react';
import {
  Page, PageBody, Masthead, Nameplate, Kicker, Rule, Prompt, Chip, Stamp, Btn,
} from '../../press';
import { useRevealBeat } from '../../game/revealBeats';

/**
 * The reveal.
 *
 * The round's payoff, and the one screen worth real design attention. It plays the
 * beat schedule the server sent and computes nothing about the sequence itself:
 * the lies nobody fell for go first and go fast, the ones that landed follow in
 * ascending order of damage, and the truth is last. A phone that rejoins mid-reveal
 * seeds from the same clock and lands on the same card.
 */
export default function HostReveal({ state, actions }) {
  const r = state.reveal;
  const { shown, activeIndex, showWhy } = useRevealBeat(state.timing, r?.schedule);
  if (!r) return null;

  return (
    <Page>
      <Masthead right={<><span>Room</span><b>{state.code}</b><span>Round</span><b>{r.round}/{r.of}</b></>}>
        <Nameplate sub="the corrections" />
      </Masthead>

      <PageBody className="hs-reveal">
        <div className="hs-reveal-head">
          <Kicker>The question was</Kicker>
          <Prompt text={r.prompt} className="hs-reveal-prompt" />
        </div>
        <Rule variant="double" />

        <ul className="hs-cards pr-scroll">
          {r.steps.slice(0, shown).map((s, i) => (
            <RevealCard key={s.id} step={s} active={i === activeIndex} showWhy={showWhy} />
          ))}
        </ul>


        {showWhy ? (
          <div className="hs-why pr-why pr-anim-slam">
            <Kicker>Why it matters</Kicker>
            <p className="pr-article">{r.why}</p>
          </div>
        ) : null}

        <div className="hs-round-foot">
          <Btn variant="ghost" onClick={actions.skip} data-testid="skip">Skip ahead</Btn>
        </div>
      </PageBody>
    </Page>
  );
}

function RevealCard({ step, active, showWhy }) {
  const { truth, house, authors, voters, points } = step;
  const ref = useRef(null);

  /**
   * Keep the card that just landed in view.
   *
   * At eight players the reveal is nine cards, which cannot fit a screen at a size
   * anyone can read across a room — so the list scrolls and follows the beat. Left
   * to itself the payoff happens below the fold and the room watches a static page
   * while the interesting part is off-screen.
   *
   * `showWhy` is a dependency because the "why it matters" panel appears *after*
   * the last card and takes height from this list. Without re-scrolling, the truth
   * card slid out of view at the exact moment the round was being explained — the
   * answer off-screen underneath a paragraph about the answer.
   */
  useEffect(() => {
    if (!active || !ref.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  }, [active, showWhy]);

  return (
    <li
      ref={ref}
      className={[
        'hs-card',
        truth ? 'hs-card--truth' : '',
        active ? 'hs-card--active' : '',
        'pr-anim-slam',
      ].filter(Boolean).join(' ')}
      data-testid={truth ? 'reveal-truth' : 'reveal-lie'}
    >
      <div className="hs-card-main">
        <div className="hs-card-text">{step.text}</div>
        {truth ? <Stamp animate>The truth</Stamp> : null}
      </div>

      <div className="hs-card-meta">
        {/* Who wrote it. The house takes the blame for an absent player's filler —
            naming somebody for a lie they did not write is a small unfairness the
            room notices immediately. */}
        {truth ? (
          <span className="hs-card-by">The real answer</span>
        ) : house ? (
          <span className="hs-card-by hs-card-by--house">The house wrote this</span>
        ) : (
          <span className="hs-card-by">
            <span className="hs-card-by-label">Filed by</span>
            {authors.map((a) => (
              <Chip key={a.id} name={a.name} colorIndex={a.colorIndex} />
            ))}
          </span>
        )}

        <span className="hs-card-victims">
          {voters.length === 0 ? (
            <em className="hs-nobody">{truth ? 'Nobody found it' : 'Nobody fell for it'}</em>
          ) : (
            <>
              <span className="hs-card-by-label">{truth ? 'Found by' : 'Fooled'}</span>
              {voters.map((v) => (
                <Chip key={v.id} name={v.name} colorIndex={v.colorIndex} />
              ))}
            </>
          )}
        </span>

        {points > 0 ? (
          <span className={`hs-card-points ${truth ? 'hs-card-points--truth' : ''}`}>
            +{points.toLocaleString()}
          </span>
        ) : null}
      </div>
    </li>
  );
}
