// specs/reservation-save-keeps-pricing.md rule 4 — review of #847, point 2: the trop-perçu a collected
// complement holds (#22224 +21 €, #22226 +28 €, Lodgify = direct channel) reaches the fiche: the preview
// announces it, with the postes the refund dialog offers.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

test('rule 4 — the fiche preview of a stay with an over-collected complement announces the trop-perçu', async () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
              VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  const stayBody = {
    propertyId: 1, clientId: 1, startDate: '2099-05-04', endDate: '2099-05-07', checkInTime: '16:00', checkOutTime: '10:00',
    platform: 'direct', adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1, options: [],
  };
  const created = await new Promise((resolve) => {
    controller.create({ body: stayBody, user: { role: 'admin' } }, { status() { return this; }, json: resolve });
  });
  const id = created.id;
  // Solde 300 paid, then a 100 € complement collected on arrival for a line the stay no longer carries.
  db.prepare('UPDATE reservations SET balancePaid = 1, balanceAmount = 300, complementPaid = 1, complementAmount = 100 WHERE id = ?').run(id);

  const quote = await new Promise((resolve) => {
    controller.calculatePrice({
      body: { ...stayBody, reservationId: id, selectedOptions: [], customOptions: [], selectedResources: [], depositDisabled: 1 },
      user: { role: 'admin' },
    }, { status() { return this; }, json: resolve });
  });
  assert.equal(quote.error, undefined, JSON.stringify(quote));
  assert.equal(quote.overpaymentTtc, 100, 'the 100 € complement is above the stay total');
  assert.ok(quote.overpaymentLines.length > 0, 'the refund dialog has a poste to offer');
});

test('rule 4 — the excess of a complement that lost its bed linen is booked on the options poste, not on the accommodation', () => {
  const { overpaymentLinesOf } = require('../utils/overpayment');
  const lines = overpaymentLinesOf({
    row: { depositPaid: 0, balancePaid: 1 },
    capturedByPoste: {},
    quote: { finalPrice: 300, optionsTotal: 24, resourcesTotal: 0, touristTaxTotal: 0, complementCollectedExcessTtc: 21 },
    overpaymentTtc: 21,
  });
  assert.deepEqual(lines.map((l) => [l.bucket, l.amountTtc]), [['options', 21]]);

  const mixed = overpaymentLinesOf({
    row: { depositPaid: 0, balancePaid: 1 },
    capturedByPoste: { balance: { accommodation: 350, options: 0, resources: 0, touristTax: 0 } },
    quote: { finalPrice: 300, optionsTotal: 24, resourcesTotal: 0, touristTaxTotal: 0, complementCollectedExcessTtc: 21 },
    overpaymentTtc: 71,
  });
  assert.deepEqual(mixed.map((l) => [l.bucket, l.amountTtc]).sort(), [['accommodation', 50], ['options', 21]]);
});

test('rule 4 — the stored ledger of a LOCKED fiche carries the trop-perçu row, with the refund prefill by poste', async () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const id = db.prepare('SELECT id FROM reservations ORDER BY id DESC LIMIT 1').get().id;
  db.prepare("UPDATE reservations SET startDate = '2000-05-04', endDate = '2000-05-07' WHERE id = ?").run(id);
  const res = await new Promise((resolve) => {
    controller.getById({ params: { id: String(id) }, user: { role: 'admin', roles: ['admin'] } }, { status() { return this; }, json: resolve });
  });
  const row = res.ledger.rows.find((r) => r.key === 'overpayment');
  assert.ok(row, 'the ledger of the GET has a Trop-perçu row');
  assert.equal(row.amount, 100);
  assert.equal(row.action.kind, 'refund');
  assert.equal(row.refundPrefill.overpaymentTtc, 100);
  assert.ok(row.refundPrefill.overpaymentLines.length > 0);
});

// ── Review of #847, recheck ──────────────────────────────────────────────────────────────────────────
async function lockedStay(tamper) {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const created = await new Promise((resolve) => {
    controller.create({ body: {
      propertyId: 1, clientId: 1, startDate: '2099-06-04', endDate: '2099-06-07', checkInTime: '16:00', checkOutTime: '10:00',
      platform: 'direct', adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1, options: [],
    }, user: { role: 'admin' } }, { status() { return this; }, json: resolve });
  });
  db.prepare("UPDATE reservations SET startDate = '2000-06-04', endDate = '2000-06-07' WHERE id = ?").run(created.id);
  db.prepare(`UPDATE reservations SET ${tamper} WHERE id = ?`).run(created.id);
  const fiche = await new Promise((resolve) => {
    controller.getById({ params: { id: String(created.id) }, user: { role: 'admin', roles: ['admin'] } }, { status() { return this; }, json: resolve });
  });
  return fiche.ledger.rows.find((r) => r.key === 'overpayment');
}

test('rule 4 — a stay paid in full at its stored price shows no trop-perçu when today\'s engine prices it lower (#14: 807,20 paid, 777,70 replayed)', async () => {
  const row = await lockedStay('finalPrice = 330, balanceAmount = 330, balancePaid = 1');
  assert.equal(row, undefined);
});

test('rule 4 — a stay paid in full at the price the engine still gives holds nothing in excess', async () => {
  const row = await lockedStay('finalPrice = 300, balanceAmount = 300, balancePaid = 1');
  assert.equal(row, undefined, 'a plain paid stay holds nothing in excess');
});

test('rule 4 — a complement taken « caisse interne » prefills the refund with the internal means; a banked one does not (Adrien, 2026-10-29)', async () => {
  const cash = await lockedStay('balancePaid = 1, balanceAmount = 300, complementPaid = 1, complementPaidCash = 1, complementAmount = 40');
  assert.equal(cash.refundPrefill.method, 'internal');
  const banked = await lockedStay('balancePaid = 1, balanceAmount = 300, complementPaid = 1, complementPaidCash = 0, complementAmount = 40');
  assert.equal(banked.refundPrefill.method, null);
});

test('rule 4 — a tourist tax that fell out of the complement is refunded on the tax poste, not on the options', () => {
  const { overpaymentLinesOf } = require('../utils/overpayment');
  const lines = overpaymentLinesOf({
    row: { depositPaid: 0, balancePaid: 1 }, capturedByPoste: {},
    quote: { finalPrice: 300, optionsTotal: 24, resourcesTotal: 0, touristTaxTotal: 2, complementCollectedExcessTtc: 9 },
    overpaymentTtc: 9,
    complementLeft: { touristTax: 4, options: 0, resources: 0 },
  });
  assert.deepEqual(lines.map((l) => [l.bucket, l.amountTtc]).sort(), [['options', 5], ['touristTax', 4]]);
});
