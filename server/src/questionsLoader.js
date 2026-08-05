const fs = require('fs/promises');
const path = require('path');

const LOCAL = path.join(__dirname, '..', '..', 'questions', 'questions.json');

/**
 * Questions ship as data, never hardcoded.
 *
 * `QUESTIONS_SHEET_URL` (a Google Sheet published as CSV) wins when set, so the bank
 * can grow without a redeploy; the local JSON is the fallback the server always has.
 * A sheet that fails to load must not take the game down with it — a party that
 * cannot start because a spreadsheet is unreachable is worse than a slightly stale
 * bank.
 */
async function loadQuestions() {
  const url = process.env.QUESTIONS_SHEET_URL;
  if (url) {
    try {
      const remote = await loadFromSheet(url);
      if (remote.length) {
        console.log(`[questions] loaded ${remote.length} from sheet`);
        return remote;
      }
      console.warn('[questions] sheet returned no usable rows — falling back to local');
    } catch (err) {
      console.warn('[questions] sheet load failed, falling back to local:', err.message);
    }
  }
  const raw = await fs.readFile(LOCAL, 'utf8');
  const parsed = JSON.parse(raw);
  const usable = parsed.filter(isUsable);
  console.log(`[questions] loaded ${usable.length} from questions.json`);
  return usable;
}

function isUsable(q) {
  return q && typeof q.q === 'string' && typeof q.a === 'string' && q.q.trim() && q.a.trim();
}

async function loadFromSheet(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csv = await res.text();
  return parseCsv(csv).filter(isUsable);
}

/** Minimal RFC4180 parser — quoted fields, escaped quotes, embedded newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const list = (s) => String(s ?? '').split('|').map((x) => x.trim()).filter(Boolean);

  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => ({
      id: r[idx('id')]?.trim(),
      q: r[idx('q')]?.trim(),
      a: r[idx('a')]?.trim(),
      show: r[idx('show')]?.trim() || undefined,
      alt: list(r[idx('alt')]),
      decoys: list(r[idx('decoys')]),
      filler: list(r[idx('filler')]),
      why: r[idx('why')]?.trim(),
      tier: r[idx('tier')]?.trim() || 'shared',
      region: r[idx('region')]?.trim() || 'national',
      era: r[idx('era')]?.trim() || 'modern',
    }));
}

module.exports = { loadQuestions, parseCsv };
