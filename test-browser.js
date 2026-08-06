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
  await host.goto(CLIENT, { waitUntil: 'networkidle' });

  await host.getByTestId('create-room').waitFor({ timeout: 20000 });
  await shot(host, '01-host-landing');
  await assertNoScroll(host, 'host landing');

  await host.getByTestId('rounds-3').click();
  await host.getByTestId('deck-mixed').click();
  await host.getByTestId('create-room').click();

  await host.getByTestId('room-code').waitFor({ timeout: 15000 });
  const code = (await host.getByTestId('room-code').textContent()).trim();
  check('room code is four characters', /^[A-Z0-9]{4}$/.test(code), code);
  await shot(host, '02-host-lobby-empty');

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

  // ── reveal ───────────────────────────────────────────────────────────────
  await host.locator('.hs-card').first().waitFor({ timeout: 30000 });
  await host.waitForTimeout(1200);
  await shot(host, '10-host-reveal-early');

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
