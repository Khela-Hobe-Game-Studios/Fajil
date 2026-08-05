import { useState } from 'react';
import { Page, PageBody, Masthead, Nameplate, Kicker, Rule, Btn } from '../../press';
import { ErrorNote } from '../Shared';

const ROUNDS = [3, 5, 7];
const SECONDS = [45, 60, 90];
const DECKS = [
  { id: 'mixed', label: 'Mixed', note: 'Alternates home and diaspora questions round by round' },
  { id: 'desh', label: 'Desh', note: 'Bangladesh — the country, its food, its history' },
  { id: 'probash', label: 'Probash', note: 'The diaspora — Brick Lane, Jackson Heights, Sunday Bangla school' },
];

/**
 * The front door for the shared screen.
 *
 * Settings are chosen before the room opens rather than buried behind it, because
 * the host is standing at a television with people watching and every extra screen
 * is a pause in the party. They stay editable in the lobby.
 */
export default function HostLanding({ state, actions, onSwitch }) {
  const [settings, setSettings] = useState(state.settings);
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  const waking = !state.connected;

  return (
    <Page>
      <Masthead right={<><b>Est. 2026</b><span>Two-colour press</span></>}>
        <Nameplate />
      </Masthead>

      <PageBody className="hs-landing">
        <ErrorNote message={state.error} onDismiss={actions.clearError} />

        <div className="hs-landing-lede">
          <Kicker>How it works</Kicker>
          <p className="pr-headline hs-lede-head">
            Everyone writes a lie. Everyone hunts the truth.
          </p>
          <p className="pr-article">
            One question, and every player invents a plausible wrong answer. The lies are
            shuffled in with the real one and the room votes. You score for finding the
            truth — and for every player who falls for yours.
          </p>
        </div>

        <Rule variant="double" />

        <div className="hs-setup">
          <Field label="Rounds">
            <Choice options={ROUNDS.map((r) => ({ id: r, label: r }))} value={settings.rounds}
              onPick={(v) => set('rounds', v)} name="rounds" />
          </Field>

          <Field label="Seconds to write a lie">
            <Choice options={SECONDS.map((s) => ({ id: s, label: s }))} value={settings.lieSeconds}
              onPick={(v) => set('lieSeconds', v)} name="seconds" />
          </Field>

          <Field label="Deck" note={DECKS.find((d) => d.id === settings.deck)?.note}>
            <Choice options={DECKS.map((d) => ({ id: d.id, label: d.label }))} value={settings.deck}
              onPick={(v) => set('deck', v)} name="deck" />
          </Field>
        </div>

        <div className="hs-landing-go">
          <Btn
            variant="red"
            disabled={waking}
            onClick={() => actions.createRoom(settings)}
            data-testid="create-room"
          >
            {waking ? 'Waking the press…' : 'Open the room'}
          </Btn>
          <Btn variant="ghost" onClick={onSwitch}>I'm playing on my phone</Btn>
        </div>

        {waking ? (
          <p className="pr-article hs-waking">
            The server sleeps when nobody is playing. First connection takes a few seconds.
          </p>
        ) : null}
      </PageBody>
    </Page>
  );
}

function Field({ label, note, children }) {
  return (
    <div className="hs-field">
      <Kicker ink>{label}</Kicker>
      {children}
      {note ? <p className="hs-field-note">{note}</p> : null}
    </div>
  );
}

function Choice({ options, value, onPick, name }) {
  return (
    <div className="hs-choice" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className="hs-choice-btn"
          onClick={() => onPick(o.id)}
          data-testid={`${name}-${o.id}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
