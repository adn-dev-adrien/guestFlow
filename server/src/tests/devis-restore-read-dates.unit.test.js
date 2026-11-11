// specs/deposit-blocks-the-dates.md rule 25 (audits R33b L1, L2). Rule 20 re-stored an open devis only when D23 read it as
// one payment; two more disagreements between the columns and the read were left:
// - L1: outside the window, a change of « Solde dû … jours avant » moved the read's solde date (fiche, PDF, link quote)
//   while the columns kept the save-time date (e-mail tokens, conversion): two dates for one devis.
// - L2: a legacy devis stored without a validity date was read on its backfill, while the conversion and the converted
//   stay's promise read the raw NULL: the stay re-split into an acompte, or owed a payment in the past.
// The re-store now writes any open devis whose columns differ from its read, and stamps a missing validity date.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const f = require('./ledgerFixture');
const devisModel = require('../models/devisModel');
const propertiesModel = require('../models/propertiesModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const { buildContext } = require('../utils/emailContextBuilder');
const { todayIso } = require('../utils/localDate');

const { db, inDays } = f;
f.seed();
db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled,
    depositPercent, defaultCautionAmount, balanceDaysBefore)
  VALUES (3, 'Cabane', 8, 'per_day_per_person', 1.2, 0, 30, 0, 30)`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (3, 'Standard', 100)").run();
db.prepare('UPDATE app_settings SET quoteValidityDays = 15 WHERE id = 1').run();
const links = paymentLinksModel.buildModel(db);

const pick = (r) => ({
  depositAmount: Number(r.depositAmount || 0),
  depositDueDate: r.depositDueDate || null,
  balanceAmount: Number(r.balanceAmount || 0),
  balanceDueDate: r.balanceDueDate || null,
});
const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
const create = (startIn, { propertyId = 1, platform = 'direct' } = {}) => devisModel.create(f.stayBody({
  propertyId, platform, startDate: inDays(startIn), endDate: inDays(startIn + 2),
})).data.id;
const setBalanceDays = (days, id = 1) => propertiesModel.update(id, { balanceDaysBefore: days });

test.beforeEach(() => {
  setBalanceDays(30, 1);
  setBalanceDays(30, 3);
  db.prepare("DELETE FROM reservation_nights WHERE reservationId IN (SELECT id FROM reservations WHERE kind != 'devis')").run();
  db.prepare("DELETE FROM reservations WHERE kind != 'devis'").run();
  db.prepare("UPDATE reservations SET devisStatus = 'converted', convertedReservationId = -1 WHERE kind = 'devis'").run();
});

test('R33b L1 — outside the window, a delay change moves the columns with the read; the acompte and its link stay', () => {
  const id = create(100);
  const devis = rowOf(id);
  assert.ok(devis.depositAmount > 0, 'outside the window with the acompte on');
  assert.equal(devis.balanceDueDate, inDays(70));
  const link = links.create({
    reservationId: id, type: 'deposit', amountCents: Math.round(devis.depositAmount * 100), provider: 'qonto',
    providerLinkId: `L${id}`, url: 'https://pay.example.test/l', status: 'open',
    expiresAt: new Date(Date.now() + 30 * 3600 * 1000).toISOString(),
  });

  setBalanceDays(40);
  const row = rowOf(id);
  assert.equal(row.balanceDueDate, inDays(60), 'the columns follow the delay');
  assert.deepEqual(pick(row), pick(devisModel.findById(id)), 'columns = fiche / PDF read');
  assert.equal(row.depositAmount, devis.depositAmount);
  assert.equal(row.balanceAmount, devis.balanceAmount);
  assert.equal(links.findById(link.id).status, 'open', 'same amounts: no link withdrawn');
  const mail = buildContext({ reservation: row, client: {}, property: {} });
  assert.equal(mail.vars.balanceDueDate, buildContext({ reservation: { balanceDueDate: inDays(60) }, client: {}, property: {} }).vars.balanceDueDate);

  const converted = devisModel.convertToReservation(id);
  assert.ok(converted.ok, JSON.stringify(converted));
  assert.equal(rowOf(converted.data.reservationId).balanceDueDate, inDays(60), 'the conversion reads the same date');
  assert.deepEqual(devisModel.restoreSinglePayments(), [], 'idempotent');
});

test('R33b L1 — a direct devis with no acompte keeps its validity deadline whatever the delay', () => {
  const id = create(100, { propertyId: 3 });
  const before = pick(rowOf(id));
  assert.equal(before.balanceDueDate, rowOf(id).validUntil);
  setBalanceDays(40, 3);
  assert.deepEqual(pick(rowOf(id)), before);
});

test('R33b L1 — devis the engine stored are never re-written by the re-store (no boot noise)', () => {
  const ids = [];
  for (const startIn of [3, 20, 35, 44, 45, 46, 61, 90, 200]) {
    for (const [propertyId, platform] of [[1, 'direct'], [1, 'booking'], [3, 'direct'], [3, 'booking']]) {
      const created = devisModel.create(f.stayBody({
        propertyId, platform, startDate: inDays(startIn + ids.length * 3), endDate: inDays(startIn + ids.length * 3 + 2),
      }));
      assert.ok(created.ok, JSON.stringify(created));
      ids.push(created.data.id);
    }
  }
  assert.deepEqual(devisModel.restoreSinglePayments(), []);
});

test('R33b L2 — a legacy devis with no validity date is stamped at the re-store; its stay keeps the single payment', async () => {
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, totalPrice,
      finalPrice, depositAmount, depositDueDate, balanceAmount, balanceDueDate, devisStatus, validUntil, createdAt, platform,
      checkInTime, checkOutTime)
    VALUES ('devis', 1, 1, ?, ?, 2, 200, 200, 60, NULL, 140, ?, 'draft', NULL, datetime('now', 'localtime', 'start of day', '-5 days', '+12 hours', 'utc'), 'direct', '16:00', '10:00')`)
    .run(inDays(40), inDays(42), inDays(10)).lastInsertRowid);
  const read = devisModel.findById(id);
  assert.equal(read.validUntil, inDays(10), 'its backfill: created 5 days ago + 15');
  assert.ok(devisModel.restoreSinglePayments().includes(id));
  const row = rowOf(id);
  assert.equal(row.validUntil, inDays(10), 'the date the fiche showed is stored');
  assert.deepEqual(pick(row), { depositAmount: 0, depositDueDate: null, balanceAmount: 200, balanceDueDate: inDays(10) });

  // « Validité des devis » moved: the stored date no longer follows the setting.
  db.prepare('UPDATE app_settings SET quoteValidityDays = 5 WHERE id = 1').run();
  assert.equal(devisModel.findById(id).validUntil, inDays(10));
  db.prepare('UPDATE app_settings SET quoteValidityDays = 15 WHERE id = 1').run();

  const rid = devisModel.convertToReservation(id).data.reservationId;
  assert.deepEqual(pick(rowOf(rid)), { depositAmount: 0, depositDueDate: null, balanceAmount: 200, balanceDueDate: inDays(10) });
  const live = await f.liveQuote(rid);
  assert.equal(Number(live.depositAmount), 0, 'the converted stay does not re-split');
  assert.equal(live.balanceDueDate, inDays(10));
});

test('R33b L2 — an expired legacy devis with no validity date converts due today, never in the past', () => {
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, totalPrice,
      finalPrice, depositAmount, depositDueDate, balanceAmount, balanceDueDate, devisStatus, validUntil, createdAt, platform,
      checkInTime, checkOutTime)
    VALUES ('devis', 3, 1, ?, ?, 2, 200, 200, 0, NULL, 200, ?, 'draft', NULL, datetime('now', 'localtime', 'start of day', '-25 days', '+12 hours', 'utc'), 'direct', '16:00', '10:00')`)
    .run(inDays(20), inDays(22), inDays(-10)).lastInsertRowid);
  devisModel.restoreSinglePayments();
  assert.equal(rowOf(id).validUntil, inDays(-10));
  const rid = devisModel.convertToReservation(id).data.reservationId;
  assert.equal(rowOf(rid).balanceDueDate, todayIso());
});
