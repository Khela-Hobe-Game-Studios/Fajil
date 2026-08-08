import {
  Page, PageBody, Masthead, Nameplate, Kicker, Rule, Prompt, Clock, Meter, Ballot, Btn,
} from '../../press';
import { SoundToggle } from '../Shared';

const TIER_LABEL = { desh: 'Desh edition', probash: 'Probash edition', shared: 'Home & away' };

/**
 * PROMPT, COLLECTING and VOTING on the shared screen.
 *
 * One component, because they are one continuous page: the prompt is set as the
 * headline and stays put while the story underneath it changes from "everyone is
 * writing" to "here is what we have". Re-mounting a different screen under the same
 * headline makes the room re-read a question they already know.
 */
export default function HostRound({ state, actions }) {
  const { phase, prompt, round, of, tier, doublePoints } = state;

  return (
    <Page>
      <Masthead
        right={
          <>
            <span>Room</span><b>{state.code}</b>
            <span>Round</span><b>{round}/{of}</b>
            <Clock timing={state.timing} />
            <SoundToggle />
          </>
        }
      >
        <Nameplate sub={TIER_LABEL[tier] ?? 'the bluffing game'} />
      </Masthead>

      <PageBody className="hs-round">
        <div className="hs-round-head">
          <div className="pr-row">
            <Kicker>
              {phase === 'VOTING' ? 'Which one is true?' : 'Tonight’s question'}
            </Kicker>
            {doublePoints ? <span className="hs-double">Final round — double points</span> : null}
          </div>
          <Prompt text={prompt} />
        </div>

        <Rule variant="double" />

        {phase === 'VOTING'
          ? <VotingBody state={state} />
          : <CollectingBody state={state} phase={phase} />}

        <div className="hs-round-foot">
          <Btn variant="ghost" onClick={actions.skip} data-testid="skip">Skip ahead</Btn>
        </div>
      </PageBody>
    </Page>
  );
}

function CollectingBody({ state, phase }) {
  const { count, total, stillOut = [] } = state.lieCount;

  if (phase === 'PROMPT') {
    return (
      <div className="hs-round-body pr-center">
        <p className="pr-subhead hs-getready">Get your phones out.</p>
      </div>
    );
  }

  return (
    <div className="hs-round-body">
      <div className="hs-waiting">
        <div className="pr-row pr-row--between">
          <Kicker ink>Lies filed</Kicker>
          <span className="pr-num hs-count"><b>{count}</b>/{total}</span>
        </div>
        <Meter count={count} total={total} />

        {stillOut.length > 0 ? (
          <p className="pr-article hs-still-out">
            Still writing: {stillOut.join(', ')}
          </p>
        ) : (
          <p className="pr-article hs-still-out">Everyone's in. Setting the type…</p>
        )}
      </div>

      <p className="pr-subhead hs-hint">
        Write something the room will believe. You score when they fall for it.
      </p>
    </div>
  );
}

function VotingBody({ state }) {
  const { count, total, stillOut = [] } = state.voteCount;

  return (
    <div className="hs-round-body">
      {/* Read-only on the shared screen: the room reads these together and calls
          them out by letter, and the tapping happens on the phones. */}
      <Ballot options={state.options} />

      <div className="hs-waiting">
        <div className="pr-row pr-row--between">
          <Kicker ink>Votes cast</Kicker>
          <span className="pr-num hs-count"><b>{count}</b>/{total}</span>
        </div>
        <Meter count={count} total={total} />
        {stillOut.length > 0 ? (
          <p className="pr-article hs-still-out">Waiting on: {stillOut.join(', ')}</p>
        ) : null}
      </div>
    </div>
  );
}
