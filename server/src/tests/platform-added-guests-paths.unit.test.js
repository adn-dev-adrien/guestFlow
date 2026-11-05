// specs/platform-added-guests-tourist-tax.md rules 1, 7, 7bis, 14, 15, 19-23, through the real controllers: the
// engine alone does not prove a save or a preview hands it the stored paid base and the stored addition.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, controller, respond, createStay, inDays, rowOf, save, seed, liveQuote, mark, ADMIN } = require('./ledgerFixture');
const { buildArrivalPaymentDetail } = require('../utils/arrivalPaymentDetail');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const reservationsModel = require('../models/reservationsModel');
const financeModel = require('../models/financeModel');
const { buildContext } = require('../utils/emailContextBuilder');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const LABEL = 'Complément de taxe de séjour';
const TODAY = todayIso();
let seededHere = false;
function seedHere() {
  seed();
  if (seededHere) return;
  seededHere = true;
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests,
      extraGuestPrice, extraGuestPriceUnit, defaultCautionAmount)
    VALUES (3, 'Gîte', 8, 'per_day_per_person', 1.2, 2, 20, 'per_night', 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (3, 'Standard', 300)").run();
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPercentage, basePriceIncludedGuests, defaultCautionAmount)
    VALUES (4, 'Tente', 8, 'percentage_accommodation', 5, 8, 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (4, 'Standard', 300)").run();
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Canal', 1, 0)").run();
}

let offset = 40;
function window(nights = 2) {
  offset += 10;
  return { startDate: inDays(offset), endDate: inDays(offset + nights) };
}

async function addedGuestStay({ propertyId = 3, party = { adults: 3 }, base = {} } = {}) {
  seedHere();
  const stay = { propertyId, platform: 'Canal', platformGrossAmount: 600, ...window(), ...base };
  const id = createStay(stay);
  const res = await save(id, { ...stay, ...party });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return { id, stay };
}

test('rules 1, 19, 21: the save stores the paid base and the added adults beside the amount', async () => {
  const { id } = await addedGuestStay();
  const row = rowOf(id);
  assert.equal(row.platformPaidGuests, 2);
  assert.equal(row.platformPaidAdults, 2);
  assert.equal(row.platformPaidOccupants, 2);
  assert.equal(row.touristTaxAddedGuestsAmount, 2.4);
  assert.equal(row.touristTaxAddedGuestsAdults, 1);
});

test('rule 19: the brut cleared takes the occupants with it, and a request body is never read', async () => {
  const { id, stay } = await addedGuestStay({ party: { adults: 3, platformPaidOccupants: 9 } });
  assert.equal(rowOf(id).platformPaidOccupants, 2);
  await save(id, { ...stay, adults: 3, platformGrossAmount: '' });
  assert.equal(rowOf(id).platformPaidOccupants, null);
  assert.equal(rowOf(id).touristTaxAddedGuestsAdults, 0);
});

test('rule 19: on a percentage property the comparison reads the occupants, the supplement keeps the persons billed', async () => {
  seedHere();
  const stay = { propertyId: 4, platform: 'Canal', platformGrossAmount: 600, children: 2, ...window() };
  const id = createStay(stay);
  // The upgrade of DB-3: the head count the platform billed differs from the party the backfill read.
  db.prepare('UPDATE reservations SET platformPaidGuests = 6, platformPaidOccupants = 4 WHERE id = ?').run(id);
  const saved = await save(id, { ...stay });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(rowOf(id).touristTaxAddedGuestsAmount, 0, 'the party did not move: no gap');
  assert.equal(rowOf(id).platformPaidGuests, 6);
  assert.equal(rowOf(id).platformPaidOccupants, 4);
  const live = await liveQuote(id, { ...stay });
  assert.equal(live.touristTaxAddedGuestsAmount, 0, 'the preview reads the same base');
  assert.equal(quoteStoredReservation(db, rowOf(id)).touristTaxAddedGuestsAmount, 0, 'and so does a replay of the row');
});

