import { useCallback, useEffect, useReducer, useRef } from 'react';
import socket from '../socket';
import { syncClock } from './clock';
import { getPlayerId, saveSession, loadSession, clearSession } from '../session';

/**
 * One reducer owns every socket event, so the screens are pure.
 *
 * Screens that each subscribed to their own events is how a payload ends up handled
 * in three places and missed in a fourth — and in a game where every phase change
 * arrives over the wire, that shows up as a screen that simply never advances.
 */

const initial = {
  connected: false,
  everConnected: false,
  role: null,          // 'host' | 'player'
  code: null,
  me: null,            // { id, name, colorIndex }
  players: [],
  settings: { rounds: 5, lieSeconds: 60, deck: 'mixed' },

  phase: 'LANDING',
  timing: null,
  round: 0,
  of: 0,
  prompt: '',
  tier: null,
  doublePoints: false,

  // COLLECTING
  lieSubmitted: false,
  mySubmission: null,
  lieCount: { count: 0, total: 0, stillOut: [] },

  // VOTING
  options: [],
  yourOptionId: null,
  myVote: null,
  voteCount: { count: 0, total: 0, stillOut: [] },

  reveal: null,
  scoreboard: null,
  final: null,

  paused: false,
  notice: null,        // transient, player-facing (the "you knew it" moment)
  error: null,
};

function reducer(state, action) {
  const a = action;
  switch (a.type) {
    case 'connected':
      return { ...state, connected: true, everConnected: true };
    case 'disconnected':
      return { ...state, connected: false };

    case 'room:created':
      return {
        ...state,
        role: 'host',
        code: a.p.code,
        settings: a.p.settings ?? state.settings,
        phase: state.phase === 'LANDING' ? 'LOBBY' : state.phase,
        error: null,
      };

    case 'player:joined':
      return {
        ...state,
        role: 'player',
        code: a.p.room.code,
        me: a.p.you,
        players: a.p.room.players,
        settings: a.p.room.settings,
        // Trust the room's own state rather than assuming a join means the lobby —
        // this same payload arrives on a mid-game reconnect.
        phase: state.phase === 'LANDING' || state.phase === 'LOBBY' ? a.p.room.state : state.phase,
        error: null,
      };

    case 'room:updated':
      return { ...state, players: a.p.players };
    case 'room:settings':
      return { ...state, settings: a.p.settings };
    case 'room:reset':
      return {
        ...state,
        players: a.p.players,
        settings: a.p.settings,
        phase: 'LOBBY',
        reveal: null, scoreboard: null, final: null,
        options: [], yourOptionId: null, myVote: null,
        lieSubmitted: false, mySubmission: null,
        round: 0, prompt: '', timing: null, paused: false,
      };

    case 'round:prompt':
      return {
        ...state,
        phase: 'PROMPT',
        timing: timingOf(a.p),
        round: a.p.round, of: a.p.of,
        prompt: a.p.prompt, tier: a.p.tier, doublePoints: a.p.doublePoints,
        // A new round wipes last round's answers, or a player who submitted in
        // round 2 lands on the "you're in" screen for round 3 without typing.
        lieSubmitted: false, mySubmission: null,
        options: [], yourOptionId: null, myVote: null,
        reveal: null, scoreboard: null,
        lieCount: { count: 0, total: 0, stillOut: [] },
        voteCount: { count: 0, total: 0, stillOut: [] },
        notice: null,
      };

    case 'round:collecting':
      return {
        ...state,
        phase: 'COLLECTING',
        timing: timingOf(a.p),
        round: a.p.round, of: a.p.of, prompt: a.p.prompt,
        tier: a.p.tier, doublePoints: a.p.doublePoints,
        // Present on a resync: land a player who already wrote a lie on the
        // waiting screen rather than on an empty box they could submit from twice.
        lieSubmitted: a.p.alreadySubmitted ?? state.lieSubmitted,
        mySubmission: a.p.mySubmission ?? state.mySubmission,
      };

    case 'round:lie_count':
      return { ...state, lieCount: a.p };

    case 'lie:accepted':
      return { ...state, lieSubmitted: true, mySubmission: a.p.text, notice: null, error: null };

    case 'lie:knew_it':
      // Deliberately not an error — this is the good outcome, privately delivered.
      return { ...state, notice: { kind: 'knew', message: a.p.message } };

    case 'round:options':
      return {
        ...state,
        phase: 'VOTING',
        timing: timingOf(a.p),
        round: a.p.round, of: a.p.of, prompt: a.p.prompt,
        options: a.p.options,
        yourOptionId: a.p.yourOptionId ?? null,
        myVote: a.p.myVote ?? state.myVote,
        notice: null,
      };

    case 'vote:accepted':
      return { ...state, myVote: a.p.optionId, error: null };

    case 'round:vote_count':
      return { ...state, voteCount: a.p };

    case 'round:reveal':
      return { ...state, phase: 'REVEAL', timing: timingOf(a.p), reveal: a.p, notice: null };

    case 'round:scoreboard':
      return { ...state, phase: 'SCOREBOARD', timing: timingOf(a.p), scoreboard: a.p };

    case 'game:over':
      return { ...state, phase: 'GAME_OVER', timing: null, final: a.p, paused: false };

    case 'game:paused':
      return { ...state, paused: true };
    case 'game:resumed':
      return { ...state, paused: false, timing: timingOf(a.p) };

    case 'error':
      return { ...state, error: a.p.message };
    case 'clear-error':
      return { ...state, error: null };
    case 'clear-notice':
      return { ...state, notice: null };

    case 'leave':
      return { ...initial, connected: state.connected, everConnected: true };

    default:
      return state;
  }
}

