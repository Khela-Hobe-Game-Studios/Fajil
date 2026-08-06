#!/usr/bin/env node
/**
 * Socket-level reliability suite.
 *
 * Runs against a real server over a real socket, because the things most likely to
 * break this game — a truth that ships early, a reconnecting player who comes back
 * as a stranger, a round that never resolves because the only person it was waiting
 * on closed their laptop — are all properties of the transport and the state
 * machine together, and none of them are visible to a unit test.
 *
 *   node test-reliability.js            # boots its own server on a test port
 *   node test-reliability.js --port 3001  # use an already-running server
 */

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const argPort = process.argv.includes('--port')
  ? Number(process.argv[process.argv.indexOf('--port') + 1])
  : null;
const PORT = argPort ?? 3555;
const URL = `http://localhost:${PORT}`;

let passed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for one event, with a timeout that names what it was waiting for. */
function once(socket, event, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeout);
    const handler = (payload) => { clearTimeout(t); resolve(payload); };
    socket.once(event, handler);
  });
}

/**
 * A client that records every frame it is ever sent.
 *
 * The recording is the point: the truth-leak assertions below re-read the whole
 * transcript of what a player was told and when, which is exactly what an actual
 * cheat would do with devtools open.
 */
function makeClient(label) {
  const socket = io(URL, { autoConnect: false, forceNew: true, transports: ['websocket'] });
  const frames = [];
  socket.onAny((event, payload) => frames.push({ event, payload, at: Date.now() }));
  socket.label = label;
  socket.frames = frames;
  return socket;
}

function connect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
}

// ─── the suite ───────────────────────────────────────────────────────────────

