// specs/pricing-components.md §3 rules 10, 18, 25 (class E5) — the arrival SAS sells through the Articles head: the catalogue upsells and the
// sold breakfast / catering are priced by the head's read, to the cent the pre-refonte arithmetic gave; what the SAS wrote is a sale
// of source `sas`, collected at arrival, that `saleDetail` shows with that source.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, createStay, seed } = require('./ledgerFixture');
const model = require('../models/reservationsModel');
const { priceOptionSale, priceCatalogueUpsell } = require('../utils/sasOptionSale');
const extraSale = require('../utils/extraSale');

// The arithmetic the SAS carried before the refonte, kept here as the oracle (tests are outside the formula guards).
const legacyUnits = (priceType, persons, nights) => ({
  per_person: persons, per_night: nights, per_person_per_night: persons * nights,
}[priceType] ?? 1);
const legacyTotal = (price, units) => Math.round(price * units * 100) / 100;

test('rule 10 — a catalogue upsell is priced by the head to the cent the old multiplier gave, on every price type and party', () => {
  let checked = 0;
  for (const priceType of ['per_stay', 'free', 'per_person', 'per_night', 'per_person_per_night']) {
    for (const price of [0.1, 3.33, 7, 12.5, 19.99, 24]) {
      for (const persons of [1, 2, 3, 5]) {
        for (const nights of [1, 2, 3, 7]) {
          const got = priceCatalogueUpsell({ id: 1, price, priceType }, { unitPrice: price, persons, nights });
          assert.equal(got.billedUnits, legacyUnits(priceType, persons, nights), `${priceType} ${persons}x${nights}`);
          assert.equal(got.totalPrice, legacyTotal(price, legacyUnits(priceType, persons, nights)), `${priceType} ${price} ${persons}x${nights}`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 400);
});

test('rule 10 — a sold option is priced by the head: units, cards and typed counts keep their old totals', () => {
  const perStay = priceOptionSale({ id: 2, price: 17, priceType: 'per_stay' }, { persons: 3, nights: 3, units: 2 });
  assert.deepEqual([perStay.quantity, perStay.billedUnits, perStay.totalPrice], [2, 2, 34]);
  const typed = priceOptionSale({ id: 3, price: 6.5, priceType: 'per_person' }, { persons: 4, nights: 2, servedPersons: 3 });
  assert.deepEqual([typed.billedUnits, typed.totalPrice, typed.cardPersons], [3, 19.5, 3]);
  const nights = priceOptionSale({ id: 4, price: 9, priceType: 'per_night' }, { persons: 4, nights: 5, units: 3 });
  assert.deepEqual([nights.billedUnits, nights.totalPrice, nights.cardNights], [3, 27, 3]);
  const none = priceOptionSale({ id: 5, price: 9, priceType: 'per_night' }, { persons: 4, nights: 5, units: 0 });
  assert.equal(none, null);
});

test('rules 18, 25 — what the arrival SAS wrote is a sale of source sas, collected at arrival, soldAt set; saleDetail says so', () => {
  seed();
  const id = createStay();
  model.commitArrivalSas(id, { complementItems: [{ label: 'Taie d’oreiller', amount: 6, qty: 2 }] });
  const row = db.prepare("SELECT source, collectAt, collectAtDefault, soldAt FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1").get(id);
  assert.deepEqual([row.source, row.collectAt, row.collectAtDefault], ['sas', 'arrival', 'arrival']);
  assert.ok(row.soldAt);
  const line = extraSale.saleDetailOf(id).lines.find((l) => l.label === 'Taie d’oreiller');
  assert.deepEqual([line.source, line.sourceLabel, line.collectAt, line.totalCents], ['sas', 'SAS', 'arrival', 600]);
});

test('rule 18 — a second run of the SAS replaces its own lines (no stacking) and stamps them again', () => {
  const id = createStay();
  model.commitArrivalSas(id, { complementItems: [{ label: 'Serviette', amount: 4, qty: 1 }] });
  model.commitArrivalSas(id, { complementItems: [{ label: 'Serviette', amount: 4, qty: 1 }, { label: 'Drap', amount: 9, qty: 1 }] });
  const rows = db.prepare('SELECT description, source, collectAt FROM reservation_custom_options WHERE reservationId = ? ORDER BY description').all(id);
  assert.deepEqual(rows.map((r) => [r.description, r.source, r.collectAt]), [['Drap', 'sas', 'arrival'], ['Serviette', 'sas', 'arrival']]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = ?').get(id).n, 2);
});

test('rule 32 — a started stay\'s departure sales are the SAS\'s own section, apart from the arrival total; none → no section', () => {
  const none = createStay();
  assert.equal(extraSale.departureSalesOf(none), null);
  const id = createStay();
  db.prepare("UPDATE reservation_custom_options SET collectAt = 'departure' WHERE reservationId = ?").run(id);
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder, inComplement, source, collectAt) VALUES (?, 'Bûches', 12, 0, 0, 0, 'fiche', 'departure')").run(id);
  const section = extraSale.departureSalesOf(id);
  assert.equal(section.title, 'Ventes du séjour — au départ');
  assert.deepEqual(section.lines.map((l) => [l.label, l.totalCents, l.statusLabel]), [['Bûches', 1200, 'À payer au départ']]);
  assert.deepEqual([section.totalCents, section.dueCents], [1200, 1200]);
});