function timingOf(p) {
  return {
    phase: p.phase,
    serverNow: p.serverNow,
    startedAt: p.startedAt,
    durationMs: p.durationMs,
    endsAt: p.endsAt,
  };
}

// Errors that mean the room is genuinely gone — almost always a server restart,
// which drops every in-memory room. Anything else (a rejected vote, a full room)
// must not clear the session, or a transient refusal logs the player out of a game
// they are still in.
const FATAL = new Set(['Room not found', 'Player not found in room', 'Not the host of this room']);

export default function useGameSocket() {
  const [state, dispatch] = useReducer(reducer, initial);

  // The live session, read by the connect handler. A ref rather than state because
  // the handler is registered once and must see the current value, not the one
  // that existed when it was attached.
  const sessionRef = useRef(loadSession());

  useEffect(() => {
    const on = (event) => (p) => dispatch({ type: event, p });

    const events = [
      'room:created', 'player:joined', 'room:updated', 'room:settings', 'room:reset',
      'round:prompt', 'round:collecting', 'round:lie_count', 'lie:accepted', 'lie:knew_it',
      'round:options', 'vote:accepted', 'round:vote_count',
      'round:reveal', 'round:scoreboard', 'game:over', 'game:paused', 'game:resumed',
    ];
    const handlers = {};
    for (const e of events) { handlers[e] = on(e); socket.on(e, handlers[e]); }

    // The host's token arrives only on the socket that created the room, and is
    // required back on rejoin. Persisted here so a host who refreshes the shared
    // screen — or whose laptop sleeps — can reclaim control of their own game.
    const onCreated = (p) => {
      const next = { ...(sessionRef.current ?? {}), role: 'host', code: p.code, hostToken: p.hostToken ?? sessionRef.current?.hostToken };
      sessionRef.current = next;
      saveSession(next);
    };
    const onJoined = (p) => {
      const next = { role: 'player', code: p.room.code, name: p.you.name };
      sessionRef.current = next;
      saveSession(next);
    };
    socket.on('room:created', onCreated);
    socket.on('player:joined', onJoined);

    const onError = (p) => {
      dispatch({ type: 'error', p });
      if (FATAL.has(p?.message)) {
        clearSession();
        sessionRef.current = null;
        dispatch({ type: 'leave' });
      }
    };
    socket.on('error', onError);

    /**
     * The server is going away and every room with it — a deploy, or the free tier
     * spinning down. Clear the session now rather than letting the socket retry
     * forever into a server that has forgotten this room: the reconnect would
     * succeed, the rejoin would fail, and the room would sit on a frozen phase
     * wondering why nothing advanced.
     */
    const onShutdown = (p) => {
      clearSession();
      sessionRef.current = null;
      dispatch({ type: 'leave' });
      dispatch({ type: 'error', p: { message: p?.message ?? 'The server restarted — start a new game.' } });
    };
    socket.on('server:shutdown', onShutdown);

    /**
     * Re-announce on EVERY connect, not just the first.
     *
     * socket.once here looks correct and silently kills every player who
     * reconnects: socket.io's automatic reconnect (after a locked phone, a tunnel,
     * an app switch) produces a brand-new socket that is not in the room, so the
     * player stops receiving the game while appearing fine to themselves.
     */
    const onConnect = () => {
      dispatch({ type: 'connected' });
      syncClock(socket);
      const s = sessionRef.current;
      if (!s?.code) return;
      if (s.role === 'host' && s.hostToken) {
        socket.emit('host:rejoin', { code: s.code, hostToken: s.hostToken });
      } else if (s.role === 'player') {
        socket.emit('player:rejoin', { code: s.code, pid: getPlayerId(), name: s.name });
      }
    };
    const onDisconnect = () => dispatch({ type: 'disconnected' });

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    if (!socket.connected) socket.connect();
    else onConnect();

    // StrictMode runs effects twice in development — every `on` needs its `off`,
    // or the second mount doubles every dispatch.
    return () => {
      for (const e of events) socket.off(e, handlers[e]);
      socket.off('room:created', onCreated);
      socket.off('player:joined', onJoined);
      socket.off('error', onError);
      socket.off('server:shutdown', onShutdown);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const actions = {
    createRoom: useCallback((settings) => socket.emit('host:create_room', settings), []),
    updateSettings: useCallback((settings) => socket.emit('host:update_settings', settings), []),
    join: useCallback((code, name) => {
      const next = { role: 'player', code, name };
      sessionRef.current = next;
      saveSession(next);
      socket.emit('player:join', { code, name, pid: getPlayerId() });
    }, []),
    start: useCallback(() => socket.emit('host:start_game'), []),
    skip: useCallback(() => socket.emit('host:skip'), []),
    endGame: useCallback(() => socket.emit('host:end_game'), []),
    playAgain: useCallback(() => socket.emit('host:play_again'), []),
    submitLie: useCallback((text) => socket.emit('player:submit_lie', { text }), []),
    submitVote: useCallback((optionId) => socket.emit('player:submit_vote', { optionId }), []),
    clearError: useCallback(() => dispatch({ type: 'clear-error' }), []),
    clearNotice: useCallback(() => dispatch({ type: 'clear-notice' }), []),
    leave: useCallback(() => {
      clearSession();
      sessionRef.current = null;
      dispatch({ type: 'leave' });
    }, []),
  };

  return [state, actions];
}