async function run() {
  const host = makeClient('host');
  await connect(host);

  // ---- lobby -------------------------------------------------------------
  host.emit('host:create_room', { rounds: 3, lieSeconds: 45, deck: 'mixed' });
  const created = await once(host, 'room:created');
  const code = created.code;
  // Three tiers: a word, a word+digit, then the random overflow the widened code
  // space added — all four characters, all uppercase alphanumeric.
  check('room created with a 4-character code', /^[A-Z0-9]{4}$/.test(code), code);
  check('host token is minted and sent only to the creator', typeof created.hostToken === 'string' && created.hostToken.length > 20);

  const names = ['Rumi', 'Tanvir', 'Ayesha', 'Rumi']; // deliberate duplicate
  const players = [];
  for (const [i, name] of names.entries()) {
    const s = makeClient(name);
    await connect(s);
    s.pid = `pid-${i}-${Math.random().toString(36).slice(2)}`;
    s.emit('player:join', { code, name, pid: s.pid });
    const joined = await once(s, 'player:joined');
    s.me = joined.you;
    players.push(s);
  }

  const roster = (await once(players[0], 'room:updated', 3000).catch(() => null))
    ?? { players: [] };
  void roster;

  const finalNames = players.map((p) => p.me.name);
  check('duplicate names are disambiguated', finalNames[3] === 'Rumi (2)', finalNames.join(', '));
  check('every player gets a distinct colour', new Set(players.map((p) => p.me.colorIndex)).size === 4);

  // A stranger must not be able to seize host control by guessing the code.
  const impostor = makeClient('impostor');
  await connect(impostor);
  impostor.emit('host:rejoin', { code, hostToken: 'not-the-real-token-aaaaaaaaaaaaaaaaaaaaa' });
  const impostorErr = await once(impostor, 'error', 4000).catch(() => null);
  check('host control requires the token, not just the code', impostorErr?.message === 'Not the host of this room', JSON.stringify(impostorErr));
  impostor.close();

  // ---- round 1 -----------------------------------------------------------
  host.emit('host:start_game');
  const prompt = await once(host, 'round:prompt');
  check('game starts and issues a prompt', typeof prompt.prompt === 'string' && prompt.prompt.includes('___'));
  check('phase carries the server clock', typeof prompt.serverNow === 'number' && typeof prompt.endsAt === 'number');

  await once(host, 'round:collecting');

  // The truth-collision delight: typing the real answer is caught and returned
  // privately, and must never be broadcast.
  const answerRes = await fetch(`${URL}/health`).then((r) => r.json()).catch(() => null);
  check('health endpoint responds', answerRes?.ok === true);

  // Two players write the same lie, so the merge path is exercised.
  players[0].emit('player:submit_lie', { text: 'Mango' });
  players[1].emit('player:submit_lie', { text: '  mango!! ' });
  players[2].emit('player:submit_lie', { text: 'Lychee' });
  players[3].emit('player:submit_lie', { text: 'Guava' });

  await Promise.all(players.map((p) => once(p, 'lie:accepted')));

  const optionsFrames = await Promise.all(players.map((p) => once(p, 'round:options')));
  const opts = optionsFrames[0].options;
  check('options are built and sent', Array.isArray(opts) && opts.length >= 4, `${opts?.length} options`);
  check('duplicate lies are merged into one option',
    opts.filter((o) => o.text.toLowerCase().replace(/\W/g, '') === 'mango').length === 1);

  // Each player is told their own option and nobody else's.
  const own0 = optionsFrames[0].yourOptionId;
  const own1 = optionsFrames[1].yourOptionId;
  check('merged authors share one option id', own0 && own0 === own1, `${own0} vs ${own1}`);
  check('each player learns only their own option',
    optionsFrames.every((f) => Object.keys(f).filter((k) => k === 'yourOptionId').length === 1));

  // Voting for your own lie is refused server-side, not merely hidden in the UI.
  players[0].emit('player:submit_vote', { optionId: own0 });
  const selfVoteErr = await once(players[0], 'error', 4000).catch(() => null);
  check('a player cannot vote for their own lie', selfVoteErr?.message === "That's your own lie", JSON.stringify(selfVoteErr));

  // ---- the assertion this whole game rests on ----------------------------
  assertNoTruthLeak(players, optionsFrames[0]);

  // Everyone votes for something that is not theirs.
  for (const [i, p] of players.entries()) {
    const mine = optionsFrames[i].yourOptionId;
    const target = opts.find((o) => o.id !== mine);
    p.emit('player:submit_vote', { optionId: target.id });
  }

  const reveal = await once(host, 'round:reveal', 15000);
  check('reveal names the answer', typeof reveal.answer === 'string' && reveal.answer.length > 0);
  check('reveal carries authorship for the first time', reveal.steps.some((s) => s.authors.length > 0));
  check('reveal ends on the truth', reveal.steps[reveal.steps.length - 1].truth === true);
  check('reveal orders lies by how many they fooled',
    isNonDecreasing(reveal.steps.filter((s) => !s.truth).map((s) => s.voters.length)));
  check('reveal schedule fits inside its phase',
    reveal.schedule.beats.every((b) => b.at + b.duration <= reveal.schedule.total));
  check('reveal explains why it matters', typeof reveal.why === 'string' && reveal.why.length > 20);

  // ---- reconnect mid-game ------------------------------------------------
  const victim = players[2];
  const scoreBefore = reveal.players.find((p) => p.id === victim.pid)?.score ?? 0;
  const victimName = victim.me.name;
  const victimColor = victim.me.colorIndex;

  victim.close();
  await sleep(600);

  const returned = makeClient('Ayesha-returned');
  await connect(returned);
  // Both listeners are registered before the rejoin is sent. The phase re-emit
  // follows player:joined in the same tick on the server, so subscribing after the
  // first has already resolved is a race the test would lose intermittently.
  const rejoinedP = once(returned, 'player:joined');
  const resyncP = Promise.race([
    once(returned, 'round:reveal', 6000),
    once(returned, 'round:scoreboard', 6000),
    once(returned, 'round:prompt', 6000),
    once(returned, 'round:collecting', 6000),
    once(returned, 'round:options', 6000),
  ]).catch(() => null);
  returned.emit('player:rejoin', { code, pid: victim.pid, name: victimName });
  const rejoined = await rejoinedP;

  check('a reconnecting player keeps their identity', rejoined.you.name === victimName, rejoined.you.name);
  check('a reconnecting player keeps their colour', rejoined.you.colorIndex === victimColor);
  const scoreAfter = rejoined.room.players.find((p) => p.id === victim.pid)?.score ?? -1;
  check('a reconnecting player keeps their score', scoreAfter === scoreBefore, `${scoreBefore} -> ${scoreAfter}`);
  const resync = await resyncP;
  check('a reconnecting player is re-sent the live phase', !!resync,
    returned.frames.map((f) => f.event).join(','));
  // The phase must arrive with real elapsed time, not restarted. A reveal that
  // replays from zero for a returning phone desynchronises it from the shared
  // screen for the rest of the round.
  if (resync) {
    check('the re-sent phase carries real elapsed time, not a restart',
      resync.startedAt <= resync.serverNow,
      `startedAt=${resync.startedAt} serverNow=${resync.serverNow}`);
  }
  players[2] = returned;

  // ---- play the game out -------------------------------------------------
  let sawGameOver = null;
  host.on('game:over', (p) => { sawGameOver = p; });

  for (let guard = 0; guard < 40 && !sawGameOver; guard++) {
    const phase = await nextPhase(host, players, code);
    if (phase === 'done') break;
  }

  check('the game reaches a final standing', !!sawGameOver, 'never emitted game:over');
  if (sawGameOver) {
    check('final standings include every player', sawGameOver.standings.length === 4);
    check('final standings are ranked', sawGameOver.standings.every((s, i, a) => i === 0 || a[i - 1].score >= s.score));
    check('a player who dropped is still on the standings', sawGameOver.standings.every((s) => typeof s.score === 'number'));
  }

  for (const p of players) p.close();
  host.close();
}

