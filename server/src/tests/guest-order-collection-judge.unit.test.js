// specs/guest-app.md rule 101 (fifth pass, 2026-11-10) — the judge (`orderCollection`) never promises what the measure refuses: it plays a
// probe order through the same dry-run measure as a real one, so « arrival » is answered exactly when an order is quoted and committed.
// Stays by platform MODE (own channel, OTA, OTA taking the acompte, percentage tourist tax), never by name.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();

const db = require('../database');
const { priceOrder, commitOrder, orderCollection } = require('../utils/midStayOrderCommit');

const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPercentage, touristTaxDepartmentPercentage, depositEnabled) VALUES (1, 'Gîte', 8, 'percentage_accommodation', 5, 10, 1)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (102, 'Cidre', 6, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 102)').run();
db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform, platformTakesDeposit, countsAsDirect) VALUES ('Mode OTA acompte', 1, 0, 1, 0), ('Mode OTA seule', 1, 0, 0, 0)").run();

let sequence = 0;
function seedStay({ platform = 'direct', start = 5, paid = 1, balanceAmount = 280, finalPrice = 400, gross = null } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations
    (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
     depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
     doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid, depositPaid, reservationNumber, platformGrossAmount, clientGrossAmount)
    VALUES (1, 1, ?, ?, 2, 0, 0, 0, ?, 400, 0, ?, 120, ?, 0, 5, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)`)
    .run(isoPlus(start), isoPlus(start + 4), platform, finalPrice, balanceAmount, isoPlus(start), paid, paid, `2026${String(++sequence).padStart(5, '0')}`, gross, gross).lastInsertRowid);
  for (let i = start; i < start + 4; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  return id;
}

const lines = [{ kind: 'option', id: 102, quantity: 2 }];
const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });

const STAYS = {
  'own channel, settled': () => seedStay(),
  'own channel, settled, arrival today': () => seedStay({ start: 0 }),
  'own channel, past dates, settled': () => seedStay({ start: -3 }),
  'own channel, solde due': () => seedStay({ paid: 0 }),
  'own channel, stored buckets above the engine price (the reviewer\'s stay 14)': () => seedStay({ balanceAmount: 330, finalPrice: 450 }),
  'OTA, nothing paid': () => seedStay({ platform: 'Mode OTA seule', paid: 0, gross: 400 }),
  'OTA taking the acompte (the reviewer\'s Lodgify stays)': () => seedStay({ platform: 'Mode OTA acompte', paid: 0, gross: 400 }),
  'OTA taking the acompte, past dates': () => seedStay({ platform: 'Mode OTA acompte', start: -3, paid: 0, gross: 400 }),
};

for (const [name, make] of Object.entries(STAYS)) {
  test(`rule 101: ${name} — the judge says « arrival » exactly when the quote and the commit accept an order`, () => {
    const id = make();
    const judged = orderCollection(id);
    const quote = priceOrder(id, lines);
    assert.equal(judged === 'arrival', quote.status === 200, `judge ${judged}, quote ${quote.status} ${JSON.stringify(quote.body || quote.byKey)}`);
    const result = commitOrder(id, { ...named(id), lines });
    assert.equal(judged === 'arrival', result.status === 200, `judge ${judged}, commit ${result.status}`);
  });
}

test('rule 101: stored buckets above the engine price — the judge reads « unavailable » where it used to read « arrival » and the order was refused', () => {
  const id = seedStay({ balanceAmount: 330, finalPrice: 450 });
  assert.equal(orderCollection(id, { probe: false }), 'arrival', 'the cheap predicate alone promised the order');
  assert.equal(orderCollection(id), 'unavailable');
  assert.equal(priceOrder(id, lines).body.code, 'ORDER_OFF_ARRIVAL_COMPLEMENT');
});

test('rule 101: the probe writes nothing', () => {
  const id = seedStay();
  const before = JSON.stringify(db.prepare('SELECT * FROM reservations WHERE id = ?').get(id));
  orderCollection(id);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = ?').get(id).n, 0);
});
