// specs/pricing-components.md §3 rules 31, 67 — owner 2026-11-15 « Brancher quand même », read with « éviter de toucher les anciens
// séjours »: on a stay booked once 4.2.0 is installed, the Suivi financier reads its HT off the sale lines; its earnings stay
// `totalSejour` (a stay reduced after it was paid would otherwise lose its trop-perçu refund twice, reservation-refunds rule 36,
// proved end to end by `trop-percu-refund-books`). Every other stay keeps today's figures.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const financeSaleLines = require('../utils/financeSaleLines');
const { htOfLines, htOfPortion } = require('../utils/pricing/vat');

function database(rows) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, readsSaleLines INTEGER NOT NULL DEFAULT 0, depositAmount REAL, balanceAmount REAL,
    complementAmount REAL, endOfStayComplementAmount REAL, installmentsPaidAmount REAL, installmentsUnpaidAmount REAL, midStaySettledNotes TEXT)`);
  for (const r of rows) {
    db.prepare(`INSERT INTO reservations (id, kind, readsSaleLines, depositAmount, balanceAmount, complementAmount, endOfStayComplementAmount)
      VALUES (@id, @kind, @readsSaleLines, @depositAmount, @balanceAmount, @complementAmount, @endOfStayComplementAmount)`).run(r);
  }
  return db;
}
const LINES = [
  { kind: 'accommodation', totalCents: 30000, collectAt: 'plan', vat: { vatCents: 2727 } },
  { kind: 'touristTax', totalCents: 400, collectAt: 'plan', vat: { vatCents: 0 } },
  { kind: 'option', totalCents: 6000, collectAt: 'arrival', vat: { vatCents: 545 } },
];
const ROW = { kind: 'reservation', depositAmount: 100, balanceAmount: 204, complementAmount: 60, endOfStayComplementAmount: 30 };

test('rule 31 — the reader answers no earnings: the Suivi financier keeps what the buckets brought in', () => {
  const db = database([{ id: 1, readsSaleLines: 1, ...ROW }]);
  const reader = financeSaleLines.create(db, { detailOf: () => ({ lines: LINES }) });
  assert.equal(reader.earnings, undefined);
  assert.equal(reader.ht({ id: 1, kind: 'reservation' }, 0), 0);
  // The « Complément d'arrivée » is no revenue and weighs in nothing.
  const withAdjustment = financeSaleLines.create(db, { detailOf: () => ({ lines: [...LINES, { kind: 'adjustment', totalCents: 5000, vat: { vatCents: 0 } }] }) });
  assert.equal(withAdjustment.ht({ id: 1 }, 100), reader.ht({ id: 1 }, 100));
});

test('rule 67 — the HT is the share of the lines net of their VAT, the tourist tax weighing in the TTC only', () => {
  const lines = LINES.filter((l) => l.kind !== 'option');
  assert.equal(htOfLines({ portion: 304, lines }), Math.round(304 * ((30000 - 2727) / 30400) * 100) / 100);
  // One rate, one group: within a cent of the HT share of the stay price.
  assert.ok(Math.abs(htOfLines({ portion: 304, lines }) - htOfPortion({ portion: 304, finalPrice: 300, touristTaxTotal: 4, vatRate: 10 })) <= 0.01);
  assert.equal(htOfLines({ portion: 0, lines }), 0);
});

test('rules 31, 67 (2026-11-15) — a stay booked before 4.2.0, a devis, a cancelled stay keep today\'s HT', () => {
  const db = database([{ id: 3, readsSaleLines: 0, ...ROW }, { id: 4, readsSaleLines: 1, ...ROW, kind: 'devis' }]);
  let read = 0;
  const reader = financeSaleLines.create(db, { detailOf: () => { read += 1; return { lines: LINES }; } });
  assert.equal(reader.ht({ id: 3 }, 100), null);
  assert.equal(reader.ht({ id: 4 }, 100), null);
  assert.equal(reader.ht({ id: 1, kind: 'cancelled' }, 100), null);
  assert.equal(read, 0);
  const bare = new Database(':memory:');
  bare.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT)');
  assert.equal(financeSaleLines.create(bare).ht({ id: 1 }, 10), null);
});
