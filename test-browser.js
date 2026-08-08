#!/usr/bin/env node
/**
 * The real browser path: one shared screen and three phones through a whole round.
 *
 * The reliability suite proves the protocol; this proves the thing people actually
 * touch. It also captures every phase to .screens/ at both a television width and a
 * phone width, because "does it fit" is not something a socket test can see.
 *
 *   node test-browser.js                       # test + capture
 *   node test-browser.js --url http://host:5273 --server http://host:3101
 */

const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};

const CLIENT = arg('--url', 'http://localhost:5273');
const OUT = path.join(__dirname, '.screens');

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
// The size that proves something: the SE and most of the cheap Android fleet.
const SMALL_PHONE = { width: 360, height: 640 };

let passed = 0;
const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
};

/**
 * The audio probe, installed before the app loads.
 *
 * Wraps the real `AudioContext` rather than standing in for `cues.js`, because the
 * assertions worth having here are about the two things a mock of the cue layer
 * would have to assume: that a context is not built until a gesture arms one, and
 * that a phase hands its whole sequence to Web Audio in one pass instead of
 * chaining it off timers. Both are visible as the `when` a source is started with,
 * and neither is visible from inside the module.
 *
 * Nothing here asserts a cue *sounds* — headless Chromium has no speaker and the
 * context may sit suspended all run. That is the right boundary: `cues.js` gates on
 * `armed` and not on `ctx.state` precisely so that a suspended-but-armed context
 * still honours what is scheduled against it, so scheduling is the observable.
 */
function audioProbe() {
  window.__audio = { contexts: 0, starts: [] };
  const Native = window.AudioContext || window.webkitAudioContext;
  if (!Native) return;

  function Patched(...args) {
    const ctx = new Native(...args);
    window.__audio.contexts += 1;
    for (const fn of ['createOscillator', 'createBufferSource']) {
      const make = ctx[fn].bind(ctx);
      ctx[fn] = (...a) => {
        const node = make(...a);
        const start = node.start.bind(node);
        node.start = (when, ...rest) => {
          const w = typeof when === 'number' ? when : ctx.currentTime;
          // Lead, not absolute time: "how far ahead was this booked" is the question.
          // `t` is wall-clock, and is what separates one sequence from a stray cue.
          window.__audio.starts.push({ lead: w - ctx.currentTime, t: performance.now() });
          return start(when, ...rest);
        };
        return node;
      };
    }
    return ctx;
  }
  Patched.prototype = Native.prototype;
  window.AudioContext = Patched;
  window.webkitAudioContext = Patched;
}

/**
 * The haptics probe.
 *
 * Defines `navigator.vibrate` rather than only recording it, so the phone's half is
 * tested on a headless Chromium that may not carry the API at all — and so the
 * assertion can name the exact pattern. `haptics.js` feature-detects at module
 * load, which is after this runs.
 */
function hapticProbe() {
  window.__buzz = [];
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    writable: true,
    value: (p) => { window.__buzz.push(Array.isArray(p) ? p.join(',') : String(p)); return true; },
  });
}

const audioStats = (page) => page.evaluate(() => {
  const s = window.__audio ? window.__audio.starts : [];
  return {
    contexts: window.__audio ? window.__audio.contexts : -1,
    count: s.length,
    maxLead: s.reduce((m, e) => Math.max(m, e.lead), 0),
  };
});

/**
 * Nothing on either side of this game may scroll the document.
 *
 * The shared screen is across a room with no one holding a mouse, and the phone is
 * a controller — a screen that needs scrolling to reach its own button is broken in
 * a way that looks like the game has frozen.
 */
