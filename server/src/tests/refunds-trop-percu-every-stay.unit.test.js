// specs/pricing-components.md §3 rule 76 and specs/reservation-refunds.md rules 34, 38, 42, 44 — ONE trop-perçu formula for
// every stay: Σ allocations − the stay's total − the free lines of origin `overpayment` given back (owner O-6, O-7 b).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, fiche, pay, S, NO_ACOMPTE, TODAY, refund, PLATFORM,
} = require('./moneyLedgerFixture');
const reservations = require('../controllers/reservationsController');

const stored = (id) => (reservations.storedOverpayment(id) || { overpaymentTtc: 0 }).overpaymentTtc;
const lower = (id, euros) => db.prepare('UPDATE reservations SET finalPrice = finalPrice - ? WHERE id = ?').run(euros, id);

test('rule 76 — a legacy stay (flags and amounts, no allocation written by the application) reads the backfilled ones', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  // The way a stay paid before the allocations existed looks: the columns alone.
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?").run(TODAY, id);
  db.prepare('DELETE FROM payment_allocations WHERE documentRef = ?').run(`reservation:${id}`);
  db.prepare('DELETE FROM payment_allocations_dirty').run();
  require('../utils/pricingLinesMigration').backfillStayLevelAllocations(db);
  assert.equal(stored(id), 0);
  lower(id, 20);
  assert.equal(stored(id), 20, 'the stay now costs 20 € less than the guest paid');
});

test('rule 76 — a stay paid after the boot has its trop-perçu at once, from the live allocations', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  pay(id, S);
  assert.equal(stored(id), 0);
  lower(id, 15.5);
  assert.equal(stored(id), 15.5);
});

test('rule 76 (O-6) — only a refund opened on the trop-perçu lowers it; a gesture on a free line does not', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  pay(id, S);
  lower(id, 30);
  const line = [{ label: 'Geste', bucket: 'accommodation', amountTtc: 10 }];
  assert.equal(refund(id, line).statusCode, 201);
  assert.equal(stored(id), 30, 'a gesture is not a refund of the excess');
  const opened = refund(id, [{ label: 'Trop-perçu', bucket: 'accommodation', amountTtc: 10 }], 'transfer', { fromOverpayment: true });
  assert.equal(opened.statusCode, 201, JSON.stringify(opened.body));
  assert.equal(stored(id), 20);
  assert.equal(db.prepare('SELECT origin FROM reservation_refunds WHERE id = ?').get(opened.body.refund.id).origin, 'overpayment');
});

test('rule 76 — what the end of stay collected for the departure\'s own sales is no excess', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  pay(id, S);
  db.prepare(`UPDATE reservations SET endOfStayComplementPaid = 1, endOfStayComplementPaidDate = ?, endOfStayComplementAmount = 30,
      endOfStayComplementDetail = '[{"label":"Ménage","unitPrice":30,"amount":30,"qty":1,"source":"sas"}]' WHERE id = ?`).run(TODAY, id);
  assert.equal(stored(id), 0);
});

test('specs/reservation-refunds.md rule 38 — a platform stay has none, whatever was collected', () => {
  const { id } = fiche(NO_ACOMPTE, PLATFORM.reversed);
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?").run(TODAY, id);
  lower(id, 50);
  assert.equal(stored(id), 0);
});

test('rule 76 — an unpaid stay has no excess however far it was lowered', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  lower(id, 100);
  assert.equal(stored(id), 0);
});
