// specs/deposit-blocks-the-dates.md rule 24 (audit R35-RES-L1). The promise a converted stay keeps (rule 22) is the
// promise of a DIRECT devis: an OTA devis never had an acompte to lose and promised the solde on rule 7's stay-relative
// date. A stay converted from an OTA devis and then switched to a direct channel used to take the OTA devis's stored
// acompte 0 as a direct promise: its solde jumped to the devis's validity date, months before an identical direct stay.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const f = require('./ledgerFixture');
const devisModel = require('../models/devisModel');

const { db, inDays } = f;
f.seed();
db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled,
    depositPercent, defaultCautionAmount, balanceDaysBefore)
  VALUES (3, 'Cabane', 8, 'per_day_per_person', 1.2, 0, 30, 0, 30)`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (3, 'Standard', 100)").run();
db.prepare('UPDATE app_settings SET quoteValidityDays = 15 WHERE id = 1').run();

const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
const pick = (r) => ({ depositAmount: Number(r.depositAmount || 0), balanceDueDate: r.balanceDueDate || null });

function convert(startIn, platform) {
  const id = devisModel.create(f.stayBody({ propertyId: 3, platform, startDate: inDays(startIn), endDate: inDays(startIn + 2) })).data.id;
  const devis = rowOf(id);
  const converted = devisModel.convertToReservation(id);
  assert.ok(converted.ok, JSON.stringify(converted));
  return { devis, rid: converted.data.reservationId };
}

test('R35-RES-L1 — an OTA devis converted then switched to direct takes the direct rule, not the devis validity date', async () => {
  const { devis, rid } = convert(130, 'booking');
  assert.deepEqual(pick(devis), { depositAmount: 0, balanceDueDate: inDays(100) }, 'an OTA devis: rule 7 stay-relative date');
  assert.deepEqual(pick(rowOf(rid)), { depositAmount: 0, balanceDueDate: inDays(100) }, 'its conversion');
  const fresh = await f.liveQuote(null, { propertyId: 3, startDate: inDays(130), endDate: inDays(132) });
  assert.equal(fresh.balanceDueDate, inDays(100), 'a direct stay on the same dates');
  const live = await f.liveQuote(rid, { platform: 'direct' });
  assert.equal(live.balanceDueDate, inDays(100), 'the live quote once switched to direct');
  assert.notEqual(live.balanceDueDate, devis.validUntil);
  const saved = await f.save(rid, { platform: 'direct', adults: 3 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(rowOf(rid).balanceDueDate, inDays(100), 'the save once switched to direct');
});

test('R35-RES-L1 — a direct devis still hands its promise to the stay (rule 22 unchanged)', async () => {
  const { devis, rid } = convert(140, 'direct');
  assert.equal(devis.balanceDueDate, devis.validUntil);
  const saved = await f.save(rid, { adults: 3 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(rowOf(rid).balanceDueDate, devis.validUntil);
});
