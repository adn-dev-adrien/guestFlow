// specs/pricing-components.md §3 rules 65 and 66 (F20) — the no-duplicate-formulas guards are proved on synthetic sources:
// a planted copy turns the guard red, the copy removed turns it green again. Nothing here reads the real tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const { GUARDS, plugin } = require('./helpers/formulaGuards');
const { hitsOfFiles, judge, entriesOf } = require('./helpers/formulaScan');

const guard = (name) => GUARDS.find((g) => g.name === name);
const verdict = (name, files, allowed = []) => judge(hitsOfFiles(files, guard(name)), allowed);
const entry = (file, text, extra = {}) => ({ file, text, removedBy: 'PR B', reason: 'a copy waiting for its PR', ...extra });

test('a clean line passes every guard', () => {
  for (const { name } of GUARDS) assert.deepEqual(verdict(name, { 'utils/other.js': 'const total = amount + other;\nconst cents = 100;\n' }), { unlisted: [], stale: [] });
});

test('vat — the seven real shapes of the review are all caught (parentheses, names and spacing vary)', () => {
  const lines = [
    'const ht = rate > 0 ? round2(ttc / (1 + rate / 100)) : ttc;',
    'const ht = roundMoney(totalTtc / (1 + (rate / 100)));',
    'const bases = lines.map((l) => Math.round(l.amountCents / (1 + Number(l.vatRate || 0) / 100)));',
    'const vatDivisor = 1 + (vatRate / 100);',
    'const share = ttc * rate / (rate + 100);',
    'const ht = ttc / 1.055;',
    'const vat = amount - amount / (1 + t);',
  ];
  for (const line of lines) assert.equal(verdict('vat', { 'utils/devis.js': `${line}\n` }).unlisted.length, 1, line);
});

test('vat — the shapes that slipped through the first guards are caught (trailing zero, nested divisor, 10/11)', () => {
  const lines = ['const ht = ttc / 1.10;', 'const ht = ttc / 1.20;', 'const ht = ttc / ((100 + rate) / 100);', 'const vat = ttc * 10 / 11;', 'const vat = round2((ttc * 20) / 120);'];
  for (const line of lines) assert.equal(verdict('vat', { 'utils/devis.js': `${line}\n` }).unlisted.length, 1, line);
  assert.deepEqual(verdict('vat', { 'controllers/page.js': '<style>p{line-height:1.20;margin:1.10em}</style>\nconst r = items * 10 / 110;\n' }).unlisted, []);
});

test('money — a number rounded back with toFixed(2) or 1e2 is caught, a toFixed(2) string for display is not', () => {
  for (const line of ['return Number(x.toFixed(2));', 'const v = parseFloat((a * b).toFixed(2));', 'const v = +total.toFixed(2);', 'return Math.round(x * 1e2) / 1e2;']) {
    assert.equal(verdict('money', { 'utils/x.js': `${line}\n` }).unlisted.length, 1, line);
    assert.deepEqual(verdict('money', { 'utils/pricing/money.js': `${line}\n` }).unlisted, [], `${line} (home)`);
  }
  for (const line of ['return `${Number(amount || 0).toFixed(2).replace(".", ",")} €`;', 'const money = (cents) => (Number(cents) / 100).toFixed(2);', 'const a = x + 1e2;']) {
    assert.deepEqual(verdict('money', { 'utils/x.js': `${line}\n` }).unlisted, [], line);
  }
});

test('vat — a CSS line-height and the sRGB luminance divisor are not VAT', () => {
  assert.deepEqual(verdict('vat', { 'controllers/page.js': '<style>h1{font:24px/1.2 Georgia}</style>\n' }).unlisted, []);
  assert.deepEqual(verdict('vat', { 'utils/colorContrast.js': 'return ((c + 0.055) / 1.055) ** 2.4;\n' }).unlisted, []);
});

test('vat — the departmental surcharge of the tourist tax is not a VAT, a percentage-shaped VAT divisor is', () => {
  assert.deepEqual(verdict('vat', { 'utils/touristTaxFreeze.js': 'const m = unitAmount / (1 + (departmentPercentage / 100));\n' }).unlisted, []);
  assert.equal(verdict('vat', { 'models/financeModel.js': 'const ht = round2(total / (1 + (Number(quote.vatPercentageAccommodation || 0) / 100)));\n' }).unlisted.length, 1);
});

test('vat — the home may hold the formula, any other file may not', () => {
  const line = 'const net = ttc / (1 + rate / 100);\n';
  assert.deepEqual(verdict('vat', { 'utils/pricing/vat/index.js': line }).unlisted, []);
  assert.equal(verdict('vat', { 'utils/pricing/touristTax.js': line }).unlisted.length, 1);
});

