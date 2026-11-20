// specs/outside-booking-sas.md rule 30 and specs/pricing-components.md §3 rules 63, 74 — a standalone document in the journal (AccountingOutput kind `standalone`): one entry per payment day
// for the part allocated to its lines on the books, split by revenue class and VAT rate, the caisse interne and the offered lines out, the VAT of a document paid in
// pieces adding up to the VAT of its whole, drinks on the account the accountant set.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const standaloneSale = require('../../../utils/standaloneSale');
const sales = require('../../../models/standaloneSalesModel');
const { list } = require('../../../utils/standaloneSales');
const { buildStandaloneEntry } = require('../accountingModel');
const { entryToRows } = require('../accountingExport');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)").run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière', 6.5, 'drinks');
const plank = option('Planche', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const line = (id, quantity, extra = {}) => ({ articleRef: `option:${id}`, quantity, ...extra });
const PLAN = { drinksRevenueAccount: '70650000' };
const entriesOf = (from, to) => list({ from, to }).filter((s) => s.booksCents > 0).map(buildStandaloneEntry);
const cols = (rows) => rows.map((r) => [r[6], r[7], r[8]]);
const total = (rows, i) => Math.round(rows.reduce((sum, r) => sum + r[i], 0) * 100);

test('rule 30 — a paid document is one entry on its payment day: the customer debited, revenue per class, VAT per rate, balanced', () => {
  const { document } = standaloneSale.sell({ lines: [line(beer, 3), line(plank, 1)], payment: { tenders: [{ method: 'card', amountCents: 3350 }], paidAt: `${Y}-03-10` } });
  const entries = entriesOf(`${Y}-03-01`, `${Y}-03-31`).filter((e) => e.standaloneKey.startsWith(`standalone:${document.document.id}:`));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].paidDate, `${Y}-03-10`);
  const rows = entryToRows(entries[0], PLAN);
  assert.deepEqual(cols(rows), [
    [rows[0][6], 33.5, 0],
    ['70600010', 0, 12.73],
    ['70650000', 0, 16.25],
    ['44571100', 0, 1.27],
    ['44571200', 0, 3.25],
  ]);
  assert.equal(total(rows, 7), total(rows, 8));
  assert.deepEqual(entries[0].groups.map((g) => [g.vatClass, g.rate, g.ttcCents, g.vatCents]), [['catering', 10, 1400, 127], ['drinks', 20, 1950, 325]]);
});

test('rule 30 — « revenue:drinks » has no account of its own: without the setting the line has none, with it the line sits on it', () => {
  const { document } = standaloneSale.sell({ lines: [line(beer, 1)], payment: { tenders: [{ method: 'card', amountCents: 650 }], paidAt: `${Y}-03-11` } });
  const [entry] = entriesOf(`${Y}-03-11`, `${Y}-03-11`).filter((e) => e.standaloneKey.startsWith(`standalone:${document.document.id}:`));
  assert.equal(entryToRows(entry, {})[1][6], undefined, 'no default account is invented');
  assert.equal(entryToRows(entry, PLAN)[1][6], '70650000');
});

test('rule 30 — a document paid on two days books each day\'s part, and the VAT of the pieces adds up to the VAT of the whole', () => {
  const { document } = standaloneSale.sell({ lines: [line(plank, 3)], payment: { tenders: [{ method: 'card', amountCents: 1400 }], shortfall: { kind: 'due' }, paidAt: `${Y}-04-02` } });
  const second = standaloneSale.pay(document.document.id, { tenders: [{ method: 'cash', amountCents: 2800 }], paidAt: `${Y}-04-05` });
  assert.equal(second.document.totals.remainingCents, 0);
  const mine = entriesOf(`${Y}-04-01`, `${Y}-04-30`).filter((e) => e.standaloneKey.startsWith(`standalone:${document.document.id}:`));
  assert.deepEqual(mine.map((e) => [e.paidDate, e.encaissementTtc]), [[`${Y}-04-02`, 14], [`${Y}-04-05`, 28]]);
  assert.equal(mine.reduce((sum, e) => sum + e.groups.reduce((s, g) => s + g.vatCents, 0), 0), 382, '4 200 × 10 / 110 rounded once for the whole document');
});

test('rule 30 — the caisse interne is not on the books, and an offered line is never journaled', () => {
  const { document } = standaloneSale.sell({
    lines: [line(plank, 1), line(beer, 2, { offered: true })],
    payment: { tenders: [{ method: 'cash', amountCents: 1000, internal: true }, { method: 'card', amountCents: 400 }], paidAt: `${Y}-05-03` },
  });
  const [entry] = entriesOf(`${Y}-05-03`, `${Y}-05-03`).filter((e) => e.standaloneKey.startsWith(`standalone:${document.document.id}:`));
  assert.equal(entry.encaissementTtc, 4, 'only the card part is on the books');
  assert.deepEqual(entry.groups.map((g) => g.vatClass), ['catering']);
  const [card] = list({ from: `${Y}-05-03`, to: `${Y}-05-03` }).filter((s) => s.key.startsWith(`standalone:${document.document.id}:`));
  assert.deepEqual([card.totalCents, card.booksCents, card.cardCents], [1400, 400, 400]);
});

test('rule 30 — a document sold but not paid is not in the journal, and the « Pièce » is the invoice number when there is one', () => {
  const { document } = standaloneSale.sell({ lines: [line(plank, 1)] });
  assert.equal(list({ from: `${Y}-01-01`, to: `${Y}-12-31` }).some((s) => s.key.startsWith(`standalone:${document.document.id}:`)), false);
  const paid = standaloneSale.sell({ lines: [line(plank, 1)], payment: { tenders: [{ method: 'card', amountCents: 1400 }], paidAt: `${Y}-06-01` } });
  db.prepare("UPDATE standalone_sales SET invoiceNumber = 'F-1' WHERE id = ?").run(paid.document.document.id);
  const [entry] = entriesOf(`${Y}-06-01`, `${Y}-06-01`).filter((e) => e.standaloneKey.startsWith(`standalone:${paid.document.document.id}:`));
  assert.equal(entry.piece, 'F-1');
});
