#!/usr/bin/env node
/**
 * A compact digest of the bank, for pasting into a generating session.
 *
 *   node questions/digest.js              # everything
 *   node questions/digest.js probash      # one tier
 *
 * Pasting the full questions.json into a fresh session costs a great deal of context
 * and buys nothing — the generator only needs to know what ground is already covered,
 * not the decoys and why-text of every entry. This prints one line per question, which
 * is about a twentieth of the size and exactly as useful for avoiding overlap.
 */

const path = require('path');
const bank = require(path.join(__dirname, 'questions.json'));

const tier = process.argv[2];
const rows = tier ? bank.filter((q) => q.tier === tier) : bank;

const counts = {};
const regions = {};
for (const q of bank) {
  counts[q.tier] = (counts[q.tier] ?? 0) + 1;
  regions[q.region] = (regions[q.region] ?? 0) + 1;
}

console.log(`# Bank digest — ${bank.length} questions`);
console.log(`# ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`# regions: ${Object.entries(regions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`#\n# Already covered — do not repeat these subjects:\n`);

for (const q of rows.sort((a, b) => a.tier.localeCompare(b.tier) || a.id.localeCompare(b.id))) {
  console.log(`${q.id}  [${q.tier}]  ${q.q}  → ${q.show || q.a}`);
}
console.log('');
