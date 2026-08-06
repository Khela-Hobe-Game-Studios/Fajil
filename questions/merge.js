#!/usr/bin/env node
/**
 * Merge a generated batch into the bank.
 *
 *   node questions/merge.js questions/new-batch.json           # dry run
 *   node questions/merge.js questions/new-batch.json --write
 *
 * Refuses on a duplicate id or a duplicate prompt rather than silently overwriting —
 * a batch generated in a fresh session has no idea what is already in the bank, and
 * a repeated question inside one game is worse than a missing one.
 *
 * Always lint after writing.
 */

const fs = require('fs');
const path = require('path');
const { norm } = require('../server/src/lies');

const BANK = path.join(__dirname, 'questions.json');
const input = process.argv[2];
const write = process.argv.includes('--write');

if (!input) {
  console.error('usage: node questions/merge.js <batch.json> [--write]');
  process.exit(1);
}

const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
let batch;
try {
  batch = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
} catch (e) {
  console.error(`could not read ${input}: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(batch)) {
  console.error('the batch must be a JSON array');
  process.exit(1);
}

const ids = new Set(bank.map((q) => q.id));
const prompts = new Set(bank.map((q) => norm(q.q)));

const accepted = [];
const rejected = [];

for (const q of batch) {
  if (!q?.id) { rejected.push(['(no id)', 'missing id']); continue; }
  if (ids.has(q.id)) { rejected.push([q.id, 'id already in the bank']); continue; }
  if (prompts.has(norm(q.q))) { rejected.push([q.id, 'a question with this prompt already exists']); continue; }
  ids.add(q.id);
  prompts.add(norm(q.q));
  accepted.push(q);
}

const merged = [...bank, ...accepted];
const byTier = {};
for (const q of merged) byTier[q.tier] = (byTier[q.tier] ?? 0) + 1;

console.log(`\n  bank ${bank.length} + batch ${batch.length} -> ${merged.length}`);
console.log(`  accepted ${accepted.length}, rejected ${rejected.length}`);
for (const [id, why] of rejected) console.log(`    x ${id} — ${why}`);
console.log('');
for (const t of ['desh', 'probash', 'shared']) console.log(`    ${t.padEnd(8)} ${byTier[t] ?? 0}`);

if (!write) {
  console.log('\n  dry run — pass --write to apply\n');
  process.exit(0);
}

fs.writeFileSync(BANK, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`\n  written. now run: node questions/lint.js\n`);
