// specs/pricing-components.md §3 rules 65, 66 and 72 — static guards against a formula coming back: the VAT split lives in
// `utils/pricing/vat/` (rules 61-62), what a platform pays out lives in `utils/pricing/platformPayment.js` (rule 70) and
// every refund cap, trop-perçu and requalification figure lives in `utils/pricing/refunds/` (rule 72).
//
// Each guard scans the application sources (tests excluded, comments stripped) for its patterns outside its home and
// compares the hits with its allow-list, `fixtures/no-duplicate-formulas/<guard>.json`: `[{ file, text, removedBy }]`, one
// entry per copy still waiting for the PR that removes it. A hit that is not listed fails; a listed copy that is gone fails
// too (the entry is removed with it). THE LISTS MUST BE EMPTY AT THE END OF PR C.
// The money, date, hourly, family and exporter guards of rule 66 are declared in `helpers/formulaGuards.js` (patterns, home,
// scope, and the probe line each must catch); their lists name the PR that empties them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { GUARDS } = require('./helpers/formulaGuards');

const SRC = path.join(__dirname, '..');
const LISTS = path.join(__dirname, 'fixtures', 'no-duplicate-formulas');

function sources(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests' && entry.name !== 'node_modules' && entry.name !== '__tests__') sources(full, out);
    } else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');

function hitsOf(patterns, isHome, scope = () => true) {
  const hits = [];
  for (const file of sources()) {
    const relative = path.relative(SRC, file).split(path.sep).join('/');
    if (isHome(relative) || !scope(relative)) continue;
    stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line) => {
      if (patterns.some((pattern) => pattern.test(line))) hits.push({ file: relative, text: line.trim() });
    });
  }
  return hits;
}

const keyOf = ({ file, text }) => `${file} :: ${text}`;

function guard(name, patterns, isHome, scope) {
  const allowed = JSON.parse(fs.readFileSync(path.join(LISTS, `${name}.json`), 'utf8'));
  test(`rule 66 — ${name}: every entry of the allow-list names the copy and the PR that removes it`, () => {
    assert.ok(Array.isArray(allowed));
    for (const entry of allowed) {
      assert.deepEqual(Object.keys(entry).sort(), ['file', 'removedBy', 'text'], keyOf(entry));
      assert.match(entry.removedBy, /^PR (B|C)\b/, keyOf(entry));
    }
  });
  test(`rule 66 — ${name}: no copy of the formula outside its home but the listed ones`, () => {
    const hits = hitsOf(patterns, isHome, scope).map(keyOf);
    const listed = new Set(allowed.map(keyOf));
    assert.deepEqual(hits.filter((hit) => !listed.has(hit)), [], 'a copy of the formula: call its home, do not write it again');
    assert.deepEqual([...listed].filter((entry) => !hits.includes(entry)), [], 'a listed copy is gone: remove its entry');
  });
}

guard('vat', [
  /\/\s*\(\s*100\s*\+/, // ttc * (rate / (100 + rate))
  /\*\s*\(?\s*\w*[rR]ate\w*\s*\/\s*\(?\s*100/, // x * rate / 100 written as a VAT share
  /\/\s*\(\s*1\s*\+\s*[\w.]*[rR]ate[\w.]*\s*\/\s*100\s*\)/, // ttc / (1 + vatRate / 100)
], (file) => file.startsWith('utils/pricing/vat/'));

guard('platform-payment', [
  /\bgross\s*-\s*\w*[pP]ayout/, // gross - payout
  /\bdepositAmount\s*-\s*acompteCommission/, // the acompte net of its commission
  /-\s*\w*[tT]ax\s*-\s*acompteCommission/, // gross - payout - tax - acompteCommission
  /-\s*acompteCommission\s*-\s*\w*[tT]ax/, // gross - commission - acompteCommission - tax
], (file) => file === 'utils/pricing/platformPayment.js');

guard('refunds', [
  /REFUND_EXCEEDS_\w+/, // a refund cap refusal
  /\b(excessCents|duplicateCents)\s*[:=]/, // money a link brought beyond the stay, or twice
  /\b(indemnityLeftTtc|saleLeftTtc|cashLeftTtc)\s*[:=]/, // the budget of a cancelled stay
  /\b(overCollectedTtc|scheduleOverCollectedTtc|complementCollectedExcess)\s*[:=]/, // the trop-perçu the engine finds
  /\bSUM\([^)]*(totalTtc|amountTtc)/, // a sum of the refund register in SQL
  /\b(keptFromGuest|writtenOffBalance):\s*round2\(/, // the figures a cancellation books
  /\brefundOwed\s*:\s*true|\brefundCents\s*:\s*excess/, // a refund owed flag written by a payment
], (file) => file.startsWith('utils/pricing/refunds/'));

for (const { name, patterns, isHome, scope } of GUARDS) guard(name, patterns, isHome, scope);

test('rule 66 — each declared guard catches its probe line and spares a clean one', () => {
  for (const { name, patterns, probe } of GUARDS) {
    assert.ok(patterns.some((pattern) => pattern.test(probe)), `${name} misses its probe`);
    assert.ok(!patterns.some((pattern) => pattern.test('const total = amount + other;')), `${name} flags a clean line`);
  }
});

test('rule 66 — the date guard\'s allow-list is the rule 45 table of today\'s call sites: every entry belongs to PR B or PR C', () => {
  const dates = JSON.parse(fs.readFileSync(path.join(LISTS, 'dates.json'), 'utf8'));
  assert.ok(dates.length > 0);
  for (const entry of dates) assert.match(entry.removedBy, /^PR (B|C)$/);
  assert.ok(dates.some((entry) => entry.file === 'utils/arrivalMoment.js' && entry.removedBy === 'PR C'));
  assert.ok(dates.some((entry) => entry.file === 'models/reservationsModel.js' && entry.removedBy === 'PR B'));
});
