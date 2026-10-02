// specs/plugins-phase-3b-neat.md rules 3, 5 (decisions P10, P13) — without an active Neat nothing new gets
// the cancellation insurance, and a line a stay or a devis already carries is kept exactly as stored,
// read-only, through every later save.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');
const insuranceOffer = require('../utils/insuranceOffer');
const { offerInsurance, withdrawInsurance } = require('./insuranceOfferFixture');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const INSURANCE = 10;

// A stay of 3 nights sold with a Neat-priced insurance at 23 € — the Options tariff is 3 € a night.
function seed({ kind = 'reservation', withLine = true } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 100, '[{"startDate":"2026-01-01","endDate":"2027-12-31"}]')`).run();
  db.prepare(`INSERT INTO options (id, title, priceType, price, isCancellationInsurance)
    VALUES (?, 'Assurance annulation', 'per_night', 3, 1)`).run(INSURANCE);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(INSURANCE);
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults)
    VALUES (?, 1, 1, '2026-11-10', '2026-11-13', 2)`).run(kind).lastInsertRowid);
  if (withLine) {
    db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice)
      VALUES (?, ?, 1, 23, 1, 'per_night', 23)`).run(id, INSURANCE);
  }
  return { db, id };
}

const STAY = {
  propertyId: 1, adults: 2, children: 0, teens: 0, babies: 0, checkInTime: '16:00', checkOutTime: '10:00',
  startDate: '2026-11-10', endDate: '2026-11-13', customOptions: [], selectedResources: [], discountPercent: 0,
};

function price(db, bookingId, { selectedOptions, lockedOptionLines = [] }) {
  const gate = insuranceOffer.gateSelection({ db, bookingId, selectedOptions, lockedOptionLines });
  if (gate.error) return gate;
  const quote = calculateReservationQuote({ ...STAY, db, ...gate });
  return { line: quote.optionLines.find((l) => Number(l.optionId) === INSURANCE) || null, gate };
}

test.beforeEach(() => withdrawInsurance());
test.after(() => withdrawInsurance());

test('rule 5 — a sold Neat-priced line stays at 23 € to the cent, even with the price lock dropped', () => {
  const { db, id } = seed();
  const { line } = price(db, id, { selectedOptions: [{ optionId: INSURANCE, quantity: 1 }], lockedOptionLines: [] });
  assert.equal(line.unitPrice, 23);
  assert.equal(line.billedUnits, 1);
  assert.equal(line.totalPrice, 23, 'never re-billed at 3 € × 3 nights');
});

test('rule 5 — the line is read-only: removing it or changing its quantity is ignored', () => {
  const { db, id } = seed();
  const removed = price(db, id, { selectedOptions: [] });
  assert.equal(removed.line.totalPrice, 23, 'a payload without it keeps it');
  const inflated = price(db, id, { selectedOptions: [{ optionId: INSURANCE, quantity: 5 }] });
  assert.equal(inflated.gate.selectedOptions.find((o) => o.optionId === INSURANCE).quantity, 1);
  assert.equal(inflated.line.totalPrice, 23);
});

test('rule 5 — a devis keeps its quoted line, past its validity too', () => {
  const { db, id } = seed({ kind: 'devis' });
  const { line } = price(db, id, { selectedOptions: [], lockedOptionLines: [] });
  assert.equal(line.totalPrice, 23);
});

test('rule 5 — nothing new gets it: a stay without the line, or a new one, is refused with 422', () => {
  const { db, id } = seed({ withLine: false });
  for (const bookingId of [id, 0]) {
    const refused = price(db, bookingId, { selectedOptions: [{ optionId: INSURANCE, quantity: 1 }] });
    assert.deepEqual(refused.error, {
      status: 422, code: 'INSURANCE_NOT_OFFERED', error: 'L’assurance annulation n’est pas proposée sans le plugin Neat.',
    });
  }
  assert.deepEqual(insuranceOffer.dropInsurance(db, [{ optionId: INSURANCE }, { optionId: 3 }]), [{ optionId: 3 }], 'a property default is not added');
});

test('rule 5 — with Neat active the gate steps aside: the line follows the payload', () => {
  offerInsurance();
  const { db, id } = seed();
  const { line } = price(db, id, { selectedOptions: [] });
  assert.equal(line, null, 'removable again');
  const bare = seed({ withLine: false });
  const added = price(bare.db, bare.id, { selectedOptions: [{ optionId: INSURANCE, quantity: 1 }] });
  assert.equal(added.line.totalPrice, 9, 'at its Options price: 3 € × 3 nights');
});