async function assertNoScroll(page, label) {
  const overflow = await page.evaluate(() => ({
    v: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    h: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  check(`${label}: no vertical page scroll`, overflow.v <= 1, `${overflow.v}px over`);
  check(`${label}: no horizontal page scroll`, overflow.h <= 1, `${overflow.h}px over`);

  /**
   * The page being a strict viewport box means it can no longer scroll — which
   * turns an overflow into silent clipping rather than a scrollbar. That is a
   * worse failure, not a fixed one, so it needs its own assertion: nothing may
   * extend past the bottom of the viewport unless it lives inside a region that
   * is allowed to scroll.
   */
  const clipped = await page.evaluate(() => {
    const vh = window.innerHeight;
    const out = [];
    for (const el of document.querySelectorAll('.pr-body > *, .pr-body > * > *')) {
      if (el.closest('.pr-scroll')) continue;      // allowed to overflow its own box
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.bottom > vh + 1) out.push(`${el.className}`.slice(0, 50) + ` bottom=${Math.round(r.bottom)}/${vh}`);
    }
    return out;
  });
  check(`${label}: nothing clipped off the bottom`, clipped.length === 0, clipped.join(' | '));
}

/** Every control a thumb has to hit clears 44px. */
async function assertTapTargets(page, label) {
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button:not([disabled]), input')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 44) out.push(`${el.tagName}.${el.className}`.slice(0, 60) + ` h=${Math.round(r.height)}`);
    }
    return out;
  });
  check(`${label}: every control clears 44px`, small.length === 0, small.join(' | '));
}