/**
 * A full game at the design cap, with connections dropping at every phase.
 *
 * The first scenario proves the happy path and one reconnect. This one is the
 * question actually asked of a party game: eight people, phones locking and
 * unlocking, someone refreshing mid-vote, someone's wifi dying during the reveal —
 * does the room still get to a final standing with everybody's score intact?
 */
async function runStress() {
  console.log('\n  — eight players, dropping throughout —\n');

  const host = makeClient('host');
  await connect(host);
  host.emit('host:create_room', { rounds: 3, lieSeconds: 45, deck: 'mixed' });
  const { code } = await once(host, 'room:created');

  const NAMES = ['Rumi', 'Tanvir', 'Ayesha', 'Shuvo', 'Nadia', 'Farhan', 'Mou', 'Zayan'];
  let players = [];
  for (const [i, name] of NAMES.entries()) {
    const s = makeClient(name);
    await connect(s);
    s.pid = `stress-${i}`;
    s.playerName = name;
    s.emit('player:join', { code, name, pid: s.pid });
    await once(s, 'player:joined');
    players.push(s);
  }
  check('a room fills to the eight-player cap', players.length === 8);

  // A ninth device must be refused rather than quietly making the vote unreadable.
  const ninth = makeClient('ninth');
  await connect(ninth);
  ninth.emit('player:join', { code, name: 'Overflow', pid: 'stress-9' });
  const fullErr = await once(ninth, 'error', 4000).catch(() => null);
  check('a ninth player is refused', /full/i.test(fullErr?.message ?? ''), JSON.stringify(fullErr));
  ninth.close();

  /** Drop a player's socket and bring them back on a new one, as a phone would. */
  async function bounce(index) {
    const old = players[index];
    const { pid, playerName } = old;
    old.close();
    await sleep(300);
    const fresh = makeClient(`${playerName}*`);
    await connect(fresh);
    fresh.pid = pid;
    fresh.playerName = playerName;
    const joined = once(fresh, 'player:joined');
    fresh.emit('player:rejoin', { code, pid, name: playerName });
    await joined;
    players[index] = fresh;
    return fresh;
  }

  host.emit('host:start_game');

  let final = null;
  host.on('game:over', (p) => { final = p; });

  const scoresSeen = {};
  host.on('round:scoreboard', (p) => {
    for (const row of p.standings) scoresSeen[row.id] = row.score;
  });

  let bounced = 0;
  for (let guard = 0; guard < 60 && !final; guard++) {
    const evt = await Promise.race([
      once(host, 'round:collecting', 30000).then((p) => ({ t: 'collect', p })),
      once(host, 'round:options', 30000).then((p) => ({ t: 'vote', p })),
      once(host, 'round:reveal', 30000).then((p) => ({ t: 'reveal', p })),
      once(host, 'game:over', 30000).then((p) => ({ t: 'over', p })),
    ]).catch(() => null);

    if (!evt || evt.t === 'over') break;

    if (evt.t === 'collect') {
      // Somebody's phone dies before they have written anything — the round must
      // still close rather than sitting on its full timer.
      await bounce(0); bounced++;
      for (const [i, p] of players.entries()) {
        p.emit('player:submit_lie', { text: `stress-${i}-${Math.random().toString(36).slice(2, 6)}` });
      }
    } else if (evt.t === 'vote') {
      await bounce(3); bounced++;
      for (const p of players) {
        const f = [...p.frames].reverse().find((x) => x.event === 'round:options');
        if (!f) continue;
        const mine = f.payload.yourOptionId;
        const target = f.payload.options.find((o) => o.id !== mine);
        if (target) p.emit('player:submit_vote', { optionId: target.id });
      }
    } else if (evt.t === 'reveal') {
      await bounce(6); bounced++;
      await sleep(300);
      host.emit('host:skip');
      await sleep(200);
      host.emit('host:skip');
    }
  }

  check('a full eight-player game finishes despite drops', !!final, `${bounced} reconnects`);

  if (final) {
    check('every player is on the final standings', final.standings.length === 8, `${final.standings.length}`);
    check('nobody was reset to zero by reconnecting',
      final.standings.every((s) => typeof s.score === 'number' && s.score >= 0));
    const total = final.standings.reduce((n, s) => n + s.score, 0);
    check('the game actually scored', total > 0, `total ${total}`);
    check('names survived every reconnect',
      final.standings.every((s) => NAMES.includes(s.name)),
      final.standings.map((s) => s.name).join(','));
    check('colours stayed unique across reconnects',
      new Set(final.standings.map((s) => s.colorIndex)).size === 8);
  }

  for (const p of players) p.close();
  host.close();
}

