// specs/guest-app.md rule 85 (audit of the J-7 branch, item 6) — the settled note of an order paid by card before the arrival
// (`moment: 'arrival'`) is the provider's money: neither « annuler » nor the register's in-place edit (total, mode, date) may
// touch it. The refusal is its own code, never « note introuvable », and nothing moves.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();

const db = require('../database');
const reservations = require('../models/reservationsModel');
const { commitOrder } = require('../utils/midStayOrderCommit');

const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (102, 'Cidre', 6, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 102)').run();

function paidBeforeArrival() {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 400, 0, 400, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1)`)
    .run(isoPlus(5), isoPlus(9), isoPlus(5)).lastInsertRowid);
  for (let i = 5; i < 9; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  const result = commitOrder(id, {
    source: 'guestOrder', ref: id, history: { field: 'guestOrder', label: 'Commande client', text: 'Commande client' },
    lines: [{ kind: 'option', id: 102, quantity: 2 }], paid: { amountCents: 1200, paidDate: isoPlus(0), reference: 'pay_x' },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return id;
}
const notesOf = (id) => db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id).midStaySettledNotes;

test('rule 85: cancelling the arrival-moment note of a card order is refused NOTE_ONLINE_PAYMENT, the note stays', () => {
  const id = paidBeforeArrival();
  const before = notesOf(id);
  const [note] = JSON.parse(before);
  assert.throws(() => reservations.cancelMidStayNote(id, note.id), (err) => err.code === 'NOTE_ONLINE_PAYMENT');
  assert.equal(notesOf(id), before);
});

test('rule 85: adjusting the arrival-moment note (total, cash flag, date) is refused NOTE_ONLINE_PAYMENT, nothing moves', () => {
  const id = paidBeforeArrival();
  const before = notesOf(id);
  const [note] = JSON.parse(before);
  for (const change of [{ total: 4 }, { cash: true }, { paidDate: isoPlus(-1) }]) {
    assert.throws(() => reservations.adjustMidStayNote(id, { id: note.id, ...change }), (err) => err.code === 'NOTE_ONLINE_PAYMENT', JSON.stringify(change));
  }
  assert.equal(notesOf(id), before);
});

test('rule 85: through the payment PATCH the refusal is a 409 carrying its code, never a 404', () => {
  const id = paidBeforeArrival();
  const [note] = JSON.parse(notesOf(id));
  const { applyMidStayNoteActions } = require('../controllers/reservationsController').__test;
  for (const body of [{ cancelMidStayNote: { id: note.id } }, { adjustMidStayNote: { id: note.id, total: 3 } }]) {
    const refused = applyMidStayNoteActions(id, body);
    assert.deepEqual([refused.status, refused.body.code], [409, 'NOTE_ONLINE_PAYMENT'], JSON.stringify(body));
  }
});