async function run() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ── the shared screen ────────────────────────────────────────────────────
  const hostCtx = await browser.newContext({ viewport: DESKTOP });
  const host = await hostCtx.newPage();
  const hostErrors = [];
  host.on('pageerror', (e) => hostErrors.push(e.message));
  await host.addInitScript(audioProbe);
  await host.goto(CLIENT, { waitUntil: 'networkidle' });

  await host.getByTestId('create-room').waitFor({ timeout: 20000 });
  await shot(host, '01-host-landing');
  await assertNoScroll(host, 'host landing');

  // Autoplay policy: a context built before a gesture is one that never sounds, and
  // the failure is silent — the platen opening round one is the first sound of the
  // night and the one nobody would notice missing until the room is already playing.
  check('no audio context exists before a gesture', (await audioStats(host)).contexts === 0);

  check('the shared screen carries a sound switch',
    await host.getByTestId('sound-toggle').count() === 1);
  check('the switch starts on',
    await host.getByTestId('sound-toggle').getAttribute('aria-pressed') === 'true');

  await host.getByTestId('rounds-3').click();
  await host.getByTestId('deck-mixed').click();
  await host.getByTestId('create-room').click();

  await host.getByTestId('room-code').waitFor({ timeout: 15000 });
  const code = (await host.getByTestId('room-code').textContent()).trim();
  check('room code is four characters', /^[A-Z0-9]{4}$/.test(code), code);
  await shot(host, '02-host-lobby-empty');

  check('the first click arms audio', (await audioStats(host)).contexts === 1);

  // ── three phones ─────────────────────────────────────────────────────────
  const phones = [];
  for (const [i, name] of ['Rumi', 'Tanvir', 'Ayesha'].entries()) {
    const ctx = await browser.newContext({
      viewport: i === 2 ? SMALL_PHONE : PHONE,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => hostErrors.push(`${name}: ${e.message}`));
    await page.addInitScript(audioProbe);
    await page.addInitScript(hapticProbe);
    await page.goto(CLIENT, { waitUntil: 'networkidle' });

    await page.getByTestId('join-code').fill(code);
    await page.getByTestId('join-name').fill(name);
    if (i === 0) { await shot(page, '03-phone-join'); await assertTapTargets(page, 'phone join'); }
    await page.getByTestId('join-submit').click();
    await page.locator('.pl-me-name').waitFor({ timeout: 15000 });
    phones.push({ page, ctx, name });
  }

  await shot(phones[0].page, '04-phone-lobby');
  await assertNoScroll(phones[0].page, 'phone lobby');
  await host.waitForTimeout(500);
  await shot(host, '05-host-lobby-full');
  await assertNoScroll(host, 'host lobby');

  const roster = await host.locator('.hs-roster-list .pr-chip').count();
  check('all three players appear on the shared screen', roster === 3, `${roster} chips`);

  // ── round one ────────────────────────────────────────────────────────────
  await host.getByTestId('start-game').click();

  await phones[0].page.getByTestId('lie-input').waitFor({ timeout: 20000 });
  await shot(host, '06-host-collecting');
  await assertNoScroll(host, 'host collecting');
  await shot(phones[0].page, '07-phone-write');
  await assertNoScroll(phones[0].page, 'phone write');
  await assertTapTargets(phones[0].page, 'phone write');
  await shot(phones[2].page, '07b-phone-write-small');
  await assertNoScroll(phones[2].page, 'phone write (360x640)');

  /**
   * The clock, handed to Web Audio in one pass.
   *
   * COLLECTING books a rise and five bells against a deadline up to 45s away, so a
   * lead measured in tens of seconds is proof the sequence went to the audio clock
   * rather than to a chain of `setTimeout`s. That distinction is the whole reason
   * the countdown lands on the same frame the pixels do, and a regression to timers
   * would still pass every other assertion in this file.
   */
  const collecting = await audioStats(host);
  check('the shared screen speaks during a round', collecting.count > 0);
  check('the countdown is scheduled on the audio clock, not on timers',
    collecting.maxLead > 20, `longest lead ${collecting.maxLead.toFixed(1)}s`);

  const lies = ['Mango', 'Mango', 'The Sundarbans'];
  for (const [i, p] of phones.entries()) {
    await p.page.getByTestId('lie-input').fill(lies[i]);
    await p.page.getByTestId('lie-submit').click();
  }

  // ── voting ───────────────────────────────────────────────────────────────
  await phones[0].page.locator('.pr-ballot-item').first().waitFor({ timeout: 25000 });
  await host.waitForTimeout(400);
  await shot(host, '08-host-voting');
  await assertNoScroll(host, 'host voting');
  await shot(phones[0].page, '09-phone-vote');
  await assertNoScroll(phones[0].page, 'phone vote');
  await assertTapTargets(phones[0].page, 'phone vote');

  // The two who wrote the same lie must share one option, struck out on both phones.
  const own = await phones[0].page.locator('.pr-ballot-item--own[disabled]').count();
  check('a player cannot tap their own lie', own === 1, `${own} marked own`);

  const hostOptions = await host.locator('.pr-ballot-item').count();
  const phoneOptions = await phones[0].page.locator('.pr-ballot-item').count();
  check('screen and phone show the same ballot', hostOptions === phoneOptions, `${hostOptions} vs ${phoneOptions}`);

  // The shared screen is not an input. Rendering it as buttons with no handler made
  // every option :disabled, so the whole television board wore the "this is your
  // own lie" hatching and the room was asked to vote on nine struck-out options.
  const hostDisabled = await host.locator('.pr-ballot-item[disabled], .pr-ballot-item--own').count();
  check('the shared screen does not render its ballot as disabled', hostDisabled === 0, `${hostDisabled} struck out`);

  // Options are called out by letter across a room, so every one needs a letter —
  // at nine options an 8-letter alphabet silently fell back to "9".
  const letters = await host.locator('.pr-ballot-letter').allTextContents();
  check('every option has a letter, not a number', letters.every((l) => /^[A-Z]$/.test(l)), letters.join(''));

  // Everyone votes for the first option they are allowed to.
  for (const p of phones) {
    await p.page.locator('.pr-ballot-item:not([disabled])').first().click();
  }

  const beforeReveal = await host.evaluate(() => window.__audio.starts.length);

  // ── reveal ───────────────────────────────────────────────────────────────
  await host.locator('.hs-card').first().waitFor({ timeout: 30000 });

  /**
   * The reveal's sequence, booked from the server's own beat schedule.
   *
   * Two properties in one read, and they pull in opposite directions — which is why
   * both are here. The opening beat sits at offset 0 but is read after the frame has
   * crossed a socket and rendered, so a strict past-due filter drops it every single
   * time and the corrections open on silence; `BEAT_GRACE_MS` is what keeps it, and
   * a lead of about zero is what that looks like from outside. The card beats run
   * seconds deep and must already be booked, not waiting on a timer.
   *
   * Read as one contiguous burst rather than as everything since the vote, because
   * the last phone's vote tick lands after that snapshot more often than not — and
   * it would satisfy the near-zero lead on its own, leaving the assertion green with
   * the opening beat gone. The sequence goes to Web Audio in a single synchronous
   * pass, so its voices are the burst; a stray tick is not in it.
   */
  const revealLeads = await host.evaluate((from) => {
    let best = [];
    let run = [];
    for (const e of window.__audio.starts.slice(from)) {
      if (run.length && e.t - run[run.length - 1].t > 20) {
        if (run.length > best.length) best = run;
        run = [];
      }
      run.push(e);
    }
    return (run.length > best.length ? run : best).map((e) => e.lead);
  }, beforeReveal);
  check('the reveal opens on its first beat rather than dropping it as past due',
    revealLeads.some((l) => l < 0.2),
    `${revealLeads.length} voices, earliest at ${Math.min(...revealLeads).toFixed(2)}s`);
  check('the reveal books its later beats ahead of time',
    revealLeads.some((l) => l > 0.5), `longest lead ${Math.max(0, ...revealLeads).toFixed(2)}s`);

  /**
   * The beat grace, asked of `sequence` directly.
   *
   * It cannot be provoked through a real reveal on this host: `elapsedMs` clamps at
   * zero and a loopback socket puts the offset inside a millisecond, so `elapsed` is
   * 0 here and a strict `at < elapsed` never fires. The trap needs a real network to
   * appear, which is exactly why it survived being written — and why the assertion
   * above, which is worth having for other regressions, cannot be the one that pins
   * it. So the rule is asked of the module.
   *
   * Both directions matter and they are the whole point of a grace rather than a
   * looser filter: a beat that is barely late is the frame that just arrived and
   * must still play, while one that is genuinely behind is a screen that rejoined
   * mid-reveal and must not re-stamp a truth it printed eight seconds ago.
   *
   * Reached through the dev server's own module graph, so this is the instance the
   * app is running — already armed by the clicks that opened the room.
   */
  const grace = await host.evaluate(async () => {
    const m = await import('/src/game/cues.js');
    const n = () => window.__audio.starts.length;
    const from = n();
    m.sequence([{ at: 0, name: 'platen' }], 200, 'probe-late', 600);
    const late = n() - from;
    m.sequence([{ at: 0, name: 'platen' }], 5000, 'probe-stale', 600);
    const stale = n() - from - late;
    m.kill('probe-late');
    m.kill('probe-stale');
    return { late, stale };
  });
  check('a beat that is barely past due is still played', grace.late > 0, `${grace.late} voices`);
  check('a beat left behind by a mid-reveal rejoin is dropped', grace.stale === 0, `${grace.stale} voices`);

  await host.waitForTimeout(1200);
  await shot(host, '10-host-reveal-early');

  // The shared screen is the only voice in the room. Eight phones would fight the
  // television and the one on hotel wifi is the one everybody hears.
  for (const p of phones) {
    check(`${p.name}'s phone makes no sound of its own`, (await audioStats(p.page)).contexts === 0);
  }
  check('a phone carries no sound switch',
    await phones[0].page.getByTestId('sound-toggle').count() === 0);

  /**
   * The phone's half. Patterns rather than a call count, because two of these are
   * not confirmations but summonses — the box opening and the ballot going up are
   * the moments the phone is face-down on the table — and a summons that got the
   * acknowledgement's short tap would not be felt.
   */
  const buzzes = await phones[0].page.evaluate(() => window.__buzz);
  check('the phone summons its owner when the box opens', buzzes.includes('18,60,18'), buzzes.join(' / '));
  check('the phone confirms a lie filed', buzzes.includes('12,28,20'), buzzes.join(' / '));
  check('the phone summons its owner when the ballot goes up', buzzes.includes('14,45,14,45,14'), buzzes.join(' / '));
  check('the phone confirms a vote cast', buzzes.includes('16'), buzzes.join(' / '));

  await host.locator('.hs-card--truth').waitFor({ timeout: 30000 });
  await host.waitForTimeout(600);
  await shot(host, '11-host-reveal-truth');
  await assertNoScroll(host, 'host reveal');
  check('the truth card is rendered', await host.locator('.hs-card--truth').count() === 1);

  const merged = await host.locator('.hs-card').filter({ hasText: 'MANGO' }).count();
  check('the duplicate lie appears once, not twice', merged <= 1, `${merged} cards`);

  await shot(phones[0].page, '12-phone-reveal');
  await assertNoScroll(phones[0].page, 'phone reveal');

  // ── scoreboard ───────────────────────────────────────────────────────────
  await host.locator('.hs-table').waitFor({ timeout: 40000 });
  await host.waitForTimeout(400);
  await shot(host, '13-host-scoreboard');
  await assertNoScroll(host, 'host scoreboard');
  await shot(phones[0].page, '14-phone-scoreboard');

  /**
   * The sound switch, both ways.
   *
   * Off is asserted across a real phase change rather than immediately, because
   * silencing what is already scheduled and refusing to schedule the next phase are
   * different code paths and only the second one is what a host who muted the
   * television is asking for. On is asserted too: a switch that mutes permanently
   * is the same bug wearing a label.
   */
  const toggle = host.getByTestId('sound-toggle');
  await toggle.click();
  check('the switch reads Muted once it is off', (await toggle.textContent()).includes('Muted'));
  check('the switch reports its state to a screen reader',
    await toggle.getAttribute('aria-pressed') === 'false');
  check('the preference is kept for the next game',
    await host.evaluate(() => localStorage.getItem('fajil_sound')) === '0');

  const muted = await host.evaluate(() => window.__audio.starts.length);
  await phones[0].page.getByTestId('lie-input').waitFor({ timeout: 30000 });   // round two
  await host.waitForTimeout(500);
  const afterRound = await host.evaluate(() => window.__audio.starts.length);
  check('muted, a whole phase change schedules nothing',
    afterRound === muted, `${afterRound - muted} voices`);

  await toggle.click();
  check('the preference is written back on',
    await host.evaluate(() => localStorage.getItem('fajil_sound')) === '1');
  await host.waitForTimeout(600);
  const afterOn = await host.evaluate(() => window.__audio.starts.length);
  check('switched back on, the press is audible again',
    afterOn > afterRound, `${afterOn - afterRound} voices`);

  // ── a phone refreshes mid-game ───────────────────────────────────────────
  // The thing a real player does without thinking, and the thing that used to end
  // their game. They must come back to the same seat with the same score.
  const before = await phones[0].page.locator('.pl-row--me .pr-score').first().textContent().catch(() => null);
  await phones[0].page.reload({ waitUntil: 'networkidle' });
  await phones[0].page.waitForTimeout(2500);
  const backIn = await phones[0].page.locator('.pr-masthead').count();
  check('a phone that refreshes mid-game comes back into the room', backIn > 0);
  const stillJoin = await phones[0].page.getByTestId('join-submit').count();
  check('a refreshed phone is not sent back to the join form', stillJoin === 0);
  await shot(phones[0].page, '15-phone-after-refresh');
  void before;

  // ── night edition ────────────────────────────────────────────────────────
  await host.evaluate(() => document.documentElement.setAttribute('data-edition', 'night'));
  await host.waitForTimeout(250);
  await shot(host, '16-host-night');
  await host.evaluate(() => document.documentElement.removeAttribute('data-edition'));

  check('no uncaught page errors', hostErrors.length === 0, hostErrors.slice(0, 3).join(' | '));

  await browser.close();
}