test('a second identical copy in an already listed file fails (multiset), the copy removed leaves a stale entry', () => {
  const line = 'const ht = round2(ttc / (1 + rate / 100));';
  const file = plugin('accounting-export', 'accountingModel.js');
  const listed = [entry(file, line)];
  assert.deepEqual(verdict('vat', { [file]: `${line}\n` }, listed), { unlisted: [], stale: [] });
  const doubled = verdict('vat', { [file]: `${line}\nfoo();\n${line}\n` }, listed);
  assert.equal(doubled.unlisted.length, 1);
  assert.deepEqual(verdict('vat', { [file]: `${line}\n${line}\n` }, [entry(file, line, { count: 2 })]), { unlisted: [], stale: [] });
  assert.equal(verdict('vat', { [file]: 'foo();\n' }, listed).stale.length, 1);
  assert.equal(verdict('vat', { [file]: `${line}\n` }, [entry(file, line, { count: 2 })]).stale.length, 1);
});

test('platform-payment — each form of rule 70 is caught outside platformPayment.js', () => {
  const forms = [
    'const raw = gross - newPayout - tax - acompteCommission;',
    'net = round2(Number(row.depositAmount) - Number(row.acompteCommissionAmount || 0));',
    'const g = row.platformGrossAmount != null ? row.platformGrossAmount : row.depositAmount + row.balanceAmount;',
    'const commission = rent - booking.netRent;',
    'const withheld = grossAmount - booking.payoutAmount;',
    'const total = payout + Math.max(0, penalty);',
    'const total = acompteCommission + soldeCommission;',
  ];
  for (const line of forms) {
    assert.equal(verdict('platform-payment', { 'controllers/p.js': `${line}\n` }).unlisted.length, 1, line);
    assert.deepEqual(verdict('platform-payment', { 'utils/pricing/platformPayment.js': `${line}\n` }).unlisted, [], `${line} (home)`);
  }
});

test('money — a rounding or cents helper, in any function form, is caught outside money.js', () => {
  const forms = [
    'const round2 = (n) => Math.round(n * 100) / 100;',
    'const toCents = (v) => Math.round(v * 100);',
    'function roundMoney(v) {',
    'const euros = function (c) { return c / 100; };',
    'return Math.round((a + b) * 100) / 100;',
    'const roundCents = x => x;',
  ];
  for (const line of forms) assert.equal(verdict('money', { 'utils/x.js': `${line}\n` }).unlisted.length, 1, line);
  assert.deepEqual(verdict('money', { 'utils/pricing/money.js': `${forms[0]}\n` }).unlisted, []);
});

test('money — a number named cents is not a helper (three false positives of the old pattern)', () => {
  assert.deepEqual(verdict('money', { 'utils/x.js': 'const cents = 100;\nconst euros = 5;\nconst cents = row.cents;\n' }).unlisted, []);
});

test('dates — arrivalDate and start_date are compared like startDate, in either order', () => {
  for (const line of ['if (row.arrivalDate <= today) lock();', 'const started = today >= r.start_date;', 'const s = Boolean(row.startDate && row.startDate < todayIso);']) {
    assert.equal(verdict('dates', { 'utils/x.js': `${line}\n` }).unlisted.length, 1, line);
  }
  assert.deepEqual(verdict('dates', { 'utils/pricing/stayClock.js': 'const s = row.startDate <= today;\n' }).unlisted, []);
});

test('families — persons × nights is caught whichever side it is written on', () => {
  for (const line of ['const u = persons * nights;', 'const u = nights * persons;', 'const u = adults * nights;', 'const u = nbNights * extraGuests;', 'const u = nightsCount * adultsCount;']) assert.equal(verdict('families', { 'models/x.js': `${line}\n` }).unlisted.length, 1, line);
  assert.deepEqual(verdict('families', { 'utils/pricing/articles/units.js': 'const u = nights * persons;\n' }).unlisted, []);
});

test('exporters — an accounting exporter requiring the pricing barrel is caught, a sibling file is not', () => {
  const file = `${plugin('accounting-export')}/model.js`;
  assert.equal(verdict('exporters', { [file]: "const { roundMoney } = require('../../utils/pricing');\n" }).unlisted.length, 1);
  assert.equal(verdict('exporters', { [file]: "const { vatOf } = require('../../utils/pricing/vat');\n" }).unlisted.length, 1);
  assert.deepEqual(verdict('exporters', { [file]: "const x = require('./helpers');\n" }).unlisted, []);
  assert.deepEqual(verdict('exporters', { 'models/other.js': "const { roundMoney } = require('../utils/pricing');\n" }).unlisted, []);
});

test('a comment is not a copy', () => {
  assert.deepEqual(verdict('vat', { 'utils/x.js': '// ttc / (1 + rate / 100)\n/* ttc / 1.2 */\nconst a = 1;\n' }).unlisted, []);
});

test('entriesOf — regeneration keeps the PR and reason already written, counts a repeated line, drops nothing it cannot see', () => {
  const hits = [{ file: 'a.js', text: 'x' }, { file: 'a.js', text: 'x' }, { file: 'b.js', text: 'y' }];
  const previous = [entry('a.js', 'x', { removedBy: 'PR C', reason: 'kept as written' }), entry('gone.js', 'z')];
  const out = entriesOf(hits, previous, () => ({ removedBy: 'PR B', reason: 'fresh reason' }));
  assert.deepEqual(out, [
    { file: 'a.js', text: 'x', count: 2, removedBy: 'PR C', reason: 'kept as written' },
    { file: 'b.js', text: 'y', removedBy: 'PR B', reason: 'fresh reason' },
  ]);
});