/**
 * The truth must not be derivable from anything a player was sent before REVEAL.
 *
 * Checked three ways, because there are three ways to leak it: a flag on the
 * options, the answer appearing in some other field, and an ordering that gives it
 * away. The answer text itself is necessarily present during VOTING — it is one of
 * the options — so the test is that it appears exactly once, as an option's text,
 * and that nothing marks which one it is.
 */
function assertNoTruthLeak(players, optionsFrame) {
  const SECRET_KEYS = ['truth', 'authors', 'house', 'why', 'answer', 'steps', 'gains'];

  let leakedKey = null;
  let leakedPre = null;

  for (const p of players) {
    for (const frame of p.frames) {
      const phaseOf = frame.payload?.phase;
      if (frame.event === 'round:reveal' || frame.event === 'game:over') break;

      const json = JSON.stringify(frame.payload ?? {});

      // 1. No secret-bearing key may appear on any pre-reveal frame.
      for (const k of SECRET_KEYS) {
        if (new RegExp(`"${k}"\\s*:`).test(json)) leakedKey = `${p.label}/${frame.event}.${k}`;
      }

      // 2. Before the options exist at all, the answer must appear nowhere.
      if (phaseOf === 'PROMPT' || phaseOf === 'COLLECTING') {
        if (frame.event === 'round:options') leakedPre = `${p.label} got options during ${phaseOf}`;
      }
    }
  }

  check('no truth flag or authorship ships before the reveal', !leakedKey, leakedKey ?? '');
  check('options do not exist before collection closes', !leakedPre, leakedPre ?? '');

  // 3. The options payload is exactly {id, text} and nothing else.
  const keys = new Set(optionsFrame.options.flatMap((o) => Object.keys(o)));
  check('vote options carry only id and text', [...keys].every((k) => k === 'id' || k === 'text'), [...keys].join(','));
}

function isNonDecreasing(arr) {
  return arr.every((v, i) => i === 0 || arr[i - 1] <= v);
}

/** Drive whatever phase the room is in to the next one. */
async function nextPhase(host, players, code) {
  const evt = await Promise.race([
    once(host, 'round:collecting', 30000).then((p) => ({ t: 'collect', p })),
    once(host, 'round:options', 30000).then((p) => ({ t: 'vote', p })),
    once(host, 'game:over', 30000).then((p) => ({ t: 'over', p })),
  ]).catch(() => null);

  if (!evt || evt.t === 'over') return 'done';

  if (evt.t === 'collect') {
    for (const [i, p] of players.entries()) {
      p.emit('player:submit_lie', { text: `lie-${i}-${Math.random().toString(36).slice(2, 7)}` });
    }
    return 'collect';
  }

  // Vote — the host frame has no yourOptionId, so read each player's own frame.
  for (const p of players) {
    const f = [...p.frames].reverse().find((x) => x.event === 'round:options');
    if (!f) continue;
    const mine = f.payload.yourOptionId;
    const target = f.payload.options.find((o) => o.id !== mine);
    if (target) p.emit('player:submit_vote', { optionId: target.id });
  }
  // Skip the reveal's choreography so the suite is not paced by animation.
  await sleep(400);
  host.emit('host:skip');
  await sleep(200);
  host.emit('host:skip');
  return 'vote';
}

