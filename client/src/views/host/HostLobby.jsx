import { Page, PageBody, Masthead, Nameplate, Kicker, Rule, Btn, Chip } from '../../press';
import JoinQR from '../../components/JoinQR';
import { ErrorNote } from '../Shared';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

/**
 * The lobby — a front page with the room code as the headline.
 *
 * The code is the single most important thing on this screen and is sized like it:
 * it is being read aloud across a room by someone holding a phone at arm's length.
 */
export default function HostLobby({ state, actions }) {
  const players = state.players ?? [];
  const enough = players.length >= MIN_PLAYERS;
  const full = players.length >= MAX_PLAYERS;

  return (
    <Page>
      <Masthead right={<><span>Room</span><b>{state.code}</b></>}>
        <Nameplate sub="the bluffing game" />
      </Masthead>

      <PageBody className="hs-lobby">
        <ErrorNote message={state.error} onDismiss={actions.clearError} />

        <div className="hs-lobby-grid">
          <section className="hs-join">
            <Kicker>Join the room</Kicker>
            <div className="hs-code" data-testid="room-code">{state.code}</div>
            <p className="pr-article hs-join-how">
              Open this page on your phone and enter the code — or scan.
            </p>
            <JoinQR code={state.code} />
          </section>

          <section className="hs-roster">
            <div className="pr-row pr-row--between">
              <Kicker ink>In the room</Kicker>
              <span className="pr-num hs-roster-count">
                {players.length}<span className="hs-roster-max">/{MAX_PLAYERS}</span>
              </span>
            </div>
            <Rule variant="double" />

            {players.length === 0 ? (
              <p className="pr-article hs-empty">Waiting for the first player…</p>
            ) : (
              <ul className="hs-roster-list pr-scroll">
                {players.map((p) => (
                  <li key={p.id}>
                    <Chip name={p.name} colorIndex={p.colorIndex} state={p.connectionState} />
                  </li>
                ))}
              </ul>
            )}

            {full ? (
              <p className="hs-field-note">
                Room is full. Eight is the cap — past that, nobody can read eight lies and
                still vote in time.
              </p>
            ) : null}
          </section>
        </div>

        <Rule variant="double" />

        <div className="hs-lobby-go">
          <div className="hs-settings-summary">
            <span><b>{state.settings.rounds}</b> rounds</span>
            <span><b>{state.settings.lieSeconds}s</b> to lie</span>
            <span className="hs-deck-name">{state.settings.deck}</span>
          </div>
          <Btn variant="red" disabled={!enough} onClick={actions.start} data-testid="start-game">
            {enough ? 'Start the game' : `Need ${MIN_PLAYERS - players.length} more`}
          </Btn>
        </div>
      </PageBody>
    </Page>
  );
}
