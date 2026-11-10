// specs/guest-app.md rules 96 and 99 (fifth pass, 2026-11-10) — `exactMergedTotals` is the order commit's own engine switch:
// (a) every save other than a guest order is byte-identical to master — an ordinary save that raises a line held at an older price keeps
// master's figure (units × the merged line's rounded unit price); (b) the operator's HTTP route ignores the flag in its body.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();

const db = require('../database');
const reservations = require('../models/reservationsModel');
const controller = require('../controllers/reservationsController');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { commitOrder } = require('../utils/midStayOrderCommit');

const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, depositEnabled) VALUES (1, 'Gîte', 8, 'none', 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (18, 'Cidre', 7, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 18)').run();

let sequence = 0;
function seedStayHolding(quantity, unitPrice) {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid, reservationNumber)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 800, 0, ?, 0, ?, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1, ?)`)
    .run(isoPlus(5), isoPlus(9), 800 + quantity * unitPrice, 800 + quantity * unitPrice, isoPlus(3), `2026${String(++sequence).padStart(5, '0')}`).lastInsertRowid);
  for (let i = 5; i < 9; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 200)").run(id, isoPlus(i));
  }
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, 18, ?, ?, ?, 'per_stay', ?)")
    .run(id, quantity, unitPrice, quantity, quantity * unitPrice);
  return id;
}
const lineTotal = (id) => db.prepare('SELECT totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = 18').get(id).totalPrice;
const raised = (id, extra = {}) => {
  const body = toUpdateBody(reservations.getByIdWithDetails(id), new Set());
  return { ...body, ...extra, options: body.options.map((o) => (Number(o.optionId) === 18 ? { ...o, quantity: 3 } : o)) };
};

test('rule 96 (Q6): an ordinary save raising a line held at 1 × 6,50 € to 3 units keeps master\'s figure — 3 × 6,83 € = 20,49 €, never the exact 20,50 €', () => {
  const id = seedStayHolding(1, 6.5);
  const saved = controller.performUpdate(id, raised(id), { beforeArrival: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(lineTotal(id), 20.49);
});

test('rule 96: the same raise carried by an order (the exact switch of the commit) lands on the exact 20,50 €', () => {
  const id = seedStayHolding(1, 6.5);
  const result = commitOrder(id, { source: 'shopOrder', ref: 1, history: { field: 'shopOrder', label: 'Commande boutique', text: 'Commande boutique #1' }, lines: [{ kind: 'option', id: 18, quantity: 2 }] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(lineTotal(id), 20.5);
});

test('rule 99 (LOW 7): the operator\'s PUT /api/reservations/:id ignores an exactMergedTotals carried by its body', async () => {
  const id = seedStayHolding(1, 6.5);
  const body = raised(id, { exactMergedTotals: true });
  const req = { params: { id }, body, headers: {}, query: {}, user: { role: 'admin' } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await controller.update(req, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  assert.equal(req.body.exactMergedTotals, undefined, 'stripped before anything reads it');
  assert.equal(lineTotal(id), 20.49, 'master\'s figure, not the exact one');
});
