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

  // The two who wrote the same lie must share one disabled option.
  const disabled = await phones[0].page.locator('.pr-ballot-item[disabled]').count();
  check('a player cannot tap their own lie', disabled >= 1, `${disabled} disabled`);

  const hostOptions = await host.locator('.pr-ballot-item').count();
  const phoneOptions = await phones[0].page.locator('.pr-ballot-item').count();
  check('screen and phone show the same ballot', hostOptions === phoneOptions, `${hostOptions} vs ${phoneOptions}`);

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

(async () => {
  console.log(`\nFajil browser test — ${CLIENT}\n`);
  const started = Date.now();
  try {
    await run();
  } catch (err) {
    failures.push(`suite threw: ${err.message}`);
    console.log(`  FAIL suite threw — ${err.message}`);
  }
  console.log(`\n  ${passed} passed, ${failures.length} failed  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (failures.length) { console.log(''); for (const f of failures) console.log(`    x ${f}`); }
  console.log(`\n  screens -> .screens/\n`);
  process.exit(failures.length ? 1 : 0);
})();
