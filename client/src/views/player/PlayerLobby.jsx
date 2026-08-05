import { Page, PageBody, Masthead, Nameplate, Kicker, Chip, playerInk } from '../../press';

/**
 * Waiting for the host to start.
 *
 * The player's own colour is the whole header, because that colour is how they will
 * find themselves on the shared screen for the rest of the game — learning it here
 * is worth more than anything else this screen could say.
 */
export default function PlayerLobby({ state }) {
  const me = state.me;
  const others = (state.players ?? []).filter((p) => p.id !== me?.id);

  return (
    <Page>
      <Masthead right={<><span>Room</span><b>{state.code}</b></>}>
        <Nameplate sub="you're in" />
      </Masthead>

      <PageBody className="pl-lobby">
        <div className="pl-me" style={{ '--chip': playerInk(me?.colorIndex) }}>
          <span className="pl-me-dot" />
          <span className="pl-me-name">{me?.name}</span>
        </div>

        <p className="pr-subhead pl-wait">
          Waiting for the game to start. Keep this page open.
        </p>

        <div className="pl-others">
          <Kicker ink>Also here ({others.length})</Kicker>
          <ul className="pl-chip-list">
            {others.map((p) => (
              <li key={p.id}>
                <Chip name={p.name} colorIndex={p.colorIndex} state={p.connectionState} />
              </li>
            ))}
          </ul>
        </div>
      </PageBody>
    </Page>
  );
}
