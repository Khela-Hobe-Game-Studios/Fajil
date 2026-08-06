#!/usr/bin/env node
/**
 * Walk a whole game and photograph every screen.
 *
 *   npm run screens
 *
 * Plays one real 3-round game with a shared screen and three phones, capturing both
 * sides at every phase, then the night edition of the screens that matter most on a
 * television. Output lands in .screens/ (gitignored).
 *
 * This is the tool for looking at the design. `npm run verify` proves the game
 * works; only looking at it proves the game is any good.
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

let n = 0;
const pad = () => String(++n).padStart(2, '0');

async function shot(page, name) {
  const file = `${pad()}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  console.log(`  ${file}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Vote for the first option this phone is allowed to pick. */
async function vote(page) {
  const ok = page.locator('.pr-ballot-item:not([disabled])').first();
  await ok.waitFor({ timeout: 25000 });
  await ok.click();
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  console.log(`\nCapturing ${CLIENT}\n`);

  const browser = await chromium.launch();

  const host = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await host.goto(CLIENT, { waitUntil: 'networkidle' });
  await host.getByTestId('create-room').waitFor({ timeout: 20000 });

  // ── setup ────────────────────────────────────────────────────────────────
  await shot(host, 'host-landing');
  await host.getByTestId('rounds-3').click();
  await host.getByTestId('deck-mixed').click();
  await host.getByTestId('create-room').click();
  await host.getByTestId('room-code').waitFor({ timeout: 15000 });
  const code = (await host.getByTestId('room-code').textContent()).trim();
  await shot(host, 'host-lobby-empty');

  const phones = [];
  for (const name of ['Rumi', 'Tanvir', 'Ayesha']) {
    const page = await (await browser.newContext({
      viewport: PHONE, isMobile: true, hasTouch: true,
    })).newPage();
    await page.goto(CLIENT, { waitUntil: 'networkidle' });
    await page.getByTestId('join-code').fill(code);
    await page.getByTestId('join-name').fill(name);
    if (phones.length === 0) await shot(page, 'phone-join');
    await page.getByTestId('join-submit').click();
    await page.locator('.pl-me-name').waitFor({ timeout: 15000 });
    phones.push(page);
  }

  await shot(phones[0], 'phone-lobby');
  await sleep(400);
  await shot(host, 'host-lobby-full');

  // ── round one, in full ───────────────────────────────────────────────────
  await host.getByTestId('start-game').click();

  // PROMPT is only 3s, so this one has to be caught rather than waited for.
  await sleep(900);
  await shot(host, 'host-prompt');
  await shot(phones[0], 'phone-prompt');

  await phones[0].getByTestId('lie-input').waitFor({ timeout: 20000 });
  await shot(host, 'host-collecting');
  await shot(phones[0], 'phone-write-empty');

  await phones[0].getByTestId('lie-input').fill('The Meghna');
  await shot(phones[0], 'phone-write-typed');
  await phones[0].getByTestId('lie-submit').click();
  await phones[0].locator('.pl-filed-text').waitFor({ timeout: 10000 });
  await shot(phones[0], 'phone-filed');
  await sleep(300);
  await shot(host, 'host-collecting-partial');

  await phones[1].getByTestId('lie-input').fill('The Meghna');
  await phones[1].getByTestId('lie-submit').click();
  await phones[2].getByTestId('lie-input').fill('The Karnaphuli');
  await phones[2].getByTestId('lie-submit').click();

  // ── voting ───────────────────────────────────────────────────────────────
  await phones[0].locator('.pr-ballot-item').first().waitFor({ timeout: 25000 });
  await sleep(400);
  await shot(host, 'host-voting');
  await shot(phones[0], 'phone-vote');

  await vote(phones[0]);
  await phones[0].locator('.pl-filed-text').waitFor({ timeout: 10000 });
  await shot(phones[0], 'phone-voted');
  await sleep(300);
  await shot(host, 'host-voting-partial');

  await vote(phones[1]);
  await vote(phones[2]);

  // ── the reveal, beat by beat ─────────────────────────────────────────────
  await host.locator('.hs-card').first().waitFor({ timeout: 30000 });
  await sleep(700);
  await shot(host, 'host-reveal-first-card');
  await sleep(2200);
  await shot(host, 'host-reveal-midway');

  await host.locator('.hs-card--truth').waitFor({ timeout: 30000 });
  await sleep(500);
  await shot(host, 'host-reveal-truth');
  await shot(phones[0], 'phone-reveal');

  // The "why it matters" panel is the last beat of the reveal.
  await host.locator('.hs-why').waitFor({ timeout: 30000 });
  await sleep(400);
  await shot(host, 'host-reveal-why');

  // ── scoreboard ───────────────────────────────────────────────────────────
  await host.locator('.hs-table').waitFor({ timeout: 40000 });
  await sleep(400);
  await shot(host, 'host-scoreboard');
  await shot(phones[0], 'phone-scoreboard');

  // ── night edition, on the screens that live on a television ──────────────
  await host.evaluate(() => document.documentElement.setAttribute('data-edition', 'night'));
  await sleep(300);
  await shot(host, 'host-scoreboard-NIGHT');
  await host.evaluate(() => document.documentElement.removeAttribute('data-edition'));

  // ── rounds two and three, driven through to the finish ───────────────────
  for (let round = 2; round <= 3; round++) {
    await host.getByTestId('skip').click().catch(() => {});
    await phones[0].getByTestId('lie-input').waitFor({ timeout: 30000 });
    for (const [i, p] of phones.entries()) {
      await p.getByTestId('lie-input').fill(`Round ${round} lie ${i + 1}`);
      await p.getByTestId('lie-submit').click();
    }
    await phones[0].locator('.pr-ballot-item').first().waitFor({ timeout: 30000 });

    if (round === 3) {
      // The final round pays double, and says so.
      await sleep(400);
      await shot(host, 'host-voting-final-round');
    }
    for (const p of phones) await vote(p);

    await host.locator('.hs-card--truth').waitFor({ timeout: 40000 });
    await sleep(400);
    await host.getByTestId('skip').click().catch(() => {});
    await host.locator('.hs-table').waitFor({ timeout: 40000 });
    await sleep(300);
    if (round < 3) await host.getByTestId('skip').click().catch(() => {});
  }

  // ── the final table ──────────────────────────────────────────────────────
  await host.getByTestId('play-again').waitFor({ timeout: 40000 });
  await sleep(500);
  await shot(host, 'host-game-over');
  await shot(phones[0], 'phone-game-over');

  await host.evaluate(() => document.documentElement.setAttribute('data-edition', 'night'));
  await sleep(300);
  await shot(host, 'host-game-over-NIGHT');

  await browser.close();
  console.log(`\n  ${n} screens -> .screens/\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
