// specs/reservation-payment-ledger.md §3.8 rules 50-52 and 57 — the stored summary is shaped like the live
// quote (the fiche renders both with one component), and a tariff change alone never raises the drift.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, controller, respond, seed, createStay, liveQuote, rowOf, ADMIN } = require('./ledgerFixture');

seed();
db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (20, 'Linge de lit', 'per_stay', 70)").run();
db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (21, 'Petit-déjeuner', 'per_person', 9)").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 20), (1, 21)').run();
db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 20, 1)').run();
db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (30, 'Bain nordique', 1, 60, 'per_stay')").run();

function stored(id) {
  const res = respond();
  controller.getById({ params: { id: String(id) }, user: ADMIN }, res);
  return res.body.storedSummary;
}

function addLines(id) {
  db.prepare(`INSERT OR REPLACE INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement)
    VALUES (?, 20, 1, 70, 1, 'per_stay', 70, 1, 0), (?, 21, 2, 9, 6, 'per_person', 54, 0, 1)`).run(id, id);
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, offered, inComplement) VALUES (?, 'Bouquet', 25, 0, 0)").run(id);
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement)
    VALUES (?, 30, 1, 60, 1, 'per_stay', 60, 0, 0)`).run(id);
}

test('rule 51 — stored options, custom options and resources are listed by name with offered, included and complement flags', () => {
  const id = createStay();
  addLines(id);
  const s = stored(id);
  const titles = s.optionLines.map((l) => l.title);
  assert.deepEqual(titles, ['Linge de lit', 'Petit-déjeuner', 'Bouquet']);
  const linen = s.optionLines[0];
  assert.deepEqual([linen.offered, linen.includedInRate, linen.totalPrice, linen.originalTotalPrice], [true, true, 0, 70], 'a property default that is offered reads « Comprise », struck at its real price');
  const breakfast = s.optionLines[1];
  assert.deepEqual([breakfast.inComplement, breakfast.quantity, breakfast.totalPrice], [1, 2, 54]);
  assert.deepEqual([s.optionLines[2].isCustom, s.optionLines[2].totalPrice], [true, 25]);
  assert.equal(s.resourceLines[0].name, 'Bain nordique');
  assert.equal(s.optionsTotal, 79, 'offered lines bill nothing: 54 + 25');
  assert.equal(s.resourcesTotal, 60);
});

test('rule 51 — the nightly detail is offered only while the saved nights add up to the saved accommodation', () => {
  const id = createStay();
  const s = stored(id);
  assert.equal(s.nights, 3);
  assert.equal(s.nightlyBreakdown.length, 3);
  assert.equal(s.nightlyBreakdown.reduce((total, n) => total + n.price, 0), s.accommodation);
  db.prepare("UPDATE reservation_nights SET price = price + 5 WHERE reservationId = ? AND date = (SELECT MIN(date) FROM reservation_nights WHERE reservationId = ?)").run(id, id);
  assert.deepEqual(stored(id).nightlyBreakdown, [], 'no detail rather than nights that do not add up');
});

test('rule 51 — the tourist-tax case of the stay follows its platform: offered, reversed, collected on arrival', () => {
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Offerte', 1, 1), ('Reversee', 1, 0), ('Surplace', 0, 0)").run();
  const flags = (platform) => {
    const id = createStay({ platform });
    db.prepare('UPDATE reservations SET touristTaxTotal = 7.2 WHERE id = ?').run(id);
    const s = stored(id);
    return [s.touristTaxOfferedByPlatform, s.touristTaxReversedByPlatform, s.touristTaxCollectedOnArrival];
  };
  assert.deepEqual(flags('Offerte'), [true, false, false]);
  assert.deepEqual(flags('Reversee'), [false, true, false]);
  assert.deepEqual(flags('Surplace'), [false, false, true]);
  assert.deepEqual(flags('direct'), [false, false, false]);
});

test('rule 50 — an un-drifted stay: the stored summary and the live quote agree on every figure the card prints', async () => {
  const id = createStay();
  const s = stored(id);
  const live = await liveQuote(id, { selectedOptions: [{ optionId: 20, quantity: 1 }], offeredOptionIds: [20] });
  const printed = (lines) => lines.map((l) => [l.title, l.offered, Boolean(l.includedInRate), l.totalPrice, l.originalTotalPrice]);
  assert.ok(s.optionLines.length > 0, 'the property default option rides the stay');
  assert.deepEqual(printed(s.optionLines), printed(live.optionLines));
  for (const key of ['nights', 'finalPrice', 'touristTaxTotal', 'depositAmount', 'balanceAmount', 'complementAmount',
    'depositDueDate', 'balanceDueDate', 'totalNetPrice', 'totalVatAmount', 'platformSale']) {
    assert.deepEqual(s[key], live[key], key);
  }
  assert.deepEqual(s.summaryCascade, live.summaryCascade);
  assert.deepEqual(s.complementSplit, live.complementSplit);
  assert.deepEqual(s.nightlyBreakdown.map((n) => [n.date, n.price]), live.nightlyBreakdown.map((n) => [n.date, n.price]));
});

test('rule 57 — a season price raised after the save leaves the stay un-drifted: the sale’s tariff is replayed', async () => {
  const id = createStay();
  db.prepare("UPDATE pricing_rules SET pricePerNight = 150 WHERE propertyId = 1").run();
  const live = await liveQuote(id);
  db.prepare("UPDATE pricing_rules SET pricePerNight = 100 WHERE propertyId = 1").run();
  assert.equal(live.storedDrift, false);
  assert.equal(live.finalPrice, rowOf(id).finalPrice);
});

test('rule 57 — a tourist-tax convention switched after the save raises the drift and returns no list of differences', async () => {
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform, commissionPercent) VALUES ('Convention', 1, 1, 15)").run();
  const id = createStay({ platform: 'Convention' });
  assert.equal((await liveQuote(id)).storedDrift, false);
  db.prepare("UPDATE platforms SET collectsTouristTax = 0, touristTaxRemittedByPlatform = 0 WHERE name = 'Convention'").run();
  const live = await liveQuote(id);
  assert.equal(live.storedDrift, true);
  assert.equal('storedDriftItems' in live, false);
});

test('rule 51 — the nightly detail is compared with the saved price of the nights, so options do not hide it', () => {
  const id = createStay();
  addLines(id);
  const s = stored(id);
  assert.equal(s.nightlyBreakdown.length, 3, 'the nights still add up to `totalPrice` although options sit in the price');
});

test('rule 51 — a line that is not offered keeps its saved price, a free (0 €) one included', () => {
  const id = createStay();
  db.prepare(`INSERT OR REPLACE INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement)
    VALUES (?, 21, 2, 9, 6, 'per_person', 0, 0, 0)`).run(id);
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement)
    VALUES (?, 30, 1, 60, 1, 'per_stay', 0, 0, 0)`).run(id);
  const before = rowOf(id).finalPrice;
  const s = stored(id);
  assert.equal(s.optionLines.find((l) => l.title === 'Petit-déjeuner').totalPrice, 0);
  assert.equal(s.resourceLines[0].totalPrice, 0);
  assert.equal(s.accommodation, before, 'the accommodation does not shrink by what was never billed');
});