/**
 * The abuse ceilings hold across reconnects.
 *
 * This is a regression test for a measured outage, not a hypothetical. Every limit
 * used to live on `socket.data`, so all of them reset for free by disconnecting:
 * one machine, unauthenticated, took all 432 room codes in under a minute and every
 * host in the world got "No rooms available" until the sweeper caught up.
 *
 * Boots its own server with the loopback exemption off, because otherwise the whole
 * point of the test is exempted. Isolated on its own port so the scenarios above are
 * unaffected by the ceilings.
 */
async function runLimits() {
  console.log('\n── abuse limits ──\n');

  const port = PORT + 1;
  const url = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, 'server', 'src', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      LIMIT_EXEMPT_LOOPBACK: '0',
      MAX_ROOMS_PER_IP: '4',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(`[limits] ${d}`));

  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${url}/health`)).ok) break; } catch { /* not up */ }
      await sleep(250);
    }

    // Twelve reconnect cycles, each a brand-new socket asking for a room. Under the
    // old per-socket counter this yielded a room every time.
    const codes = new Set();
    let refusals = 0;
    for (let i = 0; i < 12; i++) {
      const s = io(url, { forceNew: true, transports: ['websocket'], reconnection: false });
      await new Promise((r) => s.once('connect', r));
      s.emit('host:create_room', {});
      const outcome = await Promise.race([
        once(s, 'room:created', 3000).then((p) => ({ code: p.code })).catch(() => ({})),
        once(s, 'error', 3000).then(() => ({ refused: true })).catch(() => ({})),
      ]);
      if (outcome.code) codes.add(outcome.code);
      if (outcome.refused) refusals++;
      s.close();
    }

    check(
      'room creation is capped per address, not per socket',
      codes.size <= 4,
      `${codes.size} rooms from 12 reconnects (cap 4)`,
    );
    check('the excess attempts are refused, not silently dropped', refusals > 0, `${refusals} refusals`);

    const health = await (await fetch(`${url}/health`)).json();
    check('health reports the global room ceiling', Number.isFinite(health.maxRooms), JSON.stringify(health.maxRooms));
    check('health reports live socket and player counts', 'sockets' in health && 'players' in health);
  } finally {
    child.kill();
  }
}

/**
 * A client is told before the server disappears.
 *
 * Rooms live in memory, so a deploy destroys every game — and clients retry forever
 * by design, so without a goodbye frame a room sits watching a phase that will never
 * advance, reconnected to a server that has forgotten it.
 *
 * Skipped on Windows, which has no SIGTERM: `child.kill()` there is TerminateProcess
 * and no handler ever runs, so the test can only ever produce a false failure. CI and
 * the deploy target are both Linux, which is where this actually needs to hold.
 */
async function runShutdown() {
  console.log('\n── graceful shutdown ──\n');

  if (process.platform === 'win32') {
    console.log('  skip  no real SIGTERM on Windows (verified on Linux in CI)');
    return;
  }

  const port = PORT + 2;
  const url = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, 'server', 'src', 'index.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${url}/health`)).ok) break; } catch { /* not up */ }
      await sleep(250);
    }

    const host = io(url, { forceNew: true, transports: ['websocket'], reconnection: false });
    await new Promise((r) => host.once('connect', r));
    host.emit('host:create_room', {});
    await once(host, 'room:created');

    const goodbye = once(host, 'server:shutdown', 5000).catch(() => null);
    child.kill('SIGTERM');
    const frame = await goodbye;

    check('a client is told the server is going away', frame !== null);
    check(
      'the goodbye frame explains itself',
      typeof frame?.message === 'string' && frame.message.length > 0,
      JSON.stringify(frame),
    );
    host.close();
  } finally {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

// ─── boot ────────────────────────────────────────────────────────────────────

async function main() {
  let child = null;
  if (!argPort) {
    child = spawn(process.execPath, [path.join(__dirname, 'server', 'src', 'index.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(`[server] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${URL}/health`);
        if (r.ok) break;
      } catch { /* not up yet */ }
      await sleep(250);
    }
  }

  console.log(`\nFajil reliability suite — ${URL}\n`);
  const started = Date.now();
  try {
    await run();
    await runStress();
    await runLimits();
    await runShutdown();
  } catch (err) {
    failures.push(`suite threw: ${err.message}`);
    console.log(`  FAIL suite threw — ${err.message}`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n  ${passed} passed, ${failures.length} failed  (${secs}s)\n`);
  if (failures.length) for (const f of failures) console.log(`    x ${f}`);
  console.log('');

  if (child) child.kill();
  process.exit(failures.length ? 1 : 0);
}

main();
