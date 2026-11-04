// specs/platform-added-guests-tourist-tax.md rule 18 — what reads a solde from its stored money leaves
// the addition out: the stored split of a failed capture, the booked solde of a cancelled stay.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, createStay, inDays, rowOf, save, seed } = require('./ledgerFixture');
const { captureStoredSplit } = require('../utils/forceItemContribsCapture');
const { bookedStayBuckets } = require('../utils/cancelReservation');
const reservationsModel = require('../models/reservationsModel');

function addedGuestStay() {
  seed();
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests,
      extraGuestPrice, extraGuestPriceUnit, defaultCautionAmount)
    VALUES (3, 'Gîte', 8, 'per_day_per_person', 1.2, 2, 20, 'per_night', 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (3, 'Standard', 300)").run();
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Canal', 1, 0)").run();
  const stay = { propertyId: 3, platform: 'Canal', startDate: inDays(100), endDate: inDays(102), platformGrossAmount: 600 };
  const customOptions = [{ description: 'Ligne', amount: 60, inComplement: 0 }];
  const id = createStay({ ...stay, customOptions });
  const res = save(id, { ...stay, adults: 3, customOptions });
  return { id, res };
}

test('rule 18: stored split and booked solde leave out the supplement and the added tax', async () => {
  const { id, res } = addedGuestStay();
  const saved = await res;
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  const row = rowOf(id);
  assert.equal(row.touristTaxAddedGuestsAmount, 2.4);
  assert.equal(row.balanceAmount, 600);

  captureStoredSplit({ db, reservation: row, bucket: 'balance' });
  const after = rowOf(id);
  assert.equal(after.touristTaxSoldeContribTtc, 4.8);
  const line = db.prepare('SELECT soldeContribTtc AS solde FROM reservation_custom_options WHERE reservationId = ?').get(id);
  assert.equal(line.solde, 60, 'the line is whole: the supplement is not in the base it shares against');
  assert.equal(after.accommodationSoldeContribTtc, 535.2);

  const booked = bookedStayBuckets({ database: db, reservationsModel }, { ...row, balancePaid: 1 }, 10);
  assert.equal(booked.solde.touristTax, 4.8);
});
