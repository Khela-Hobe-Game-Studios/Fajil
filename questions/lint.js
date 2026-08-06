#!/usr/bin/env node
/**
 * Question bank lint.
 *
 * The bank is content, and content is where this game lives or dies — a question
 * whose decoy is secretly also correct, or whose answer cannot be guessed by anyone,
 * ruins a round for eight people at once and there is no way to fix it mid-game.
 *
 *   node questions/lint.js
 *   node questions/lint.js --url "<published sheet csv url>"
 */

const path = require('path');
const { norm } = require('../server/src/lies');

const TIERS = ['desh', 'probash', 'shared'];

// Content policy, enforced rather than documented.
//
// Players write the lies here. A prompt about the Liberation War, the 2024 protests
// or the Rohingya invites somebody to write something tasteless, and it will then be
// displayed on a shared screen with their name attached at the reveal. These remain
// legitimate subjects of trivia and the schema keeps the field; they are simply not
// safe as bluffing fodder, so the deck refuses to carry them.
const BLOCKED_ERAS = ['1971'];
const BLOCKED_PATTERNS = [
  /\bliberation war\b/i,
  /\bgenocide\b/i,
  /\bmassacre\b/i,
  /\bmartyr/i,
  /\brohingya\b/i,
  /\bawami\b/i,
  /\bbnp\b/i,
  /\bjamaat\b/i,
  /\bcoup\b/i,
  /\bassassinat/i,
];

const errors = [];
const warnings = [];
const fail = (id, msg) => errors.push(`${id}: ${msg}`);
const warn = (id, msg) => warnings.push(`${id}: ${msg}`);

function lint(bank) {
  const seenIds = new Set();
  const seenPrompts = new Set();
  // Two questions may share an answer — "Brick Lane" is both a street and a novel —
  // but three is a theme the bank keeps circling, and any two of them drawn into the
  // same game make the second one's truth easier to spot. Collected here, judged once
  // at the end, so it stays a single pass.
  const byAnswer = new Map();

  for (const [i, q] of bank.entries()) {
    const id = q.id || `#${i}`;

    if (!q.id) fail(id, 'missing id');
    else if (seenIds.has(q.id)) fail(id, 'duplicate id');
    seenIds.add(q.id);

    if (typeof q.q !== 'string' || !q.q.trim()) { fail(id, 'missing prompt'); continue; }
    if (!q.q.includes('___')) fail(id, 'prompt has no ___ blank');
    if (q.q.length > 160) fail(id, `prompt is ${q.q.length} chars — too long to read across a room`);

    const pk = norm(q.q);
    if (seenPrompts.has(pk)) fail(id, 'duplicate prompt');
    seenPrompts.add(pk);

    if (typeof q.a !== 'string' || !q.a.trim()) { fail(id, 'missing answer'); continue; }
    if (!q.show) warn(id, 'no `show` — the raw answer will be displayed at reveal');
    if (!q.why || q.why.length < 40) fail(id, 'missing or too-short `why` (the payoff of the round)');
    if (!TIERS.includes(q.tier)) fail(id, `tier must be one of ${TIERS.join(' | ')}, got ${q.tier}`);

    // The truth set: everything that counts as "you wrote the real answer".
    const truthKeys = new Set(
      [q.a, q.show, ...(q.alt ?? [])].map(norm).filter(Boolean),
    );

    const decoys = q.decoys ?? [];
    const filler = q.filler ?? [];

    // A thin room is padded from `decoys`, and every non-submitter is given a
    // `filler`. Too few of either and a 2-player round is a coin flip.
    if (decoys.length < 3) fail(id, `needs at least 3 decoys, has ${decoys.length}`);
    if (filler.length < 2) fail(id, `needs at least 2 filler lies, has ${filler.length}`);

    // The failure that actually breaks a game: a house lie that is also true. It
    // puts two correct options on the board and makes the scoring incoherent.
    for (const [label, list] of [['decoy', decoys], ['filler', filler]]) {
      const seen = new Set();
      for (const item of list) {
        const k = norm(item);
        if (!k) { fail(id, `empty ${label}`); continue; }
        if (truthKeys.has(k)) fail(id, `${label} "${item}" collides with the real answer`);
        if (seen.has(k)) fail(id, `duplicate ${label} "${item}"`);
        seen.add(k);
        if (item.length > 60) fail(id, `${label} "${item}" is longer than a player could write`);
      }
    }

    // An answer nobody could plausibly type is not a truth collision risk, but a
    // one-word answer with a two-word display form usually means `alt` is missing.
    if (q.show && norm(q.show) !== norm(q.a) && !(q.alt ?? []).length) {
      warn(id, '`show` differs from `a` with no `alt` — a player typing the display form will not be caught');
    }

    if (BLOCKED_ERAS.includes(q.era)) {
      fail(id, `era "${q.era}" is excluded from the deck — players author the lies here`);
    }
    const haystack = `${q.q} ${q.a} ${q.why} ${decoys.join(' ')} ${filler.join(' ')}`;
    for (const p of BLOCKED_PATTERNS) {
      if (p.test(haystack)) fail(id, `matches blocked content pattern ${p} — not safe as bluffing fodder`);
    }

    const ak = norm(q.a);
    if (ak) byAnswer.set(ak, [...(byAnswer.get(ak) ?? []), q.id]);
  }

  for (const [answer, ids] of byAnswer) {
    if (ids.length >= 3) warn(answer, `${ids.length} questions share this answer — ${ids.join(', ')}`);
  }

  return bank;
}

function report(bank) {
  const byTier = {};
  for (const q of bank) byTier[q.tier] = (byTier[q.tier] ?? 0) + 1;

  console.log(`\n  ${bank.length} questions`);
  for (const t of TIERS) console.log(`    ${t.padEnd(8)} ${byTier[t] ?? 0}`);

  // `mixed` alternates desh and probash round to round — the whole design premise
  // that the diaspora's uneven knowledge is the engine. A bank that is 90% desh
  // cannot alternate, and the Dhaka-raised player sweeps every game.
  const desh = byTier.desh ?? 0;
  const probash = byTier.probash ?? 0;
  if (desh && probash) {
    const ratio = Math.max(desh, probash) / Math.min(desh, probash);
    if (ratio > 2.5) {
      warnings.push(
        `bank balance: ${desh} desh vs ${probash} probash (${ratio.toFixed(1)}:1) — ` +
        'a mixed deck cannot alternate tiers evenly at this ratio',
      );
    }
  }

  if (warnings.length) {
    console.log(`\n  ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`    ! ${w}`);
  }
  if (errors.length) {
    console.log(`\n  ${errors.length} error(s):`);
    for (const e of errors) console.log(`    x ${e}`);
    console.log('');
    process.exit(1);
  }
  console.log('\n  bank OK\n');
}

async function main() {
  const urlAt = process.argv.indexOf('--url');
  let bank;
  if (urlAt !== -1) {
    const { parseCsv } = require('../server/src/questionsLoader');
    const res = await fetch(process.argv[urlAt + 1], { redirect: 'follow' });
    if (!res.ok) { console.error(`fetch failed: HTTP ${res.status}`); process.exit(1); }
    bank = parseCsv(await res.text());
  } else {
    bank = require(path.join(__dirname, 'questions.json'));
  }
  report(lint(bank));
}

main().catch((e) => { console.error(e); process.exit(1); });
