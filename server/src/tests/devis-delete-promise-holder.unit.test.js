// specs/deposit-blocks-the-dates.md rule 26 (audit R36-RES-L2) — rule 21's refusal protects a promise the stay reads: only
// a converted devis that made one is refused deletion while its stay lives. A direct devis owing one payment (rules 22, 24,
// D27) stays refused; an OTA devis (rule 24: its acompte 0 is no promise) and a direct devis converted with an acompte
// outside the window (rule 22: the stay takes the reservation rules) hold nothing, and are deleted, the stay untouched.
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
const schedule = (r) => [Number(r.depositAmount || 0), r.balanceDueDate || null];

function convert(startIn, propertyId, platform) {
  const body = f.stayBody({ propertyId, startDate: inDays(startIn), endDate: inDays(startIn + 2), ...(platform ? { platform } : {}) });
  const id = devisModel.create(body).data.id;
  const converted = devisModel.convertToReservation(id);
  assert.ok(converted.ok, JSON.stringify(converted));
  return { id, rid: converted.data.reservationId };
}

test('rule 26 — an OTA devis converted holds no promise: deleted, its stay keeps its schedule', () => {
  const { id, rid } = convert(130, 3, 'booking');
  const before = schedule(rowOf(rid));
  const res = devisModel.remove(id);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(rowOf(id), undefined);
  assert.deepEqual(schedule(rowOf(rid)), before);
});

test('rule 26 — a direct devis converted with an acompte outside the window holds no promise: deleted', () => {
  const { id, rid } = convert(100, 1);
  assert.ok(rowOf(id).depositAmount > 0);
  assert.equal(devisModel.remove(id).ok, true);
  assert.ok(rowOf(rid));
});

test('rule 26 — D27 kept: a direct devis owing one payment stays refused while its stay lives, in and out of the window', () => {
  for (const [startIn, propertyId] of [[35, 1], [100, 3]]) {
    const { id } = convert(startIn, propertyId);
    const res = devisModel.remove(id);
    assert.equal(res.status, 409, `${startIn} days, logement ${propertyId}`);
    assert.equal(res.code, 'DEVIS_HOLDS_PROMISE');
    assert.ok(rowOf(id));
  }
});

// Verification R36b L1 — the holder reads the STAY's logement delay, the engine's own input (one helper,
// `paymentSchedule.devisPromiseHeld`): a direct devis with an acompte, converted, its stay moved to a logement whose
// « Solde dû » puts the devis's solde on or before its validity date. The engine then reads the single payment.
test('rule 26 — the stay moved to a logement with a longer delay reads the promise: the devis stays refused', async () => {
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled,
      depositPercent, defaultCautionAmount, balanceDaysBefore)
    VALUES (4, 'Roulotte', 8, 'per_day_per_person', 1.2, 1, 30, 0, 165)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (4, 'Standard', 100)").run();
  const { id, rid } = convert(170, 1);
  const devis = rowOf(id);
  assert.ok(devis.depositAmount > 0);
  const moved = await f.save(rid, { propertyId: 4 });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  assert.deepEqual(schedule(rowOf(rid)), [0, devis.validUntil], 'the engine reads the devis as a single-payment promise');
  const res = devisModel.remove(id);
  assert.equal(res.status, 409, JSON.stringify(res));
  assert.equal(res.code, 'DEVIS_HOLDS_PROMISE');
  assert.ok(rowOf(id));
  const back = await f.save(rid, { propertyId: 1 });
  assert.equal(back.statusCode, 200, JSON.stringify(back.body));
  assert.ok(rowOf(rid).depositAmount > 0, 'back on its logement the stay takes the reservation rules');
  assert.equal(devisModel.remove(id).ok, true);
});
