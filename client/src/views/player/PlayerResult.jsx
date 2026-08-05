import {
  Page, PageBody, Masthead, Nameplate, Kicker, Rule, Stamp, Score, Btn, playerInk,
} from '../../press';

/**
 * The phone during the reveal, the standings and the final table.
 *
 * The reveal itself belongs to the shared screen — this says only what a player
 * cannot read from across the room: what *they* scored, and why. Mirroring the
 * whole choreography onto eight phones would have the room looking down at the
 * exact moment the joke lands.
 */
export default function PlayerResult({ state, actions }) {
  const { phase } = state;
  if (phase === 'REVEAL') return <MyRound state={state} />;
  if (phase === 'GAME_OVER') return <FinalTable state={state} actions={actions} />;
  return <Standings state={state} />;
}

function MyRound({ state }) {
  const r = state.reveal;
  const me = state.me?.id;
  if (!r) return null;

  const gained = r.gains?.[me] ?? 0;
  const truthStep = r.steps.find((s) => s.truth);
  const foundIt = truthStep?.voters.some((v) => v.id === me);
  const mine = r.steps.find((s) => s.authors?.some((a) => a.id === me));
  const fooled = mine?.voters.length ?? 0;

  return (
    <Page>
      <Masthead right={<><span>Round</span><b>{r.round}/{r.of}</b></>}>
        <Nameplate sub={state.me?.name} />
      </Masthead>

      <PageBody className="pl-result">
        <div className="pl-verdict">
          {foundIt
            ? <Stamp animate>You found it</Stamp>
            : <Stamp tone="ink" animate>Fooled</Stamp>}
        </div>

        <p className="pr-article pl-answer">
          The answer was <b>{r.answer}</b>.
        </p>

        {mine ? (
          <p className="pr-article">
            {fooled === 0
              ? 'Nobody fell for your lie this time.'
              : `Your lie caught ${fooled} ${fooled === 1 ? 'player' : 'players'}.`}
          </p>
        ) : null}

        <Rule variant="double" />
        <div className="pl-gain">
          <Kicker ink>This round</Kicker>
          <span className="pr-num pl-gain-num">
            {gained > 0 ? `+${gained.toLocaleString()}` : '0'}
          </span>
        </div>
      </PageBody>
    </Page>
  );
}

function Standings({ state }) {
  const data = state.scoreboard;
  if (!data) return null;
  const me = state.me?.id;

  return (
    <Page>
      <Masthead right={<><span>Round</span><b>{data.round}/{data.of}</b></>}>
        <Nameplate sub="the standings" />
      </Masthead>

      <PageBody className="pl-result">
        <ol className="pl-table pr-scroll">
          {data.standings.map((row, i) => (
            <li
              key={row.id}
              className={`pl-row ${row.id === me ? 'pl-row--me' : ''}`}
              style={{ '--chip': playerInk(row.colorIndex) }}
            >
              <span className="pl-rank pr-num">{i + 1}</span>
              <span className="pl-row-dot" />
              <span className="pl-row-name">{row.name}</span>
              {row.gained > 0 ? <span className="pr-gain">+{row.gained.toLocaleString()}</span> : null}
              <Score value={row.score} />
            </li>
          ))}
        </ol>
      </PageBody>
    </Page>
  );
}

function FinalTable({ state, actions }) {
  const data = state.final;
  if (!data) return null;
  const me = state.me?.id;
  const mine = data.standings.find((r) => r.id === me);

  return (
    <Page>
      <Masthead right={<><span>Final</span><b>{data.rounds} rounds</b></>}>
        <Nameplate sub="final edition" />
      </Masthead>

      <PageBody className="pl-result">
        {mine ? (
          <div className="pl-final-me">
            <Kicker>You finished</Kicker>
            <span className="pr-num pl-final-rank">#{mine.rank}</span>
            <Score value={mine.score} />
            {mine.knewIt > 0 ? <Stamp tone="blue">Knew it ×{mine.knewIt}</Stamp> : null}
          </div>
        ) : null}

        <Rule variant="double" />

        <ol className="pl-table pr-scroll">
          {data.standings.map((row) => (
            <li
              key={row.id}
              className={`pl-row ${row.id === me ? 'pl-row--me' : ''}`}
              style={{ '--chip': playerInk(row.colorIndex) }}
            >
              <span className="pl-rank pr-num">{row.rank}</span>
              <span className="pl-row-dot" />
              <span className="pl-row-name">{row.name}</span>
              <Score value={row.score} />
            </li>
          ))}
        </ol>

        <Btn variant="ghost" block onClick={actions.leave}>Leave the room</Btn>
      </PageBody>
    </Page>
  );
}
