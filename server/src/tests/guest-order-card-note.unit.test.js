// specs/guest-app.md rules 85, 97 (fourth pass, 2026-11-10) — the arrival note of a card order before the arrival: (a) it keeps the
// quantity the order sold (« 2 × 6,50 € », not « 1 × 13 € »); (b) the arrival complement stays net of it when the fiche re-prices
// afterwards (kills the mutant that stops netting the card notes in `pricing.js`, which the pinned write of the order itself masks).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();

const db = require('../database');
const reservations = require('../models/reservationsModel');
const { commitOrder } = require('../utils/midStayOrderCommit');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { performUpdate } = require('../controllers/reservationsController');

const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, depositEnabled) VALUES (1, 'Gîte', 8, 'none', 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (102, 'Cidre', 6.5, 'per_stay'), (103, 'Bois', 7.5, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 102), (1, 103)').run();

let sequence = 0;
function seedStay() {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid, reservationNumber)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 400, 0, 400, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1, ?)`)
    .run(isoPlus(5), isoPlus(9), isoPlus(5), `2026${String(++sequence).padStart(5, '0')}`).lastInsertRowid);
  for (let i = 5; i < 9; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  return id;
}
const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const paid = (amountCents, reference) => ({ amountCents, paidDate: isoPlus(0), reference });

test('rule 97 (LOW 4): a card order of 2 × 6,50 € leaves an arrival note line of quantity 2 at 6,50 €, not 1 × 13 €', () => {
  const id = seedStay();
  assert.equal(commitOrder(id, { ...named(1), lines: [{ kind: 'option', id: 102, quantity: 2 }], paid: paid(1300, 'pay_1') }).status, 200);
  const [note] = JSON.parse(row(id).midStaySettledNotes);
  assert.deepEqual(note.lines.map((l) => [l.key, l.qty, l.unitPrice, l.amount]), [['opt:102', 2, 6.5, 13]]);
});

test('rule 97: a single unit stays 1 × its price; a payment short of the sale keeps the amount paid on one unit', () => {
  const id = seedStay();
  assert.equal(commitOrder(id, { ...named(2), lines: [{ kind: 'option', id: 102, quantity: 1 }], paid: paid(650, 'pay_2') }).status, 200);
  const other = seedStay();
  assert.equal(commitOrder(other, { ...named(3), lines: [{ kind: 'option', id: 102, quantity: 3 }], paid: paid(1000, 'pay_3') }).status, 200);
  const [single] = JSON.parse(row(id).midStaySettledNotes);
  const [partial] = JSON.parse(row(other).midStaySettledNotes);
  assert.deepEqual([single.lines[0].qty, single.lines[0].unitPrice], [1, 6.5]);
  assert.deepEqual([partial.lines[0].qty, partial.lines[0].unitPrice, partial.lines[0].amount], [1, 10, 10]);
});

test('rule 85 (LOW 1, kills M3): a card order before the arrival, then the operator adds an option — the arrival complement is that option alone, the card order is never billed again', () => {
  const id = seedStay();
  assert.equal(commitOrder(id, { ...named(4), lines: [{ kind: 'option', id: 102, quantity: 2 }], paid: paid(1300, 'pay_4') }).status, 200);
  assert.equal(row(id).complementAmount, 0);
  const body = toUpdateBody(reservations.getByIdWithDetails(id), new Set());
  const saved = performUpdate(id, { ...body, options: [...body.options, { optionId: 103, quantity: 1, inComplement: 1 }] }, { beforeArrival: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(row(id).complementAmount, 7.5, 'the new option only: the 13 € paid by card are netted out');
});
