// specs/reservation-refunds.md rule 36 — a trop-perçu is counted once. Final review 2026-10-18, N1:
// stay paid 465,60 €, reduced from 6 to 2 adults, then « Enregistrer et rembourser » with the 110,40 €
// the dialog proposed. The save had lowered the paid solde to 355,20 € AND the refund took 110,40 € off
// again: journal, « Encaissé » and « Total perçu » all read 244,80 €, and 46710000 went to −7,20 €.
// The paid solde now keeps what it collected; the refund is the only reduction. The journal side is
// specs/accountant-accounting-export.md rule 34.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const round2 = (n) => Math.round(Number(n) * 100) / 100;

function respond() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test('rule 36 — 465,60 € paid, reduced, 110,40 € refunded: every surface reads 355,20 €', async () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const refunds = require('../controllers/refundsController');
  const financeModel = require('../models/financeModel');
  const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');
  const { create: createAccountingModel } = require('../plugins/accounting-export/accountingModel');
  const { entryToStructured } = require('../plugins/accounting-export/accountingExport');

  // 3 nights at 100 €, breakfast 8 € per person and night, tourist tax 1,20 € per person and night.
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
              VALUES (1, 'Gîte', 8, 'per_day_per_person', 1.2, 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  const optionId = db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Petit déjeuner', 'per_person_per_night', 8)").run().lastInsertRowid;
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(optionId);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  const body = (adults) => ({
    propertyId: 1, clientId: 1, startDate: '2027-01-24', endDate: '2027-01-27',
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    depositDisabled: 1, options: [{ optionId, quantity: 1 }], selectedOptions: [{ optionId, quantity: 1 }],
  });

  const created = respond();
  controller.create({ body: body(6), user: { role: 'admin' } }, created);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = created.body.id;
  assert.equal(db.prepare('SELECT balanceAmount FROM reservations WHERE id = ?').get(id).balanceAmount, 465.6);
  recordStayPayment(depsFor(db), { reservationId: id, bucket: 'balance', paidDate: '2026-10-18' });

  const refused = controller.performUpdate(id, body(2));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.overpaymentTtc, 110.4);
  assert.deepEqual(refused.body.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 96], ['touristTax', 14.4]]);

  const forced = controller.performUpdate(id, { ...body(2), forceOverpayment: true });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  assert.equal(db.prepare('SELECT balanceAmount FROM reservations WHERE id = ?').get(id).balanceAmount, 465.6,
    'the paid solde keeps the 465,60 € it collected');

  const refunded = respond();
  refunds.create({
    params: { id },
    body: {
      refundDate: '2026-10-18', method: 'transfer', reason: 'Trop-perçu',
      lines: refused.body.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
    },
  }, refunded);
  assert.equal(refunded.statusCode, 201, JSON.stringify(refunded.body));

  // Journal of October: the solde as received, the refund as given back.
  const accounting = createAccountingModel(db);
  const entries = [
    ...accounting.encaissementsByMonth({ month: 10, year: 2026 }),
    ...accounting.refundsByMonth({ month: 10, year: 2026 }),
  ].filter((e) => Number(e.reservationId) === Number(id));
  const lines = entries.flatMap((e) => entryToStructured(e).lines);
  const net = (compte) => round2(lines.filter((l) => l.compte === compte)
    .reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0));
  const clientAccount = lines.find((l) => /^C/.test(l.compte)).compte;
  assert.equal(net(clientAccount), 355.2, 'client account: 465,60 received − 110,40 returned');
  assert.equal(-net('46710000'), 7.2, 'the tax kept is the tax of 2 adults, never negative');
  for (const entry of entries) {
    const { lines: own } = entryToStructured(entry);
    for (const l of own) {
      assert.ok(!(Number(l.credit) < 0) && !(Number(l.debit) < 0), `negative amount on ${l.compte}`);
    }
  }

  // Finance « Encaissé » and the stay's total.
  const summary = financeModel.getSummary({ from: '2026-10-01', to: '2026-10-31' });
  const stay = summary.reservations.find((r) => Number(r.id) === Number(id));
  assert.equal(summary.totalCollected, 355.2);
  assert.equal(stay.totalSejour, 355.2);

  // The fiche: « Total perçu » and nothing left to refund.
  const live = respond();
  await controller.calculatePrice({ body: { ...body(2), reservationId: id, balancePaid: true, balanceAmount: 355.2 }, user: { role: 'admin' } }, live);
  assert.equal(live.statusCode, 200, JSON.stringify(live.body));
  assert.equal(live.body.balanceAmount, 465.6, 'a stale amount from the browser never lowers the paid solde');
  assert.equal(live.body.overpaymentTtc, 0);
  assert.equal(live.body.sejourNetTotal, 355.2);
});
