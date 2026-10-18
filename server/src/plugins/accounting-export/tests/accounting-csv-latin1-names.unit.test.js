const test = require('node:test');
const assert = require('node:assert/strict');

// specs/accountant-accounting-export.md rules 31-32 — the ISO-8859-1 CSV transliterates what Latin-1
// cannot hold (« ’ » typed by every iPhone, « Œ »), and a prorated bucket splits its TTC share at its
// rate (mega review #5, M3: « Zoë D’Œuvre » came out « ZO\xCB D\x19RUVRE »; m4: 117,28 / 11,72 where
// the accountant's own check gives 117,27 / 11,73).
const { toLatin1Text } = require('../latin1');
const { create: createAccountingController } = require('../controller');
const { buildRows } = require('../accountingExport');

test('rule 31 — typographic characters become their Latin-1 / ASCII form, Latin-1 stays', () => {
  assert.equal(toLatin1Text('Zoë D’Œuvre'), "Zoë D'OEuvre");
  assert.equal(toLatin1Text('O’Neil — « cœur » …'), "O'Neil - « coeur » ...");
  assert.equal(toLatin1Text('“Gîte” ‘Lodge’'), '"Gîte" \'Lodge\'');
  assert.equal(toLatin1Text('Łukasz Dvořák'), 'Lukasz Dvorák');
  assert.equal(toLatin1Text('李'), '?');
  assert.equal(toLatin1Text('Élodie Çağ'), 'Élodie Çag');
});

function entry(overrides = {}) {
  return {
    reservationId: 1, kind: 'balance', paidDate: '2026-08-17',
    client: { firstName: 'Zoë', lastName: 'D’Œuvre' },
    platform: 'direct', clientGrossAmount: null,
    finalPrice: 110, encaissementTtc: 110, taxTtc: 0, fraction: 1,
    buckets: [{ name: 'accommodation', ht: 100, vat: 10, ratePercent: 10 }],
    ...overrides,
  };
}

test('rule 31 — the CSV bytes carry « D\'OEUVRE », no control byte, « Ë » in Latin-1', () => {
  const controller = createAccountingController({ encaissementsByMonth: () => [entry()] });
  let body = null;
  const res = { setHeader() {}, status() { return this; }, json() { return this; }, send(b) { body = b; return this; } };
  controller.salesCsv({ query: { year: '2026', month: '8' } }, res);
  assert.ok(Buffer.isBuffer(body));
  assert.equal(body.some((b) => b < 0x20 && b !== 0x0d && b !== 0x0a), false, 'no control byte');
  const text = body.toString('latin1');
  assert.match(text, /ZOË D'OEUVRE/);
  assert.ok(body.includes(Buffer.from([0xcb])), '« Ë » is its Latin-1 byte');
});

test('rule 32 — a prorated bucket: HT = TTC ÷ (1 + rate), VAT = TTC − HT', () => {
  // 129,00 € of a 179,17 € stay at 10 % (fraction 0,72).
  const stayHt = 162.88;
  const stayVat = 16.29;
  const rows = buildRows([entry({ encaissementTtc: 129, finalPrice: 179.17, fraction: 0.72, buckets: [{ name: 'accommodation', ht: stayHt, vat: stayVat, ratePercent: 10 }] })]);
  const amount = (cell) => Number(String(cell).replace(',', '.'));
  const credits = rows.map((r) => amount(r[8])).filter((v) => v > 0);
  assert.deepEqual(credits.sort((a, b) => b - a), [117.27, 11.73]);
  const debits = rows.map((r) => amount(r[7])).filter((v) => v > 0);
  assert.equal(Math.round(debits.reduce((a, b) => a + b, 0) * 100), Math.round(credits.reduce((a, b) => a + b, 0) * 100), 'balanced');
});

test('rule 32 — a whole bucket keeps its own HT and VAT', () => {
  const rows = buildRows([entry()]);
  const credits = rows.map((r) => Number(String(r[8]).replace(',', '.'))).filter((v) => v > 0);
  assert.deepEqual(credits.sort((a, b) => b - a), [100, 10]);
});
