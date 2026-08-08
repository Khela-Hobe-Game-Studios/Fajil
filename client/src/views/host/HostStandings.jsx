import {
  Page, PageBody, Masthead, Nameplate, Kicker, Rule, Btn, Score, playerInk, Stamp,
} from '../../press';
import { SoundToggle } from '../Shared';

/**
 * The scoreboard between rounds, and the final table.
 *
 * One component: the final standings are the same table with the winner set as a
 * headline. A separate game-over screen means two layouts to keep in step, and the
 * one everybody sees least is the one that rots.
 */
export default function HostStandings({ state, actions }) {
  const isFinal = state.phase === 'GAME_OVER';
  const data = isFinal ? state.final : state.scoreboard;
  if (!data) return null;

  const rows = data.standings ?? [];
  const winner = isFinal ? rows[0] : null;
  // A shared win is a real outcome and the copy has to survive it.
  const tied = isFinal ? rows.filter((r) => r.score === winner?.score) : [];

  return (
    <Page>
      <Masthead
        right={
          isFinal
            ? <><span>Final</span><b>{data.rounds} rounds</b><SoundToggle /></>
            : <><span>Room</span><b>{state.code}</b><span>Round</span><b>{data.round}/{data.of}</b><SoundToggle /></>
        }
      >
        <Nameplate sub={isFinal ? 'final edition' : 'the standings'} />
      </Masthead>

      <PageBody className="hs-standings">
        {isFinal && winner ? (
          <div className="hs-winner">
            <Kicker>{tied.length > 1 ? 'It’s a dead heat' : 'Tonight’s champion liar'}</Kicker>
            <h1 className="pr-headline pr-headline--red hs-winner-name">
              {tied.length > 1 ? tied.map((t) => t.name).join(' & ') : winner.name}
            </h1>
            <p className="pr-subhead">
              {tied.length > 1
                ? `Level on ${winner.score.toLocaleString()} points.`
                : `${winner.score.toLocaleString()} points, and a great deal of nerve.`}
            </p>
          </div>
        ) : (
          <Kicker>After round {data.round}</Kicker>
        )}

        <Rule variant="double" />

        <ol className="hs-table pr-scroll">
          {rows.map((row, i) => (
            <li
              key={row.id}
              className={`hs-row ${isFinal && i === 0 ? 'hs-row--first' : ''}`}
              style={{ '--chip': playerInk(row.colorIndex) }}
            >
              <span className="hs-rank pr-num">{i + 1}</span>
              <span className="hs-row-dot" />
              <span className="hs-row-name">
                {row.name}
                {row.connectionState === 'dropped' ? <em className="hs-row-gone"> — dropped</em> : null}
              </span>

              {/* "You knew it" — the player typed the real answer into the lie box.
                  Worth no points on purpose, so knowing the answer never becomes a
                  reason to skip lying. It is worth a badge. */}
              {isFinal && row.knewIt > 0 ? (
                <Stamp tone="blue" className="hs-knew">
                  Knew it ×{row.knewIt}
                </Stamp>
              ) : null}

              {!isFinal && row.gained > 0 ? (
                <span className="pr-gain hs-row-gain">+{row.gained.toLocaleString()}</span>
              ) : null}
              <Score value={row.score} />
            </li>
          ))}
        </ol>

        <div className="hs-round-foot">
          {isFinal ? (
            <>
              <Btn variant="red" onClick={actions.playAgain} data-testid="play-again">Play again</Btn>
              <Btn variant="ghost" onClick={actions.leave}>Close the room</Btn>
            </>
          ) : (
            <>
              <Btn variant="ghost" onClick={actions.skip} data-testid="skip">
                {data.last ? 'To the final table' : 'Next round'}
              </Btn>
              <Btn variant="ghost" onClick={actions.endGame}>End game</Btn>
            </>
          )}
        </div>
      </PageBody>
    </Page>
  );
}
