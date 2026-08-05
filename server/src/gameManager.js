const { setRoomTimer, clearRoomTimer, clearRoomTimers, touchRoom } = require('./roomManager');
const { sanitizePlayers } = require('./sanitize');
const {
  cleanLie,
  isTruthCollision,
  buildOptions,
  toClientOptions,
  ownOptionId,
  shuffle,
} = require('./lies');

let questions = [];
function setQuestions(q) { questions = q; }

const PROMPT_TIME = 3000;
const VOTE_TIME = 25000;
const SCOREBOARD_TIME = 6000;

const TRUTH_POINTS = 1000;
const FOOL_POINTS = 500;

// The last round pays double. One line, and it is most of what keeps a table of
// eight playing to the end: without it a leader who is two rounds clear has already
// won by round four and everyone else is filling in time.
const FINAL_ROUND_MULTIPLIER = 2;

// ─── phase clock ─────────────────────────────────────────────────────────────

/**
 * Stamp a phase with the server's clock.
 *
 * Every phase event carries these four fields. Clients never count down from a
 * number handed to them once — they measure their offset on connect and derive the
 * remainder from `endsAt`, so a slow socket, a backgrounded phone and a player who
 * rejoins mid-phase all land on the same second.
 */
function beginPhase(room, state, durationMs) {
  const now = Date.now();
  room.state = state;
  room._phaseStartedAt = now;
  room._phaseDuration = durationMs;
  return {
    phase: state,
    serverNow: now,
    startedAt: now,
    durationMs,
    endsAt: durationMs === null ? null : now + durationMs,
  };
}

