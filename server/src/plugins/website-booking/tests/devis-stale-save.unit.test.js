// specs/reservation-fiche-concurrency.md rule 11 (audit R4-1) — the devis editor sends the `updatedAt` it
// loaded; a save built on an older version is refused (409 STALE_FICHE) instead of erasing the guest's
// new website message and clearing the « modifiée après envoi » flag.
require('./isolatedDb');
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
require('../../../utils/notificationService').notifyNewSiteDevis = async () => {};
const bookingCtl = require('../controllers/publicBookingRequestController');
const devisCtl = require('../../../controllers/devisController');

const pid = Number(db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid);
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)")
  .run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));

const call = (fn, req) => {
  const r = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; }, setHeader() {} };
  fn({ headers: {}, query: {}, params: {}, body: {}, user: { roles: ['admin'] }, ...req }, r);
  return r;
};
const guest = { firstName: 'Marie', lastName: 'Durand', email: 'g@example.fr', phone: '+33612345678' };
const baseStay = { propertyId: pid, startDate: '2027-08-10', endDate: '2027-08-11', adults: 2, guest, message: 'first ask' };

let nextDay = 10;
let nextIp = 20;
function openedDevisThenGuestWritesAgain() {
  const day = String(nextDay++).padStart(2, '0');
  const ip = `81.250.12.${nextIp}`;
  const stay = { ...baseStay, guest: { ...guest, email: `g${nextIp++}@example.fr` }, startDate: `2027-08-${day}`, endDate: `2027-08-${String(nextDay).padStart(2, '0')}` };
  nextDay += 1;
  const c = call(bookingCtl.create, { body: stay, visitor: { ip } });
  const id = c.body.data.requestId;
  db.prepare("UPDATE reservations SET devisStatus = 'sent', updatedAt = '2027-01-01 10:00:00' WHERE id = ?").run(id);
  const opened = call(devisCtl.getOne, { params: { id: String(id) } });
  const loaded = opened.body.data || opened.body;
  const again = call(bookingCtl.create, { body: { ...stay, message: 'We will arrive at 23:00, is that OK?' }, visitor: { ip } }).body.data;
  assert.equal(again.messageAdded, true);
  return { id, loaded };
}
const row = (id) => db.prepare('SELECT notes, publicUpdatedAfterSendAt, discountPercent, updatedAt FROM reservations WHERE id = ?').get(id);

test('the editor read carries the version it will send back', () => {
  const { loaded } = openedDevisThenGuestWritesAgain();
  assert.equal(loaded.updatedAt, '2027-01-01 10:00:00');
});

test('a save built before the guest wrote again is refused and writes nothing', () => {
  const { id, loaded } = openedDevisThenGuestWritesAgain();
  const before = row(id);
  assert.match(before.notes, /23:00/);
  assert.ok(before.publicUpdatedAfterSendAt);
  assert.notEqual(before.updatedAt, loaded.updatedAt);
  const put = call(devisCtl.update, { params: { id: String(id) }, body: { ...loaded, loadedUpdatedAt: loaded.updatedAt, discountPercent: 5 } });
  assert.equal(put.statusCode, 409);
  assert.equal(put.body.code, 'STALE_FICHE');
  assert.deepEqual(row(id), before);
});

test('the explicit overwrite (no version sent) is not checked', () => {
  const { id, loaded } = openedDevisThenGuestWritesAgain();
  const put = call(devisCtl.update, { params: { id: String(id) }, body: { ...loaded, discountPercent: 5 } });
  assert.equal(put.statusCode, 200);
  assert.equal(row(id).discountPercent, 5);
});

test('a save on the current version goes through and moves the version', () => {
  const id = call(bookingCtl.create, { body: { ...baseStay, guest: { ...guest, email: 'solo@example.fr' }, startDate: '2027-09-10', endDate: '2027-09-12' }, visitor: { ip: '81.250.13.1' } }).body.data.requestId;
  db.prepare("UPDATE reservations SET updatedAt = '2027-01-01 10:00:00' WHERE id = ?").run(id);
  const loaded = call(devisCtl.getOne, { params: { id: String(id) } }).body;
  const put = call(devisCtl.update, { params: { id: String(id) }, body: { ...(loaded.data || loaded), loadedUpdatedAt: '2027-01-01 10:00:00', discountPercent: 5 } });
  assert.equal(put.statusCode, 200);
  assert.notEqual(row(id).updatedAt, '2027-01-01 10:00:00');
});

test('both background writers move the version', () => {
  const { id } = openedDevisThenGuestWritesAgain();
  assert.notEqual(row(id).updatedAt, '2027-01-01 10:00:00', 'appendPublicMessage');
  db.prepare("UPDATE reservations SET updatedAt = '2027-01-01 10:00:00' WHERE id = ?").run(id);
  const devisModel = require('../../../models/devisModel');
  const res = devisModel.updateFromPublicRequest(id, { adults: 3, children: 0, teens: 0, babies: 0 }, { note: 'again' });
  assert.ok(res.ok, res.error);
  assert.notEqual(row(id).updatedAt, '2027-01-01 10:00:00', 'updateFromPublicRequest');
});