test('rule 50 — « Total du séjour » of the card is the one of the sticky bar, and the printed lines add up to it', () => {
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform, commissionPercent) VALUES ('Retenue', 1, 1, 10)").run();
  const id = createStay({ platform: 'Retenue' });
  db.prepare('UPDATE reservations SET touristTaxTotal = 0, platformTouristTaxAmount = 16.02 WHERE id = ?').run(id);
  const res = respond();
  controller.getById({ params: { id: String(id) }, user: ADMIN }, res);
  const s = res.body.storedSummary;
  const bar = res.body.storedHeadline.secondary.amount;
  assert.equal(s.summaryCascade.grossTotal, bar, 'card and bar say the same gross');
  assert.equal(s.platformTouristTaxWithheld, 16.02);
  assert.equal(s.touristTaxOfferedByPlatform, true, 'a stated withheld tax is the platform’s: printed struck, « Plateforme »');
  assert.equal(s.summaryCascade.offeredTaxDeduction, 16.02);
  assert.equal(Math.round((s.accommodation + s.optionsTotal + s.resourcesTotal + s.platformTouristTaxWithheld) * 100), Math.round(bar * 100));
});

test('rule 50 — a stated withheld tax left over on a row that carries its own tax is ignored, by the card and by the bar', () => {
  const id = createStay({ platform: 'Reversee' });
  db.prepare('UPDATE reservations SET touristTaxTotal = 19.2, platformTouristTaxAmount = 16.02 WHERE id = ?').run(id);
  const res = respond();
  controller.getById({ params: { id: String(id) }, user: ADMIN }, res);
  const s = res.body.storedSummary;
  const row = rowOf(id);
  assert.equal(s.platformTouristTaxWithheld, null);
  assert.equal(s.touristTaxOfferedByPlatform, false);
  assert.equal(s.touristTaxReversedByPlatform, true, 'the 19,20 € the operator declares stays on the card');
  assert.equal(s.summaryCascade.grossTotal, Math.round((row.finalPrice + 19.2) * 100) / 100);
  assert.equal(res.body.storedHeadline.secondary.amount, s.summaryCascade.grossTotal, 'card and bar agree');
});
