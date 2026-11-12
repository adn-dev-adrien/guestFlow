// specs/pricing-components.md §3 rules 38 and 89 (Q-C5) — every named variant of money.js reproduces, value for value, the private copy it
// replaces: a fuzz of numbers plus the awkward inputs (blank, null, undefined, NaN, a French string, half cents). `Object.is` is the
// comparison, so -0 and NaN count as different results.
const test = require('node:test');
const assert = require('node:assert/strict');
const money = require('../utils/pricing/money');

// The original copies, as they were written in the files PR C cleaned.
const original = {
  roundMoneyOrZero: (n) => Math.round((Number(n) || 0) * 100) / 100,
  roundMoneyStrict: (n) => Math.round(Number(n) * 100) / 100,
  roundMoneyBare: (n) => Math.round(n * 100) / 100,
  toCentsOrZero: (n) => Math.round((Number(n) || 0) * 100),
  toCentsStrict: (n) => Math.round(Number(n) * 100),
  toCentsBare: (n) => Math.round(n * 100),
  fromCentsStrict: (c) => Number(c) / 100,
  fromCentsBare: (c) => c / 100,
  roundMoneyEpsilon: (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100,
  roundHalfAway: (x) => Math.sign(x) * Math.round(Math.abs(x)),
  fromCentsRounded: (c) => Math.round(c) / 100,
  parseFrenchCents: (amount) => Math.round(Number(String(amount).replace(/ /g, '').replace(',', '.')) * 100),
  parseFrenchEuros: (raw) => Math.round(Number(String(raw).replace(/[  ]/g, '').replace(',', '.')) * 100) / 100,
  parseIntegerCents(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n);
  },
  eurosWithSpaces(cents) {
    const n = Math.round(cents) / 100;
    const sign = n < 0 ? '−' : '';
    const [int, dec] = Math.abs(n).toFixed(2).split('.');
    return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
  },
};

const AWKWARD = ['', null, undefined, NaN, '12,5', '12.5', ' 1 234,56 ', '1 234,56', 0, -0, 1.005, 2.675, -0.125, -1.235, 0.005, 1e21, -1e-7,
  Infinity, -Infinity, true, [], '0x10', ' ', '1e3', 8.05, 19.99, 0.1 + 0.2];

function fuzz(count = 600000) {
  let seed = 123456789;
  const next = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const kind = i % 4;
    if (kind === 0) out.push(Math.round(next() * 1e7) / 1000); // up to three decimals: lots of half cents
    else if (kind === 1) out.push((next() - 0.5) * 20000);
    else if (kind === 2) out.push(Math.round(next() * 1e6) / 100 + 0.005);
    else out.push(String(Math.round(next() * 1e6) / 100));
  }
  return out;
}

const VALUES = [...AWKWARD, ...fuzz()];

function same(name, actual, expected) {
  let seen = 0;
  for (const v of VALUES) {
    let want; let got;
    let wantThrows = false; let gotThrows = false;
    try { want = expected(v); } catch { wantThrows = true; }
    try { got = actual(v); } catch { gotThrows = true; }
    assert.equal(gotThrows, wantThrows, `${name}(${String(v)}) throws like the original`);
    if (!wantThrows) assert.ok(Object.is(got, want), `${name}(${String(v)}): ${got} vs ${want}`);
    seen += 1;
  }
  return seen;
}

test('rule 38 — roundMoneyOrZero, roundMoneyStrict and the two cents variants equal the copies they replace', () => {
  same('roundMoneyOrZero', money.roundMoneyOrZero, original.roundMoneyOrZero);
  same('roundMoneyStrict', money.roundMoneyStrict, original.roundMoneyStrict);
  same('roundMoneyStrict (bare n * 100)', money.roundMoneyStrict, original.roundMoneyBare);
  same('toCentsOrZero', money.toCentsOrZero, original.toCentsOrZero);
  same('toCentsStrict', money.toCentsStrict, original.toCentsStrict);
  same('toCentsStrict (bare n * 100)', money.toCentsStrict, original.toCentsBare);
  same('fromCentsStrict', money.fromCentsStrict, original.fromCentsStrict);
  same('fromCentsStrict (bare c / 100)', money.fromCentsStrict, original.fromCentsBare);
});

test('rule 38 — the variants differ from roundMoney / toCents only where the copies always did', () => {
  assert.equal(money.roundMoney('12,5'), NaN);
  assert.equal(money.roundMoneyOrZero('12,5'), 0);
  assert.equal(money.roundMoneyStrict(undefined), NaN);
  assert.equal(money.roundMoney(undefined), 0);
  assert.equal(money.roundMoneyOrZero(NaN), 0);
  assert.equal(money.toCentsStrict(undefined), NaN);
  assert.equal(money.toCentsOrZero(undefined), 0);
  assert.equal(money.roundMoneyOrZero(-0.125), -0.12);
});

test('rule 38 — the class-C variants (epsilon, half away from zero, rounded cents) equal their originals', () => {
  same('roundMoneyEpsilon', money.roundMoneyEpsilon, original.roundMoneyEpsilon);
  same('roundHalfAway', money.roundHalfAway, original.roundHalfAway);
  same('fromCentsRounded', money.fromCentsRounded, original.fromCentsRounded);
  same('parseIntegerCents', money.parseIntegerCents, original.parseIntegerCents);
  assert.equal(money.roundMoneyEpsilon(1.005), 1.01);
  assert.equal(money.roundMoney(1.005), 1);
  assert.equal(money.roundHalfAway(-2.5), -3);
  assert.equal(money.roundHalfAway(2.5), 3);
});

test('rule 38 — roundMoneyFixed is the decimal-string rounding of a number, as the public payment payload wrote it', () => {
  const fixed = (x) => Number(x.toFixed(2));
  for (const v of VALUES.filter((x) => typeof x === 'number')) assert.ok(Object.is(money.roundMoneyFixed(v), fixed(v)), String(v));
  assert.throws(() => money.roundMoneyFixed('12.5'), TypeError);
});

test('rule 38 — the French parsers and the plain-space euros equal the intake and reconciliation copies', () => {
  same('parseFrenchCents', money.parseFrenchCents, original.parseFrenchCents);
  same('parseFrenchEuros', money.parseFrenchEuros, original.parseFrenchEuros);
  assert.equal(money.parseFrenchCents('1 234,56'), 123456);
  assert.equal(money.parseFrenchEuros(' 12,5 '), 12.5);
  const cents = VALUES.filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(0, 200000).map((x) => x * 100);
  for (const c of cents) assert.equal(money.eurosWithSpaces(c), original.eurosWithSpaces(c), String(c));
  assert.equal(money.eurosWithSpaces(-123456), '−1 234,56 €');
  assert.notEqual(money.eurosWithSpaces(123456), money.frenchEuros(1234.56));
});
