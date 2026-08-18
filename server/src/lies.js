/**
 * Lie normalisation and option building.
 *
 * This module decides what the room votes on. Two rules govern everything here:
 *
 *  1. The truth is just another option in the array, distinguishable only by a flag
 *     that never leaves this process. `toClientOptions()` is the only shape allowed
 *     out during VOTING, and it is deliberately the narrowest possible projection.
 *  2. Authorship is scoring data, not display data, until REVEAL. Same reasoning:
 *     knowing who wrote what is knowing what is not true.
 */

const LIE_MAX = 60;

// Bengali codepoints, the same range norm() preserves. The bank carries Bangla on
// purpose; ballotText() is about where it is allowed to appear. Exported because
// questions/lint.js refuses at author time exactly what this module refuses to
// print, and two copies of the range is two chances for them to disagree.
const BENGALI = /[\u0980-\u09FF]/;

// Below this the vote is trivial — with three players you would be picking between
// two lies and the truth, and simply avoiding your own leaves a coin flip. House
// decoys pad the board out so a small room still plays a real round.
const MIN_OPTIONS = 5;

/**
 * Normalise for comparison only — never for display.
 *
 * Lowercased, punctuation and whitespace stripped, but Bengali codepoints
 * (U+0980–U+09FF) preserved: a bank that carries Bangla script has to be able to
 * merge two players who wrote the same Bengali word with different spacing.
 * NFKC first so composed and decomposed forms of the same string collapse together.
 */
function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09FF]+/g, '');
}

/**
 * What the truth is *printed as on the ballot* — deliberately not the display form.
 *
 * 313 of the bank's 551 `show` fields carry Bangla script — "Jackfruit (কাঁঠাল)",
 * "Natok (নাটক) — TV dramas" — and no player writing a lie on a phone produces
 * Bengali script or a bracketed gloss. Printing `show` on the ballot therefore
 * labels the truth as plainly as a `truth: true` flag would; it is the same leak
 * this module exists to prevent, arriving through the display layer rather than
 * the protocol.
 *
 * `a` is the right string because it is literally what fills the blank, and the
 * bank's decoys are written to match it: "guest" belongs among Winter / Snow /
 * Traveller in a way that "Otithi pakhi (অতিথি পাখি) — 'guest birds'" does not.
 *
 * `show` is not lost. It is what the reveal prints, which is the moment the Bangla
 * is worth having.
 */
function ballotText(question) {
  const a = String(question.a ?? '').trim();
  if (a && !BENGALI.test(a)) return a;
  // A sheet-loaded bank the linter never saw could still hand us a Bangla `a`.
  // Strip the parenthetical gloss off the display form rather than shipping script.
  const bare = plainShow(question);
  return bare && !BENGALI.test(bare) ? bare : a || bare;
}

