// paymentLinksModel CRUD + open/paid lifecycle. See specs/online-payments-qonto.md §5.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/paymentLinksModel');

const DDL = `
  CREATE TABLE payment_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    type TEXT NOT NULL,
    qontoPaymentLinkId TEXT,
    url TEXT NOT NULL DEFAULT '',
    amountCents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    status TEXT NOT NULL DEFAULT 'open',
    qontoPaymentId TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    paidAt TEXT,
    expiresAt TEXT,
    CHECK (type IN ('deposit', 'balance', 'full', 'complement')),
    CHECK (status IN ('open', 'paid', 'expired', 'cancelled'))
  );
`;

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: buildModel(db) };
}

test('create: persists a link in cents, defaults currency EUR + status open', () => {
  const { model } = fresh();
  const row = model.create({ reservationId: 100, type: 'deposit', amountCents: 9000, url: 'https://q/x', qontoPaymentLinkId: 'pl_1', expiresAt: '2026-07-01' });
  assert.equal(row.reservationId, 100);
  assert.equal(row.type, 'deposit');
  assert.equal(row.amountCents, 9000);
  assert.equal(row.currency, 'EUR');
  assert.equal(row.status, 'open');
  assert.equal(row.qontoPaymentLinkId, 'pl_1');
  assert.equal(row.expiresAt, '2026-07-01');
});

test('create: rejects an invalid type', () => {
  const { model } = fresh();
  assert.throws(() => model.create({ reservationId: 1, type: 'tip', amountCents: 100 }), /Invalid payment link type/);
});

test('listOpen: only open rows; paid ones drop out', () => {
  const { model } = fresh();
  const a = model.create({ reservationId: 1, type: 'deposit', amountCents: 100 });
  model.create({ reservationId: 2, type: 'balance', amountCents: 200 });
  model.markPaid(a.id, { qontoPaymentId: 'pay_1' });
  const open = model.listOpen();
  assert.equal(open.length, 1);
  assert.equal(open[0].type, 'balance');
});

test('markPaid: flips open→paid with the Qonto payment id; idempotent on a paid row', () => {
  const { model } = fresh();
  const link = model.create({ reservationId: 1, type: 'deposit', amountCents: 9000 });
  const first = model.markPaid(link.id, { qontoPaymentId: 'pay_42', paidAt: '2026-06-20 10:00:00' });
  assert.equal(first.flipped, true);
  assert.equal(first.row.status, 'paid');
  assert.equal(first.row.qontoPaymentId, 'pay_42');
  assert.equal(first.row.paidAt, '2026-06-20 10:00:00');
  // A second (late/duplicate) poll must NOT re-process: no flip, fields preserved.
  const second = model.markPaid(link.id, { qontoPaymentId: 'pay_OTHER' });
  assert.equal(second.flipped, false);
  assert.equal(second.row.qontoPaymentId, 'pay_42');
});

test('findOpenForReservation: returns the open link of that type, undefined once paid', () => {
  const { model } = fresh();
  const link = model.create({ reservationId: 7, type: 'balance', amountCents: 5000 });
  assert.equal(model.findOpenForReservation(7, 'balance').id, link.id);
  assert.equal(model.findOpenForReservation(7, 'deposit'), undefined);
  model.markPaid(link.id, {});
  assert.equal(model.findOpenForReservation(7, 'balance'), undefined);
});

test('listForReservation: every link, newest first', () => {
  const { model } = fresh();
  model.create({ reservationId: 9, type: 'deposit', amountCents: 100 });
  model.create({ reservationId: 9, type: 'balance', amountCents: 200 });
  const rows = model.listForReservation(9);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'balance'); // DESC by id
});
