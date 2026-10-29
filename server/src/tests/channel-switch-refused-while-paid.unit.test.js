// specs/reservation-save-keeps-pricing.md rule 20 + reservation-refunds.md rule 46 — audit R4 N6, Adrien's
// decision of 2026-10-29 (« Refuser, décocher d'abord »), superseding « figer le payé »: a direct stay can never
// really become a platform stay, so a switch while the acompte or the solde is ticked is refused.

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

async function paidDirectStay(flag = 'balancePaid') {
  const s = await stay();
  const dated = flag.endsWith('Cash') ? '' : `, ${flag}Date = '2099-01-01'`;
  s.db.prepare(`UPDATE reservations SET ${flag} = 1${dated}, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?`).run(s.id);
  return s;
}

const REFUSAL = 'Paiement direct enregistré : le décocher avant de changer de canal.';

for (const flag of ['balancePaid', 'depositPaid', 'balancePaidCash']) {
  test(`rule 20 — ${flag} ticked: the switch to a platform is refused with a 409`, async () => {
    const { db, controller, id, body } = await paidDirectStay(flag);
    const refused = controller.performUpdate(id, body({ platform: 'Airbnb' }));
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'DIRECT_PAYMENT_RECORDED');
    assert.equal(refused.body.error, REFUSAL);
    assert.equal(rowOf(db, id).platform, 'direct');
  });
}

test('rule 20 — unticked, the switch goes through as an ordinary platform fiche; the tourist tax is not left behind', async () => {
  const { db, controller, id, body } = await paidDirectStay();
  const taxBefore = rowOf(db, id).touristTaxTotal;
  assert.equal(controller.performUpdate(id, body({ platform: 'Airbnb' })).status, 409);
  assert.equal(rowOf(db, id).touristTaxTotal, taxBefore, 'the refused switch changes nothing');
  db.prepare('UPDATE reservations SET balancePaid = 0, balancePaidDate = NULL WHERE id = ?').run(id);
  const saved = controller.performUpdate(id, body({ platform: 'Airbnb' }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const after = rowOf(db, id);
  assert.equal(after.platform, 'Airbnb');
  assert.equal(after.balancePaid, 0);
  assert.equal(after.balanceAmount, Math.round((after.finalPrice + after.touristTaxTotal) * 100) / 100,
    'the solde and the tax are priced together: no collected tax left on a frozen solde');
});

test('rule 20 — a platform stay saved as another platform, or as direct, is not refused', async () => {
  const { db, controller, id, body } = await stay({ platform: 'Airbnb' });
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2099-01-01' WHERE id = ?").run(id);
  const other = controller.performUpdate(id, body({ platform: 'Booking.com' }));
  assert.equal(other.status, 200, JSON.stringify(other.body));
  const direct = controller.performUpdate(id, body({ platform: 'direct' }));
  assert.notEqual(direct.body && direct.body.code, 'DIRECT_PAYMENT_RECORDED');
});

test('rule 20 — a paid direct stay saved as direct is untouched by the refusal, and still asks for the trop-perçu refund', async () => {
  const { controller, id, body } = await paidDirectStay();
  const refused = controller.performUpdate(id, body({ discountPercent: 10 }));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'OVERPAID');
});
