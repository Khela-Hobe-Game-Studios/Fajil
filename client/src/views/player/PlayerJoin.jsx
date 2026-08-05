import { useState } from 'react';
import { Page, PageBody, Masthead, Nameplate, Kicker, Btn } from '../../press';
import { JOIN_CODE } from '../../session';
import { ErrorNote } from '../Shared';

/**
 * The phone's front door.
 *
 * Two fields and one button. A code arriving from a scanned QR fills itself in, so
 * the common path is: scan, type your name, play.
 */
export default function PlayerJoin({ state, actions, onSwitch }) {
  const [code, setCode] = useState(JOIN_CODE);
  const [name, setName] = useState('');

  const ready = code.trim().length === 4 && name.trim().length > 0 && state.connected;

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    actions.join(code.trim().toUpperCase(), name.trim());
  };

  return (
    <Page>
      <Masthead><Nameplate sub="the bluffing game" /></Masthead>

      <PageBody className="pl-join">
        <ErrorNote message={state.error} onDismiss={actions.clearError} />

        <form className="pl-form" onSubmit={submit}>
          <label className="pl-label">
            <Kicker ink>Room code</Kicker>
            <input
              className="pr-input pl-code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="ADDA"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={4}
              data-testid="join-code"
            />
          </label>

          <label className="pl-label">
            <Kicker ink>Your name</Kicker>
            <input
              className="pr-input"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 16))}
              placeholder="Rumi"
              autoComplete="given-name"
              maxLength={16}
              data-testid="join-name"
            />
          </label>

          <Btn variant="red" block type="submit" disabled={!ready} data-testid="join-submit">
            {state.connected ? 'Join the room' : 'Connecting…'}
          </Btn>
        </form>

        <div className="pl-switch">
          <Btn variant="ghost" onClick={onSwitch}>I'm the big screen</Btn>
        </div>
      </PageBody>
    </Page>
  );
}