/**
 * The layout at the design cap.
 *
 * Three fixtures prove nothing about a screen that has to hold nine options and
 * nine reveal cards — that is the density every party-game layout breaks at. Seven
 * of the eight players are driven over raw sockets rather than as browser contexts,
 * because what is being tested is what the shared screen renders, not eight copies
 * of a phone.
 */
async function runAtCap() {
  console.log('\n  — at the eight-player cap —\n');
  const { io } = require('socket.io-client');
  const SERVER = arg('--server', 'http://localhost:3101');

  const browser = await chromium.launch();
  const hostCtx = await browser.newContext({ viewport: DESKTOP });
  const host = await hostCtx.newPage();
  await host.goto(CLIENT, { waitUntil: 'networkidle' });
  await host.getByTestId('create-room').waitFor({ timeout: 20000 });
  await host.getByTestId('rounds-3').click();
  await host.getByTestId('create-room').click();
  await host.getByTestId('room-code').waitFor({ timeout: 15000 });
  const code = (await host.getByTestId('room-code').textContent()).trim();

  const bots = [];
  for (let i = 0; i < 8; i++) {
    const s = io(SERVER, { forceNew: true, transports: ['websocket'] });
    await new Promise((r) => s.once('connect', r));
    s.pid = `cap-${i}`;
    s.emit('player:join', { code, name: `Player${i + 1}`, pid: s.pid });
    await new Promise((r) => s.once('player:joined', r));
    // Each bot writes a distinct lie, so the board reaches its full nine options.
    s.on('round:collecting', () => s.emit('player:submit_lie', { text: `Decoy number ${i + 1}` }));
    // Hold the latest options rather than voting on arrival. Eight bots voting
    // immediately end the phase in about 120ms, so the shared screen's vote layout
    // exists for less time than it takes to assert anything about it — the layout
    // would go unchecked while the test still passed.
    s.on('round:options', (p) => { s.pending = p; });
    bots.push(s);
  }

  const castVotes = () => {
    for (const s of bots) {
      const p = s.pending;
      if (!p) continue;
      const target = p.options.find((o) => o.id !== p.yourOptionId);
      if (target) s.emit('player:submit_vote', { optionId: target.id });
      s.pending = null;
    }
  };

  await host.waitForTimeout(700);
  await shot(host, '20-host-lobby-8');
  await assertNoScroll(host, 'host lobby (8 players)');
  const chips = await host.locator('.hs-roster-list .pr-chip').count();
  check('all eight players fit the lobby roster', chips === 8, `${chips} chips`);

  await host.getByTestId('start-game').click();

  await host.locator('.pr-ballot-item').first().waitFor({ timeout: 30000 });
  await host.waitForTimeout(500);
  const options = await host.locator('.pr-ballot-item').count();
  check('the ballot carries every lie plus the truth', options >= 8, `${options} options`);
  await shot(host, '21-host-voting-8');
  await assertNoScroll(host, 'host voting (8 players)');

  castVotes();

  await host.locator('.hs-card--truth').waitFor({ timeout: 40000 });
  await host.waitForTimeout(600);
  const cards = await host.locator('.hs-card').count();
  check('the reveal renders every card', cards >= 8, `${cards} cards`);
  await shot(host, '22-host-reveal-8');
  await assertNoScroll(host, 'host reveal (8 players)');

  // The truth is the last beat, so if the list did not follow the reveal it is now
  // scrolled out of sight — which is the failure this whole scroll mechanism exists
  // to prevent.
  const truthVisible = await host.locator('.hs-card--truth').isVisible();
  const inView = await host.locator('.hs-card--truth').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight + 1;
  });
  check('the truth card is on screen when it lands', truthVisible && inView);

  // The "why it matters" panel appears after the last card and takes height from
  // the card list. The answer must not slide out of view underneath a paragraph
  // explaining the answer.
  await host.locator('.hs-why').waitFor({ timeout: 30000 });
  await host.waitForTimeout(700);
  const stillInView = await host.locator('.hs-card--truth').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight + 1;
  });
  check('the truth stays in view once the why panel arrives', stillInView);

  await host.locator('.hs-table').waitFor({ timeout: 40000 });
  await host.waitForTimeout(400);
  await shot(host, '23-host-scoreboard-8');
  await assertNoScroll(host, 'host scoreboard (8 players)');
  const rows = await host.locator('.hs-row').count();
  check('every player is on the scoreboard', rows === 8, `${rows} rows`);

  for (const s of bots) s.close();
  await browser.close();
}

(async () => {
  console.log(`\nFajil browser test — ${CLIENT}\n`);
  const started = Date.now();
  try {
    await run();
    await runAtCap();
  } catch (err) {
    failures.push(`suite threw: ${err.message}`);
    console.log(`  FAIL suite threw — ${err.message}`);
  }
  console.log(`\n  ${passed} passed, ${failures.length} failed  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (failures.length) { console.log(''); for (const f of failures) console.log(`    x ${f}`); }
  console.log(`\n  screens -> .screens/\n`);
  process.exit(failures.length ? 1 : 0);
})();