test('D12, rule 5: a child removed on a percentage property bills the gap, with nobody added', async () => {
  seedHere();
  const stay = { propertyId: 4, platform: 'Canal', platformGrossAmount: 600, children: 2, ...window() };
  const id = createStay(stay);
  const saved = await save(id, { ...stay, children: 1 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  const row = rowOf(id);
  assert.ok(row.touristTaxAddedGuestsAmount > 0);
  assert.equal(row.touristTaxAddedGuestsAdults, 0);
  const line = reservationsModel.buildArrivalComplementDetail(id).detail.find((l) => l.kind === 'tax');
  assert.equal(line.label, LABEL);
});

test('rule 15: the stored row feeds the figure every surface reads', async () => {
  const { id } = await addedGuestStay();
  const fiche = respond();
  controller.getById({ params: { id: String(id) }, user: ADMIN }, fiche);
  assert.equal(fiche.body.touristTaxInComplementAmount, 2.4);
  const detail = reservationsModel.buildArrivalComplementDetail(id).detail;
  const tax = detail.find((l) => l.kind === 'tax');
  assert.equal(tax.amount, 2.4);
  assert.equal(tax.label, LABEL);
});

test('rule 23: every surface of the line says « Complément de taxe de séjour »', async () => {
  const { id, stay } = await addedGuestStay();
  const quote = await liveQuote(id, { ...stay, adults: 3 });
  assert.equal(quote.complementDetailLines.find((l) => l.kind === 'tax').label, LABEL, 'the live quote');

  const model = reservationsModel.create(db);
  const taxLine = (lines) => lines.find((l) => /taxe de séjour/i.test(l.label));
  assert.equal(taxLine(model.planArrivalSas(id).existingLines || model.planArrivalSas(id).lines).label, LABEL, 'the arrival SAS recap');
  assert.equal(taxLine(model.planDepartureSas(id).lines).label, LABEL, 'the departure recall');

  const fiche = respond();
  db.prepare("UPDATE reservations SET complementAllocation = ? WHERE id = ?").run(JSON.stringify({ accommodation: 0, options: 0, resources: 40, tax: 2.4 }), id);
  controller.getById({ params: { id: String(id) }, user: ADMIN }, fiche);
  assert.ok(fiche.body.complementAdjustment.allocation.some((p) => p.label === LABEL), 'the ventilation of an adjusted complement');
  db.prepare('UPDATE reservations SET complementAllocation = NULL WHERE id = ?').run(id);

  const detail = reservationsModel.buildArrivalComplementDetail(id, { includeOffered: true });
  assert.equal(
    buildArrivalPaymentDetail({ ...rowOf(id), options: [], resources: [], customOptions: [] }, { buckets: ['complement'], complementDetail: detail })
      .lines.find((l) => l.kind === 'tax').label,
    LABEL,
    'the single payment that holds the complement',
  );

  const notice = (lang, complementDetail) => buildContext({
    reservation: rowOf(id), client: { firstName: 'A', lastName: 'B' }, property: { name: 'Gîte' },
    arrivalComplementDetail: complementDetail, lang,
  }).vars;
  assert.match(JSON.stringify(notice('fr', detail)), /Complément de taxe de séjour : 2,40/, 'the J-2 email');
  assert.match(JSON.stringify(notice('en', detail)), /Additional tourist tax: /, 'the J-2 email in English');
  assert.match(JSON.stringify(notice('fr', null)), /Complément de taxe de séjour : 2,40/, 'the J-2 email without the detail');
});

test('rule 23: a tax that is whole in the complement keeps its own name', async () => {
  seedHere();
  const stay = { propertyId: 3, platform: 'Canal', platformGrossAmount: 600, touristTaxInComplement: 1, ...window() };
  const id = createStay(stay);
  const saved = await save(id, { ...stay, adults: 3 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(rowOf(id).touristTaxAddedGuestsAmount, 0);
  const tax = reservationsModel.buildArrivalComplementDetail(id).detail.find((l) => l.kind === 'tax');
  assert.equal(tax.label, 'Taxe de séjour');
  assert.equal(tax.amount, 7.2);
});

test('rule 23: a single payment of solde and complement names the whole tax', () => {
  const { lines } = buildArrivalPaymentDetail(
    { balanceAmount: 600, complementAmount: 2.4, touristTaxSoldeContribTtc: 4.8, accommodationSoldeContribTtc: 595.2, startDate: inDays(10), endDate: inDays(12), options: [], resources: [], customOptions: [] },
    { buckets: ['balance', 'complement'], complementDetail: { detail: [{ kind: 'tax', label: LABEL, addedGuests: true, qty: 1, unitPrice: 2.4, amount: 2.4 }] } },
  );
  const tax = lines.find((l) => l.kind === 'tax');
  assert.equal(tax.amount, 7.2);
  assert.equal(tax.label, 'Taxe de séjour');
});

test('preview, rules 1, 2: a guest added on the live quote reads the stored paid base', async () => {
  seedHere();
  const stay = { propertyId: 3, platform: 'Canal', platformGrossAmount: 600, ...window() };
  const id = createStay(stay);
  const quote = await liveQuote(id, { ...stay, adults: 3 });
  assert.equal(quote.platformPaidAdults, 2);
  assert.equal(quote.platformPaidOccupants, 2);
  assert.equal(quote.touristTaxAddedGuestsAmount, 2.4);
  assert.equal(quote.touristTaxAddedGuestsAdults, 1);
});

test('preview, rule 7bis: on a frozen tax the live quote takes the stored addition out before adding today\'s', async () => {
  const { id, stay } = await addedGuestStay();
  mark(id, { balancePaid: true, balancePaidDate: TODAY });
  const body = { ...stay, adults: 3, balancePaid: true, balancePaidDate: TODAY };
  await save(id, body);
  assert.equal(rowOf(id).touristTaxTotal, 7.2);
  const quote = await liveQuote(id, { ...stay, adults: 3 });
  assert.equal(quote.touristTaxFrozen, true);
  assert.equal(quote.touristTaxTotal, 7.2, 'not 9,60');
  assert.equal(quote.touristTaxAddedGuestsAmount, 2.4);
});

test('save, rule 7: a collected complement keeps the amount and its adults through a save, whatever the party', async () => {
  const { id, stay } = await addedGuestStay();
  mark(id, { balancePaid: true, balancePaidDate: TODAY });
  mark(id, { complementPaid: true, complementPaidDate: TODAY });
  const larger = await save(id, { ...stay, adults: 5, complementPaid: true, balancePaid: true, balancePaidDate: TODAY, complementPaidDate: TODAY });
  assert.equal(larger.statusCode, 200, JSON.stringify(larger.body));
  assert.equal(rowOf(id).touristTaxAddedGuestsAmount, 2.4);
  assert.equal(rowOf(id).touristTaxAddedGuestsAdults, 1);
  assert.equal(quoteStoredReservation(db, rowOf(id)).touristTaxAddedGuestsAdults, 1, 'a replay of the row reads them too');
});

test('save, rule 7bis: a frozen tax does not count the addition twice from one save to the next', async () => {
  const { id, stay } = await addedGuestStay();
  mark(id, { balancePaid: true, balancePaidDate: TODAY });
  const body = { ...stay, adults: 3, balancePaid: true, balancePaidDate: TODAY };
  await save(id, body);
  const first = rowOf(id).touristTaxTotal;
  assert.equal(first, 7.2);
  await save(id, body);
  assert.equal(rowOf(id).touristTaxTotal, 7.2);
  assert.equal(rowOf(id).touristTaxAddedGuestsAmount, 2.4);
});

test('rule 1: a locked past stay can still take its brut, the paid base follows', async () => {
  seedHere();
  const id = createStay({ propertyId: 3, platform: 'Canal', ...window() });
  assert.equal(rowOf(id).platformPaidAdults, null);
  const startDate = addDaysToIsoDate(TODAY, -5);
  const endDate = addDaysToIsoDate(TODAY, -3);
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(startDate, endDate, id);
  const saved = await save(id, { propertyId: 3, platform: 'Canal', startDate, endDate, platformGrossAmount: 600 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(rowOf(id).platformPaidAdults, 2);
  assert.equal(rowOf(id).platformPaidOccupants, 2);
});

test('rule 22: the complement unticked clears the row\'s own tick, by every path: collected again, it is to declare again', async () => {
  const { id } = await addedGuestStay();
  mark(id, { balancePaid: true, balancePaidDate: TODAY });
  const finance = financeModel.buildModel(db);
  assert.equal(finance.setTouristTaxDeclared({ reservationId: id, declared: true }).ok, true);
  mark(id, { complementPaid: true, complementPaidDate: TODAY });
  assert.equal(finance.setTouristTaxDeclared({ reservationId: id, declared: true, addedGuests: true }).ok, true);
  assert.ok(rowOf(id).touristTaxAddedGuestsDeclaredAt);

  mark(id, { complementPaid: false });
  assert.equal(rowOf(id).complementPaid, 0);
  assert.equal(rowOf(id).touristTaxAddedGuestsDeclaredAt, null);

  mark(id, { complementPaid: true, complementPaidDate: TODAY });
  assert.equal(rowOf(id).touristTaxAddedGuestsDeclaredAt, null);
});