/** The display form with its bracketed gloss removed. */
function plainShow(question) {
  return String(question.show ?? '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every option goes on the ballot in caps.
 *
 * Case is a tell, not styling. The truth arrives from the bank in sentence case
 * ("Jackfruit") and a player typing at speed on a phone does not capitalise
 * ("mango"), so a mixed-case board quietly sorts itself into "set by the house" and
 * "written by a person". Uppercasing is done here rather than in CSS for the same
 * reason toClientOptions() builds a fresh object: the leak has to be closed in the
 * frame the client receives, not in the stylesheet it is free to ignore.
 */
function ballotCase(text) {
  return String(text).toUpperCase();
}

/** Trim and bound a submitted lie. Returns null for anything unusable. */
function cleanLie(raw) {
  const text = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIE_MAX);
  return text || null;
}

/**
 * Did this player just write the actual answer?
 *
 * Checked against `a`, the display form, and every entry in `alt` — a bank entry
 * whose answer is "jackfruit" has to catch "kathal" too, or the round ships two
 * correct options and the scoring is incoherent.
 *
 * The caller turns this into a delight rather than an error: the player is told
 * privately that they knew it and asked for a lie instead. It is deliberately worth
 * no points. Paying for it would make typing the real answer into the lie box the
 * dominant strategy for anyone who knows it, which empties the lie pool — the one
 * thing the game cannot survive.
 */
function isTruthCollision(question, text) {
  const n = norm(text);
  if (!n) return false;
  // The bare display form is in here too: with the ballot printing "Mango" and the
  // reveal printing "Mango tree (আম গাছ)", a player who writes "Mango tree" is
  // writing the answer, and without this they would merge into the truth's own
  // option and be credited as its author.
  const candidates = [question.a, question.show, plainShow(question), ...(question.alt ?? [])];
  return candidates.some((c) => c && norm(c) === n);
}

function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build the round's options from the submitted lies.
 *
 * @param question  the bank entry, including `a`, `show`, `decoys`, `filler`
 * @param lies      pid -> cleaned lie text, for players who submitted
 * @param awaited   pids that owed a lie this round (used to assign house fillers)
 * @returns { options, houseLieByPid }
 *
 * `options` is the internal shape: { id, text, truth, authors[], house }.
 * Never emit it during VOTING — use toClientOptions().
 */
function buildOptions(question, lies, awaited = [], rand = Math.random) {
  const byNorm = new Map(); // norm -> { text, authors[], house }
  const houseLieByPid = {};

  const add = (text, authorPid, house) => {
    const key = norm(text);
    if (!key) return;
    const existing = byNorm.get(key);
    if (existing) {
      // Two players wrote "Mango". One option, both authors — and both get paid
      // when somebody falls for it. Merging is what stops the board showing the
      // same word twice and splitting the vote for it.
      if (authorPid && !existing.authors.includes(authorPid)) existing.authors.push(authorPid);
      // A player's lie beats a house filler on the same text: real authorship is
      // more interesting at the reveal than "the house wrote this".
      if (authorPid) existing.house = false;
      return;
    }
    byNorm.set(key, { text, authors: authorPid ? [authorPid] : [], house: !!house });
  };

  // A lie that collides with the truth must never become an option — it would put a
  // second correct answer on the board. Submission rejects these, but a filler pool
  // or a stale client could still get one here, so it is enforced at build time too.
  const altKeys = new Set(
    [question.a, question.show, plainShow(question), ...(question.alt ?? [])].map(norm).filter(Boolean),
  );

  for (const [pid, text] of Object.entries(lies)) {
    if (altKeys.has(norm(text))) continue;
    add(text, pid, false);
  }

  // Anyone who owed a lie and did not write one gets a house filler, attributed to
  // the house rather than to them. Blaming an AFK player for a lie they did not
  // write is a small unfairness the room notices immediately.
  const fillerPool = (question.filler ?? []).filter((f) => !altKeys.has(norm(f)));
  let fillerAt = 0;
  for (const pid of awaited) {
    if (lies[pid] !== undefined) continue;
    const filler = fillerPool[fillerAt++ % Math.max(fillerPool.length, 1)];
    if (!filler) break;
    if (byNorm.has(norm(filler))) continue;
    houseLieByPid[pid] = filler;
    add(filler, null, true);
  }

  // Pad a thin board with the question's decoys.
  const decoys = (question.decoys ?? []).filter((d) => !altKeys.has(norm(d)));
  let decoyAt = 0;
  while (byNorm.size < MIN_OPTIONS - 1 && decoyAt < decoys.length) {
    add(decoys[decoyAt++], null, true);
  }

  // The truth goes in last, in its ballot form rather than its display form — see
  // ballotText(). Look it up by the key it was actually filed under rather than by
  // norm(question.a): the two agree today, and a bank entry that made them disagree
  // would otherwise ship a round with no correct option on the board.
  const truthText = ballotText(question);
  add(truthText, null, false);
  const truthEntry = byNorm.get(norm(truthText));
  if (!truthEntry) throw new Error(`question ${question.id}: truth produced no option`);
  truthEntry.truth = true;

  // Ids are assigned AFTER the shuffle, so the id sequence carries no information
  // about which option was the truth or who authored what. Assigning before would
  // make "the truth is always o1" true, and the whole game rests on it not being.
  const options = shuffle([...byNorm.values()], rand).map((o, i) => ({
    id: `o${i + 1}`,
    text: ballotCase(o.text),
    truth: !!o.truth,
    authors: o.authors,
    house: !!o.house && o.authors.length === 0,
  }));

  return { options, houseLieByPid };
}

/**
 * The ONLY shape allowed out of the server during VOTING.
 *
 * No `truth`, no `authors`, no `house`. If any of those ship early, one player opens
 * devtools on round one and the game is over — so this is a whitelist that builds a
 * fresh object rather than a delete-the-secrets pass over the original, which is the
 * version that leaks the day somebody adds a field.
 */
function toClientOptions(options) {
  return options.map((o) => ({ id: o.id, text: o.text }));
}

/** Which option, if any, did this player author? Used to stop self-voting. */
function ownOptionId(options, pid) {
  return options.find((o) => o.authors.includes(pid))?.id ?? null;
}

module.exports = {
  LIE_MAX,
  MIN_OPTIONS,
  BENGALI,
  norm,
  cleanLie,
  ballotText,
  ballotCase,
  isTruthCollision,
  buildOptions,
  toClientOptions,
  ownOptionId,
  shuffle,
};
