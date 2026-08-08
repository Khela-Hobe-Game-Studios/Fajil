import { useEffect, useState } from 'react';
import useGameSocket from './game/useGameSocket';
import useCues, { useSoundPref } from './game/useCues';
import useHaptics from './game/haptics';
import { JOIN_CODE, loadSession } from './session';
import useMediaQuery, { WIDE } from './hooks/useMediaQuery';

import HostLanding from './views/host/HostLanding';
import HostLobby from './views/host/HostLobby';
import HostRound from './views/host/HostRound';
import HostReveal from './views/host/HostReveal';
import HostStandings from './views/host/HostStandings';

import PlayerJoin from './views/player/PlayerJoin';
import PlayerLobby from './views/player/PlayerLobby';
import PlayerRound from './views/player/PlayerRound';
import PlayerResult from './views/player/PlayerResult';
import { ConnectionBanner, PausedOverlay } from './views/Shared';

/**
 * The router.
 *
 * Two branches — the shared screen and the phone — and one decision about which
 * you are on. That decision is a *suggestion* until you act on it: the landing
 * offers whichever side the viewport implies, and the other one is always one tap
 * away, because a guess about a device is not a fact about a person.
 */
export default function App() {
  const [state, actions] = useGameSocket();
  const wide = useMediaQuery(WIDE);

  // Restored before the socket answers, so a refresh mid-game paints the right
  // side of the app immediately instead of flashing the landing page first.
  const [side, setSide] = useState(() => {
    if (JOIN_CODE) return 'player';
    return loadSession()?.role ?? null;
  });

  useEffect(() => {
    if (state.role) setSide(state.role);
  }, [state.role]);

  const chosen = side ?? (wide ? 'host' : 'player');

  /* Sound is the shared screen's and haptics are the phone's, so both hang off the
   * one decision about which side this device is. Wired here rather than inside
   * the screens because a cue belongs to a phase, not to a view: hanging them off
   * mounts would fire the reveal's sequence again every time a card re-rendered,
   * and would lose the transition entirely on the phases that share a component. */
  const sound = useSoundPref();
  useCues({ enabled: sound && chosen === 'host', state });
  useHaptics({ enabled: chosen === 'player', state });

  const shell = (children) => (
    <>
      <ConnectionBanner state={state} />
      {children}
      {state.paused && state.phase !== 'LOBBY' && state.phase !== 'GAME_OVER'
        ? <PausedOverlay isHost={chosen === 'host'} />
        : null}
    </>
  );

  if (chosen === 'host') {
    switch (state.phase) {
      case 'LANDING':
        return shell(<HostLanding state={state} actions={actions} onSwitch={() => setSide('player')} />);
      case 'LOBBY':
        return shell(<HostLobby state={state} actions={actions} />);
      case 'PROMPT':
      case 'COLLECTING':
      case 'VOTING':
        return shell(<HostRound state={state} actions={actions} />);
      case 'REVEAL':
        return shell(<HostReveal state={state} actions={actions} />);
      case 'SCOREBOARD':
      case 'GAME_OVER':
        return shell(<HostStandings state={state} actions={actions} />);
      default:
        return shell(<HostLanding state={state} actions={actions} onSwitch={() => setSide('player')} />);
    }
  }

  switch (state.phase) {
    case 'LANDING':
      return shell(<PlayerJoin state={state} actions={actions} onSwitch={() => setSide('host')} />);
    case 'LOBBY':
      return shell(<PlayerLobby state={state} actions={actions} />);
    case 'PROMPT':
    case 'COLLECTING':
    case 'VOTING':
      return shell(<PlayerRound state={state} actions={actions} />);
    case 'REVEAL':
    case 'SCOREBOARD':
    case 'GAME_OVER':
      return shell(<PlayerResult state={state} actions={actions} />);
    default:
      return shell(<PlayerJoin state={state} actions={actions} onSwitch={() => setSide('host')} />);
  }
}
