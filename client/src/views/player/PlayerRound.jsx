import { useEffect, useState } from 'react';
import {
  Page, PageBody, Masthead, Nameplate, Kicker, Prompt, Clock, Ballot, Btn, Stamp,
} from '../../press';
import { ErrorNote } from '../Shared';

/**
 * The phone during a round: write a lie, then pick one.
 *
 * Deliberately plain. The shared screen is where the design lives — a phone
 * competing with it splits the room's attention, and this screen is glanced at for
 * about two seconds between conversations.
 */
export default function PlayerRound({ state, actions }) {
  const { phase } = state;

  return (
    <Page>
      <Masthead
        right={<><span>Round</span><b>{state.round}/{state.of}</b><Clock timing={state.timing} /></>}
      >
        <Nameplate sub={state.me?.name} />
      </Masthead>

      <PageBody className="pl-round">
        <ErrorNote message={state.error} onDismiss={actions.clearError} />

        {phase === 'PROMPT' ? <GetReady state={state} /> : null}
        {phase === 'COLLECTING'
          ? (state.lieSubmitted ? <LieFiled state={state} /> : <WriteLie state={state} actions={actions} />)
          : null}
        {phase === 'VOTING'
          ? (state.myVote ? <VoteCast state={state} /> : <PickOne state={state} actions={actions} />)
          : null}
      </PageBody>
    </Page>
  );
}

function GetReady({ state }) {
  return (
    <div className="pl-center">
      <Kicker>Round {state.round}</Kicker>
      <p className="pr-subhead">Look at the big screen.</p>
    </div>
  );
}

function WriteLie({ state, actions }) {
  const [text, setText] = useState('');

  // A rejected lie (they typed the real answer) must clear the box, or they submit
  // the same rejected string again by reflex.
  useEffect(() => {
    if (state.notice?.kind === 'knew') setText('');
  }, [state.notice]);

  const ready = text.trim().length > 0;
  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    actions.submitLie(text.trim());
  };

  return (
    <form className="pl-write" onSubmit={submit}>
      <Kicker>Write a convincing lie</Kicker>
      <Prompt text={state.prompt} className="pl-prompt" />

      {/* The "you knew it" moment, delivered privately. Announcing it to the room
          would hand everybody the answer. */}
      {state.notice?.kind === 'knew' ? (
        <div className="pl-knew" role="status">
          <Stamp tone="blue" animate>You knew it</Stamp>
          <p className="pr-article">{state.notice.message}</p>
        </div>
      ) : null}

      <input
        className="pr-input pl-lie-input"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 60))}
        placeholder="Something believable…"
        maxLength={60}
        autoCorrect="off"
        autoCapitalize="sentences"
        // The keyboard's own action key submits. On a small phone the keyboard can
        // cover a button no matter how the page is laid out, so the reliable way to
        // send is the one already under the player's thumb.
        enterKeyHint="send"
        data-testid="lie-input"
        autoFocus
      />

      <Btn variant="red" block type="submit" disabled={!ready} data-testid="lie-submit">
        File it
      </Btn>
      <p className="pl-hint">You score every time somebody falls for it.</p>
    </form>
  );
}

function LieFiled({ state }) {
  const { count, total } = state.lieCount;
  return (
    <div className="pl-center">
      <Stamp animate>Filed</Stamp>
      <p className="pl-filed-text">“{state.mySubmission}”</p>
      <p className="pr-subhead pl-waiting-for">
        {count}/{total} in. Waiting for the rest…
      </p>
    </div>
  );
}

function PickOne({ state, actions }) {
  return (
    <div className="pl-vote">
      <Kicker>Which one is true?</Kicker>
      <Prompt text={state.prompt} className="pl-prompt pl-prompt--small" />
      <Ballot
        options={state.options}
        ownId={state.yourOptionId}
        chosen={state.myVote}
        onPick={actions.submitVote}
        single
      />
      {state.yourOptionId ? (
        <p className="pl-hint">Your own lie is crossed out — you can't vote for it.</p>
      ) : null}
    </div>
  );
}

function VoteCast({ state }) {
  const { count, total } = state.voteCount;
  const picked = state.options.find((o) => o.id === state.myVote);
  return (
    <div className="pl-center">
      <Stamp animate>Locked in</Stamp>
      <p className="pl-filed-text">“{picked?.text}”</p>
      <p className="pr-subhead pl-waiting-for">
        {count}/{total} voted. Look up…
      </p>
    </div>
  );
}
