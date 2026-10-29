// specs/reservation-save-keeps-pricing.md rules 8-11 — round 2 of the money audit (C, D, E, F): the trop-perçu
// of a stored stay is measured against the STORED price and what was collected, so a confirmed one survives a
// reload (#22306: 2 301,60 paid, then -10 % = 176,30) and engine drift is never one (#14); the live ledger
// reports the change relative to the stored figure; the 409 carries the refund means; the detail line of a
// complement excess does not claim « 0,00 € dus ».

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

let seeded = false;
let slot = 0;
function seed(db) {
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
              VALUES (1, 'Gîte', 8, 'per_day_per_person', 1, 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  seeded = true;
}

async function stay(extra = {}) {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  if (!seeded) seed(db);
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

const get = (controller, id) => new Promise((resolve) => {
  controller.getById({ params: { id: String(id) }, user: { role: 'admin', roles: ['admin'] } }, { status() { return this; }, json: resolve });
});
const overpaymentRow = (fiche) => fiche.ledger.rows.find((r) => r.key === 'overpayment');
const preview = (controller, id, body) => new Promise((resolve) => {
  controller.calculatePrice({ body: { ...body, reservationId: id, selectedOptions: [], customOptions: [], selectedResources: [] }, user: { role: 'admin' } }, { status() { return this; }, json: resolve });
});

test('rule 8 — a confirmed trop-perçu survives the reload and shows on a locked fiche (#22306: solde paid, then -10 %)', async () => {
  const { db, controller, id, body } = await stay();
  const total = db.prepare('SELECT finalPrice + touristTaxTotal AS t FROM reservations WHERE id = ?').get(id).t;
  db.prepare('UPDATE reservations SET balancePaid = 1, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?').run(id);
  const refused = controller.performUpdate(id, body({ discountPercent: 10 }));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  const forced = controller.performUpdate(id, body({ discountPercent: 10, forceOverpayment: true }));
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  const after = db.prepare('SELECT finalPrice, touristTaxTotal, balanceAmount FROM reservations WHERE id = ?').get(id);
  const expected = Math.round((total - (after.finalPrice + after.touristTaxTotal)) * 100) / 100;
  assert.ok(expected > 0);
  assert.equal(overpaymentRow(await get(controller, id)).amount, expected, 'after the reload');
  db.prepare("UPDATE reservations SET startDate = '2000-01-10', endDate = '2000-01-13' WHERE id = ?").run(id);
  assert.equal(overpaymentRow(await get(controller, id)).amount, expected, 'on a locked fiche');
});

test('rule 8 — engine drift is not a trop-perçu on the GET: paid in full at the stored price (#14)', async () => {
  const { db, controller, id } = await stay();
  db.prepare('UPDATE reservations SET finalPrice = 330, balancePaid = 1, balanceAmount = 330 + touristTaxTotal WHERE id = ?').run(id);
  assert.equal(overpaymentRow(await get(controller, id)), undefined);
});

test('rule 8 — a platform stay has none, whatever was collected (the platform refunds its guest)', async () => {
  const { db, controller, id } = await stay();
  db.prepare("UPDATE reservations SET platform = 'Airbnb', finalPrice = 100, balancePaid = 1, balanceAmount = 500 WHERE id = ?").run(id);
  assert.equal(overpaymentRow(await get(controller, id)), undefined);
});

test('rule 9 — an unlocked past fiche saved with a note reports no trop-perçu from engine drift (#14)', async () => {
  const { db, controller, id, body } = await stay();
  db.prepare("UPDATE reservations SET finalPrice = finalPrice + 30, balancePaid = 1, balanceAmount = finalPrice + 30 + touristTaxTotal WHERE id = ?").run(id);
  const live = await preview(controller, id, body({ notes: 'Une note' }));
  assert.equal(live.overpaymentTtc, 0);
});

test('rule 9 — an edit on top of a stored trop-perçu adds only its own change', async () => {
  const { db, controller, id, body } = await stay();
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 20, balancePaid = 1, balanceAmount = (SELECT finalPrice + touristTaxTotal FROM reservations WHERE id = ?) WHERE id = ?').run(id, id);
  const live = await preview(controller, id, body({ notes: 'Une note' }));
  assert.equal(live.overpaymentTtc, 20, 'the stored excess, no more');
});

test('rule 10 — the 409 OVERPAID carries the refund means: caisse interne when the excess sits on a complement taken there', async () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const { id, body } = await stay({ touristTaxInComplement: 1 });
  db.prepare("UPDATE reservations SET balancePaid = 1, balanceAmount = finalPrice, complementPaid = 1, complementPaidCash = 1, complementPaidDate = date('now'), complementAmount = 6 WHERE id = ?").run(id);
  const refused = controller.performUpdate(id, body({ adults: 1 }));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.overpaymentMethod, 'internal');
  db.prepare('UPDATE reservations SET complementPaidCash = 0 WHERE id = ?').run(id);
  assert.equal(controller.performUpdate(id, body({ adults: 1 })).body.overpaymentMethod, null);
});

test('rule 11 — the detail line of a complement excess says what was collected in excess, not « 0,00 € dus »', async () => {
  const { db, controller, id } = await stay({ touristTaxInComplement: 1 });
  db.prepare("UPDATE reservations SET startDate = '2000-02-01', endDate = '2000-02-04', balancePaid = 1, balanceAmount = finalPrice, complementPaid = 1, complementPaidCash = 0, complementPaidDate = date('now'), complementAmount = 40 WHERE id = ?").run(id);
  const row = overpaymentRow(await get(controller, id));
  assert.ok(row);
  assert.ok(row.detail.lines.length > 0);
  for (const line of row.detail.lines) assert.doesNotMatch(line, /dus/);
});
