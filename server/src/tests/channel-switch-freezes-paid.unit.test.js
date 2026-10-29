// specs/reservation-save-keeps-pricing.md rule 19 + reservation-refunds.md rule 45 — audit R4 N6, decided by
// Adrien on 2026-10-29 (« Autoriser, figer le payé »): a direct stay whose acompte or solde is ticked can
// switch to a platform; what was received stays as received, and the switch alone asks for no refund.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

let seeded = false;
let slot = 0;
async function stay(extra = {}) {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  if (!seeded) {
    db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
                VALUES (1, 'Gîte', 8, 'per_day_per_person', 1, 0)`).run();
    db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
    db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
    seeded = true;
  }
  slot += 1;
  const day = (offset) => new Date(Date.UTC(2099, 0, 1 + offset)).toISOString().slice(0, 10);
  const body = (overrides = {}) => ({
    propertyId: 1, clientId: 1, startDate: day(slot * 4), endDate: day(slot * 4 + 3), checkInTime: '16:00', checkOutTime: '10:00',
    platform: 'direct', adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1,
    options: [], ...extra, ...overrides,
  });
  const created = await new Promise((resolve) => {
    controller.create({ body: body(), user: { role: 'admin' } }, { status() { return this; }, json: resolve });
  });
  return { db, controller, id: created.id, body };
}

const preview = (controller, id, body) => new Promise((resolve) => {
  controller.calculatePrice({ body: { ...body, reservationId: id, selectedOptions: [], customOptions: [], selectedResources: [] }, user: { role: 'admin' } }, { status() { return this; }, json: resolve });
});
const rowOf = (db, id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

async function paidDirectStay() {
  const s = await stay();
  s.db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ?, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?').run('2099-01-01', s.id);
  return { ...s, received: rowOf(s.db, s.id).balanceAmount };
}

test('rule 19 — the preview of a paid direct stay switched to a platform announces no trop-perçu', async () => {
  const { controller, id, body } = await paidDirectStay();
  const live = await preview(controller, id, body({ platform: 'Airbnb', discountPercent: 10 }));
  assert.equal(live.error, undefined, JSON.stringify(live));
  assert.equal(live.overpaymentTtc, 0);
  assert.deepEqual(live.overpaymentLines, []);
});

test('rule 19 — the save is not refused with OVERPAID and keeps the paid solde at what was received', async () => {
  const { db, controller, id, body, received } = await paidDirectStay();
  const saved = controller.performUpdate(id, body({ platform: 'Airbnb', discountPercent: 10 }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const after = rowOf(db, id);
  assert.equal(after.platform, 'Airbnb');
  assert.equal(after.balancePaid, 1);
  assert.equal(after.balanceAmount, received, 'the solde stays at the 100 % received, not at the platform price');
});

test('rule 19 — a paid acompte is frozen the same way', async () => {
  const { db, controller, id, body } = await stay({ depositDisabled: 0 });
  db.prepare("UPDATE reservations SET depositAmount = 60, balanceAmount = finalPrice + touristTaxTotal - 60, depositPaid = 1, depositPaidDate = '2099-01-01' WHERE id = ?").run(id);
  const before = rowOf(db, id);
  const saved = controller.performUpdate(id, body({ platform: 'Airbnb', depositDisabled: 0 }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const after = rowOf(db, id);
  assert.equal(after.depositPaid, 1);
  assert.equal(after.depositAmount, before.depositAmount);
});

test('rule 19 — a save that moves no price keeps the frozen amounts; a re-pricing follows the platform (reservation-refunds rule 38)', async () => {
  const { db, controller, id, body, received } = await paidDirectStay();
  controller.performUpdate(id, body({ platform: 'Airbnb', discountPercent: 10 }));
  const noted = controller.performUpdate(id, body({ platform: 'Airbnb', discountPercent: 10, notes: 'après' }));
  assert.equal(noted.status, 200, JSON.stringify(noted.body));
  assert.equal(rowOf(db, id).balanceAmount, received);
  const repriced = controller.performUpdate(id, body({ platform: 'Airbnb', discountPercent: 20 }));
  assert.equal(repriced.status, 200, JSON.stringify(repriced.body));
  const after = rowOf(db, id);
  assert.equal(after.balanceAmount, Math.round((after.finalPrice + after.touristTaxTotal) * 100) / 100);
});

test('rule 19 — a direct stay saved as direct still asks for the trop-perçu refund', async () => {
  const { controller, id, body } = await paidDirectStay();
  const refused = controller.performUpdate(id, body({ discountPercent: 10 }));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'OVERPAID');
});