function phaseTiming(room) {
  const now = Date.now();
  const started = room._phaseStartedAt ?? now;
  const duration = room.paused ? (room._pausedRemaining ?? 0) : room._phaseDuration;
  return {
    phase: room.state,
    serverNow: now,
    startedAt: room.paused ? now : started,
    durationMs: duration,
    endsAt: duration === null ? null : (room.paused ? now + duration : started + duration),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function activePlayers(room) {
  return room.players;
}

// Single source of truth for "who are we waiting on". The progress bar and the
// auto-advance check reading two different lists is how a host bar sticks at 5/6
// forever on a round that already resolved.
function awaitedPlayers(room) {
  return room.players.filter((p) => p.connectionState === 'connected');
}

function publicPlayer(room, pid) {
  const p = room.players.find((x) => x.id === pid);
  return p ? { id: p.id, name: p.name, colorIndex: p.colorIndex } : null;
}

/**
 * Emit an event whose payload differs per recipient.
 *
 * Used for the options list, where each player must be told which option is their
 * own (so they cannot vote for it) without being told anyone else's. Broadcasting
 * one payload and letting clients filter would mean shipping authorship to the room.
 */
function emitPerPlayer(io, room, event, payloadFor) {
  const hostSocket = io.sockets.sockets.get(room.hostSocketId);
  if (hostSocket) hostSocket.emit(event, payloadFor(null));
  for (const p of room.players) {
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit(event, payloadFor(p.id));
  }
}

function roundMultiplier(room) {
  return room.round === room.settings.rounds - 1 ? FINAL_ROUND_MULTIPLIER : 1;
}

// ─── deck ────────────────────────────────────────────────────────────────────

/**
 * Draw the game's questions up front, so a round can never repeat one.
 *
 * `mixed` alternates tier round to round, which is the whole design premise: a
 * player raised in Dhaka and one raised in Michigan should each get rounds where
 * they are the expert, rather than one of them sweeping the game.
 */
function pickQuestions(count, deck = 'mixed', rand = Math.random) {
  const byTier = { desh: [], probash: [], shared: [] };
  for (const q of questions) (byTier[q.tier] ?? byTier.shared).push(q);
  for (const k of Object.keys(byTier)) byTier[k] = shuffle(byTier[k], rand);

  const drawn = [];
  const takeFrom = (tiers) => {
    for (const t of tiers) {
      if (byTier[t].length) return byTier[t].pop();
    }
    return null;
  };

  if (deck === 'desh' || deck === 'probash') {
    // A single-tier deck that runs dry falls back to shared rather than to a short
    // game — a host who picked `desh` wants desh questions, not five rounds.
    for (let i = 0; i < count; i++) {
      const q = takeFrom([deck, 'shared']);
      if (!q) break;
      drawn.push(q);
    }
    return drawn;
  }

  for (let i = 0; i < count; i++) {
    const primary = i % 2 === 0 ? 'desh' : 'probash';
    const q = takeFrom([primary, 'shared', primary === 'desh' ? 'probash' : 'desh']);
    if (!q) break;
    drawn.push(q);
  }
  return drawn;
}

// ─── reveal choreography ─────────────────────────────────────────────────────

/**
 * The reveal's beat schedule, owned by the server.
 *
 * Order is dramatic, not arbitrary: the lies nobody fell for go first and go fast,
 * then the ones that landed in ascending order of damage, then the truth. That
 * curve is the round's payoff — reading the options in board order instead throws
 * the climax away half the time by revealing the truth third.
 *
 * The host plays what it is given and computes nothing, so a phone that rejoins
 * eight seconds in seeds from `startedAt` and lands on the right beat rather than
 * replaying the sequence from zero.
 */
function revealSchedule(steps) {
  const beats = [];
  let at = 600; // a breath before the first card lands

  for (const s of steps) {
    const voters = s.voters.length;
    let duration;
    if (s.truth) {
      duration = 3200;
    } else if (voters === 0) {
      duration = 1500; // nobody bit — acknowledge it and move on
    } else {
      duration = 2000 + voters * 350; // naming each victim needs its own beat
    }
    beats.push({ optionId: s.id, at, duration });
    at += duration;
  }

  const whyAt = at + 200;
  const total = Math.min(whyAt + 4200, 34000);
  return { beats, whyAt, total };
}

/**
 * Order the options for the reveal and attach everything the screen needs.
 * Authorship and voters appear here for the first time — this payload is only ever
 * sent once the room is in REVEAL.
 */
function buildRevealSteps(room) {
  const { options, votes } = room.current;
  const votersByOption = {};
  for (const [pid, optionId] of Object.entries(votes)) {
    (votersByOption[optionId] ??= []).push(pid);
  }

  const decorated = options.map((o) => ({
    id: o.id,
    text: o.text,
    truth: o.truth,
    house: o.house,
    authors: o.authors.map((pid) => publicPlayer(room, pid)).filter(Boolean),
    voters: (votersByOption[o.id] ?? []).map((pid) => publicPlayer(room, pid)).filter(Boolean),
    points: o.truth
      ? (votersByOption[o.id] ?? []).length * TRUTH_POINTS * roundMultiplier(room)
      : o.authors.length ? (votersByOption[o.id] ?? []).length * FOOL_POINTS * roundMultiplier(room) : 0,
  }));

  const lies = decorated.filter((o) => !o.truth);
  const truth = decorated.find((o) => o.truth);

  lies.sort((a, b) => a.voters.length - b.voters.length);
  return truth ? [...lies, truth] : lies;
}

// ─── state machine ───────────────────────────────────────────────────────────

function handleGameEvent(io, room, event, payload = {}) {
  switch (event) {
    case 'START':               return startGame(io, room);
    case 'LIE':                 return submitLie(io, room, payload);
    case 'VOTE':                return submitVote(io, room, payload);
    case 'PLAYER_DISCONNECTED': return onPlayerDisconnected(io, room);
    case 'HOST_LOST':           return pauseForHost(io, room);
    case 'HOST_BACK':           return resumeAfterHost(io, room);
    case 'SKIP':                return skipPhase(io, room);
    case 'END':                 return endGame(io, room);
  }
}

function startGame(io, room) {
  const drawn = pickQuestions(room.settings.rounds, room.settings.deck);
  if (drawn.length === 0) {
    return io.to(room.code).emit('error', { message: 'No questions available for that deck' });
  }
  room.questions = drawn;
  room.round = -1;
  room.scores = {};
  room.knewIt = {};
  for (const p of room.players) { p.score = 0; room.scores[p.id] = 0; }
  advanceRound(io, room);
}

function startPrompt(io, room) {
  const question = room.questions[room.round];
  room.current = {
    question,
    lies: {},          // pid -> text
    options: [],       // built when collection closes
    votes: {},         // pid -> optionId
    gains: {},         // pid -> points this round
    houseLieByPid: {},
    knew: [],          // pids who typed the real answer this round
  };

  const timing = beginPhase(room, 'PROMPT', PROMPT_TIME);
  room._lastPrompt = {
    round: room.round + 1,
    of: room.settings.rounds,
    prompt: question.q,
    tier: question.tier,
    doublePoints: roundMultiplier(room) > 1,
  };
  io.to(room.code).emit('round:prompt', { ...room._lastPrompt, ...timing });
  setRoomTimer(room, 'phase', () => startCollecting(io, room), PROMPT_TIME);
}

function startCollecting(io, room) {
  const ms = room.settings.lieSeconds * 1000;
  const timing = beginPhase(room, 'COLLECTING', ms);
  io.to(room.code).emit('round:collecting', { ...room._lastPrompt, ...timing });
  emitLieCount(io, room);
  setRoomTimer(room, 'phase', () => endCollecting(io, room), ms);
}

function submitLie(io, room, { pid, text }) {
  if (room.state !== 'COLLECTING') return;
  const player = room.players.find((p) => p.id === pid);
  if (!player) return;

  const clean = cleanLie(text);
  if (!clean) return emitToPid(io, room, pid, 'error', { message: 'Write something first' });

  // The delightful case: they typed the actual answer. Told privately — announcing
  // it to the room would hand everyone the truth — and worth no points, so that
  // knowing the answer never becomes a reason to skip writing a lie.
  if (isTruthCollision(room.current.question, clean)) {
    if (!room.current.knew.includes(pid)) room.current.knew.push(pid);
    room.knewIt[pid] = (room.knewIt[pid] ?? 0) + 1;
    return emitToPid(io, room, pid, 'lie:knew_it', {
      message: "That's the real answer. Now write a lie.",
    });
  }

  room.current.lies[pid] = clean;
  touchRoom(room);
  emitToPid(io, room, pid, 'lie:accepted', { text: clean });
  emitLieCount(io, room);

  if (allIn(room, room.current.lies)) {
    clearRoomTimer(room, 'phase');
    endCollecting(io, room);
  }
}

function allIn(room, table) {
  const awaited = awaitedPlayers(room);
  return awaited.length > 0 && awaited.every((p) => table[p.id] !== undefined);
}

function emitLieCount(io, room) {
  io.to(room.code).emit('round:lie_count', {
    count: Object.keys(room.current.lies).length,
    total: awaitedPlayers(room).length,
    submitted: Object.keys(room.current.lies),
    stillOut: awaitedPlayers(room)
      .filter((p) => room.current.lies[p.id] === undefined)
      .map((p) => p.name),
  });
}

function endCollecting(io, room) {
  const cur = room.current;
  const awaited = awaitedPlayers(room).map((p) => p.id);
  const { options, houseLieByPid } = buildOptions(cur.question, cur.lies, awaited);
  cur.options = options;
  cur.houseLieByPid = houseLieByPid;
  startVoting(io, room);
}

function startVoting(io, room) {
  const timing = beginPhase(room, 'VOTING', VOTE_TIME);
  const options = toClientOptions(room.current.options);

  room._lastVoting = { round: room.round + 1, of: room.settings.rounds, prompt: room.current.question.q, options };

  // Per-player, because each player must know which option is theirs and nobody
  // else's. This payload is the one the whole game rests on: no truth flag, no
  // authorship, nothing but id and text.
  emitPerPlayer(io, room, 'round:options', (pid) => ({
    ...room._lastVoting,
    ...timing,
    yourOptionId: pid ? ownOptionId(room.current.options, pid) : null,
  }));
  emitVoteCount(io, room);
  setRoomTimer(room, 'phase', () => endVoting(io, room), VOTE_TIME);
}

function submitVote(io, room, { pid, optionId }) {
  if (room.state !== 'VOTING') return;
  const player = room.players.find((p) => p.id === pid);
  if (!player) return;

  const option = room.current.options.find((o) => o.id === optionId);
  if (!option) return;

  // Enforced here, not just hidden in the UI — the client is not the authority on
  // what it is allowed to send.
  if (option.authors.includes(pid)) {
    return emitToPid(io, room, pid, 'error', { message: "That's your own lie" });
  }

  room.current.votes[pid] = optionId;
  touchRoom(room);
  emitToPid(io, room, pid, 'vote:accepted', { optionId });
  emitVoteCount(io, room);

  if (allIn(room, room.current.votes)) {
    clearRoomTimer(room, 'phase');
    endVoting(io, room);
  }
}

function emitVoteCount(io, room) {
  io.to(room.code).emit('round:vote_count', {
    count: Object.keys(room.current.votes).length,
    total: awaitedPlayers(room).length,
    voted: Object.keys(room.current.votes),
    stillOut: awaitedPlayers(room)
      .filter((p) => room.current.votes[p.id] === undefined)
      .map((p) => p.name),
  });
}

function scoreRound(room) {
  const { options, votes } = room.current;
  const mult = roundMultiplier(room);
  const gains = {};
  const add = (pid, n) => { gains[pid] = (gains[pid] ?? 0) + n; };

  for (const [voterPid, optionId] of Object.entries(votes)) {
    const option = options.find((o) => o.id === optionId);
    if (!option) continue;

    if (option.truth) {
      add(voterPid, TRUTH_POINTS * mult);
      continue;
    }
    // Every author of a merged lie is paid in full for each player fooled — two
    // people who both wrote "Mango" both earned that vote.
    for (const authorPid of option.authors) {
      add(authorPid, FOOL_POINTS * mult);
    }
  }

  room.current.gains = gains;
  for (const [pid, n] of Object.entries(gains)) {
    room.scores[pid] = (room.scores[pid] ?? 0) + n;
  }
  for (const p of room.players) p.score = room.scores[p.id] ?? 0;
}

function endVoting(io, room) {
  scoreRound(room);
  startReveal(io, room);
}

function startReveal(io, room) {
  const steps = buildRevealSteps(room);
  const schedule = revealSchedule(steps);
  const timing = beginPhase(room, 'REVEAL', schedule.total);
  const q = room.current.question;

  room._lastReveal = {
    round: room.round + 1,
    of: room.settings.rounds,
    prompt: q.q,
    steps,
    schedule,
    why: q.why,
    answer: q.show || q.a,
    doublePoints: roundMultiplier(room) > 1,
    players: sanitizePlayers(room.players),
    gains: room.current.gains,
  };
  io.to(room.code).emit('round:reveal', { ...room._lastReveal, ...timing });
  setRoomTimer(room, 'phase', () => showScoreboard(io, room), schedule.total);
}

function standings(room) {
  return room.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      colorIndex: p.colorIndex,
      score: room.scores[p.id] ?? 0,
      gained: room.current?.gains?.[p.id] ?? 0,
      connectionState: p.connectionState,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function showScoreboard(io, room) {
  const timing = beginPhase(room, 'SCOREBOARD', SCOREBOARD_TIME);
  room._lastScoreboard = {
    round: room.round + 1,
    of: room.settings.rounds,
    standings: standings(room),
    last: room.round + 1 >= room.settings.rounds,
  };
  io.to(room.code).emit('round:scoreboard', { ...room._lastScoreboard, ...timing });
  setRoomTimer(room, 'phase', () => advanceRound(io, room), SCOREBOARD_TIME);
}

/**
 * The one place a round ends and the next begins.
 *
 * Written out once on purpose: the scoreboard timer, the host's skip and the
 * resume-after-pause path all funnel through here, and three copies is how a new
 * phase ends up missing from one of them.
 */
function advanceRound(io, room) {
  room.round += 1;
  if (room.round >= room.questions.length || room.round >= room.settings.rounds) {
    return endGame(io, room);
  }
  startPrompt(io, room);
}

function endGame(io, room) {
  clearRoomTimers(room);
  beginPhase(room, 'GAME_OVER', null);

  const final = standings(room).map((s, i) => ({
    ...s,
    rank: i + 1,
    knewIt: room.knewIt[s.id] ?? 0,
  }));

  room._lastFinal = {
    standings: final,
    rounds: Math.min(room.round, room.settings.rounds),
  };
  io.to(room.code).emit('game:over', room._lastFinal);
  touchRoom(room);
}

function resetToLobby(io, room) {
  clearRoomTimers(room);
  room.state = 'LOBBY';
  room.round = 0;
  room.questions = [];
  room.current = null;
  room.scores = {};
  room.knewIt = {};
  for (const p of room.players) p.score = 0;
  for (const p of room.players) room.scores[p.id] = 0;
  room._lastPrompt = room._lastVoting = room._lastReveal = room._lastScoreboard = room._lastFinal = null;
  touchRoom(room);
  io.to(room.code).emit('room:reset', {
    players: sanitizePlayers(room.players),
    settings: room.settings,
  });
}

// ─── interruptions ───────────────────────────────────────────────────────────

function emitToPid(io, room, pid, event, payload) {
  const p = room.players.find((x) => x.id === pid);
  if (!p) return;
  const s = io.sockets.sockets.get(p.socketId);
  if (s) s.emit(event, payload);
}

/**
 * A player leaving must be able to unblock the round.
 *
 * If the room was waiting only on the player who just dropped, the phase would
 * otherwise sit on its full timer with every remaining player staring at a
 * progress bar that can no longer complete.
 */
function onPlayerDisconnected(io, room) {
  if (room.state === 'COLLECTING') {
    emitLieCount(io, room);
    if (allIn(room, room.current.lies)) {
      clearRoomTimer(room, 'phase');
      endCollecting(io, room);
    }
  } else if (room.state === 'VOTING') {
    emitVoteCount(io, room);
    if (allIn(room, room.current.votes)) {
      clearRoomTimer(room, 'phase');
      endVoting(io, room);
    }
  }
}

// Freeze rather than play on to an empty screen: the shared display is where the
// prompt and the options live, so without it the room is playing blind.
function pauseForHost(io, room) {
  if (room.paused || room.state === 'LOBBY' || room.state === 'GAME_OVER') return;
  room.paused = true;
  const t = phaseTiming(room);
  room._pausedRemaining = t.endsAt === null ? null : Math.max(0, t.endsAt - Date.now());
  clearRoomTimer(room, 'phase');
  io.to(room.code).emit('game:paused', { reason: 'host_disconnected' });
}

const PHASE_RESUME = {
  PROMPT: startCollecting,
  COLLECTING: endCollecting,
  VOTING: endVoting,
  REVEAL: showScoreboard,
  SCOREBOARD: advanceRound,
};

function resumeAfterHost(io, room) {
  if (!room.paused) return;
  room.paused = false;
  const remaining = room._pausedRemaining ?? 0;
  room._pausedRemaining = null;

  const next = PHASE_RESUME[room.state];
  if (!next) return;

  const timing = beginPhase(room, room.state, remaining);
  io.to(room.code).emit('game:resumed', timing);
  // Re-send the phase so anyone who joined during the freeze has its content.
  syncRoom(io, room);
  setRoomTimer(room, 'phase', () => next(io, room), remaining);
}

function skipPhase(io, room) {
  const next = PHASE_RESUME[room.state];
  if (!next) return;
  clearRoomTimer(room, 'phase');
  next(io, room);
}

function syncRoom(io, room) {
  for (const p of room.players) {
    const s = io.sockets.sockets.get(p.socketId);
    if (s) syncPlayerState(s, room, p.id);
  }
  const hostSocket = io.sockets.sockets.get(room.hostSocketId);
  if (hostSocket) syncPlayerState(hostSocket, room, null);
}

/**
 * Re-emit the current phase to one socket that just (re)connected.
 *
 * Everything carries real elapsed time, including the reveal — which otherwise
 * replays its full choreography for a phone that came back eight seconds into it,
 * while the shared screen has already moved on.
 */
function syncPlayerState(socket, room, pid) {
  const timing = phaseTiming(room);

  switch (room.state) {
    case 'LOBBY':
      socket.emit('room:updated', { players: sanitizePlayers(room.players) });
      break;
    case 'PROMPT':
      if (room._lastPrompt) socket.emit('round:prompt', { ...room._lastPrompt, ...timing });
      break;
    case 'COLLECTING':
      if (room._lastPrompt) {
        socket.emit('round:collecting', {
          ...room._lastPrompt,
          ...timing,
          // Land a player who already wrote a lie on the waiting screen rather than
          // on a fresh input they could submit from a second time.
          alreadySubmitted: pid ? room.current?.lies[pid] !== undefined : false,
          mySubmission: pid ? room.current?.lies[pid] ?? null : null,
        });
        socket.emit('round:lie_count', {
          count: Object.keys(room.current?.lies ?? {}).length,
          total: awaitedPlayers(room).length,
          submitted: Object.keys(room.current?.lies ?? {}),
          stillOut: awaitedPlayers(room)
            .filter((p) => room.current?.lies[p.id] === undefined)
            .map((p) => p.name),
        });
      }
      break;
    case 'VOTING':
      if (room._lastVoting) {
        socket.emit('round:options', {
          ...room._lastVoting,
          ...timing,
          yourOptionId: pid ? ownOptionId(room.current.options, pid) : null,
          alreadySubmitted: pid ? room.current.votes[pid] !== undefined : false,
          myVote: pid ? room.current.votes[pid] ?? null : null,
        });
      }
      break;
    case 'REVEAL':
      if (room._lastReveal) socket.emit('round:reveal', { ...room._lastReveal, ...timing });
      break;
    case 'SCOREBOARD':
      if (room._lastScoreboard) socket.emit('round:scoreboard', { ...room._lastScoreboard, ...timing });
      break;
    case 'GAME_OVER':
      if (room._lastFinal) socket.emit('game:over', room._lastFinal);
      break;
  }

  if (room.paused) socket.emit('game:paused', { reason: 'host_disconnected' });
}

module.exports = {
  handleGameEvent,
  syncPlayerState,
  setQuestions,
  resetToLobby,
  pickQuestions,      // exported for tests
  revealSchedule,     // exported for tests
  buildRevealSteps,   // exported for tests
  TRUTH_POINTS,
  FOOL_POINTS,
  FINAL_ROUND_MULTIPLIER,
};
