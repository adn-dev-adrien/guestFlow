// specs/booking-extranet-intake.md rules 33–34 (audit 2026-10-28, F6 and F8) — the fiche a Booking page fills
// is the one Booking could have created (not cancelled, Booking's canal), several candidates are refused, and
// the e-mail read on the page is one address.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { findFiches } = require('../ficheFinder');
const { parseBookingPage } = require('../pageParser');
const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { PAGE_6300000001, replaceOnce } = require('./fixtures');

function fiches(rows) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT, cancelledAt TEXT)');
  const insert = db.prepare('INSERT INTO reservations (id, kind, propertyId, startDate, endDate, platform, cancelledAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
  rows.forEach((r) => insert.run(r.id, r.kind || 'reservation', r.propertyId || 1, r.startDate || '2026-11-06', r.endDate || '2026-11-08', r.platform === undefined ? 'Booking.com' : r.platform, r.cancelledAt || null));
  return findFiches(db)({ propertyId: 1, startDate: '2026-11-06', endDate: '2026-11-08' }).map((r) => r.id);
}

test('rule 33: a cancelled fiche is never a candidate', () => {
  assert.deepEqual(fiches([{ id: 1, cancelledAt: '2026-10-10T10:00:00Z' }, { id: 2 }]), [2]);
  assert.deepEqual(fiches([{ id: 1, cancelledAt: '2026-10-10T10:00:00Z' }]), []);
});

test('rule 33: only Booking’s canal (or Lodgify’s feed, or none) is a candidate, never another platform’s fiche', () => {
  assert.deepEqual(fiches([{ id: 1, platform: 'Airbnb' }, { id: 2, platform: 'Gîtes de France' }, { id: 3, platform: 'Booking' }, { id: 4, platform: 'Lodgify' }, { id: 5, platform: null }, { id: 6, platform: 'Direct' }]), [3, 4, 5]);
  assert.deepEqual(fiches([{ id: 1, kind: 'devis' }]), []);
});

test('rule 33: several candidates are refused, nothing is written', () => {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const writes = [];
  const service = createIntakeService({
    intakes: buildModel(db),
    hotelIds: () => ({ 1: '14407976' }),
    today: () => '2026-10-16',
    now: () => new Date(2026, 9, 15, 15, 52),
    findReservations: () => [{ id: 1 }, { id: 2 }],
    getReservation: () => { throw new Error('must not be read'); },
    clientShared: () => false,
    core: { updateReservation: (...a) => { writes.push(a); return { status: 200 }; }, updateClient: () => {}, suggestBeds: () => ({}), platformCommission: () => 0, withholdsTouristTax: () => true },
  });
  const r = service.handlePage({ hotelId: '14407976', resId: '6300000001', text: PAGE_6300000001 });
  assert.equal(r.status, 'refused');
  assert.equal(r.code, 'AMBIGUOUS_FICHE');
  assert.match(r.message, /Plusieurs fiches Booking/);
  assert.deepEqual(writes, []);
});

test('rule 34: the e-mail of the page is one address — a list or an angle address is not read', () => {
  const email = (line) => parseBookingPage(replaceOnce(PAGE_6300000001, 'cgarnier.123456@guest.booking.com', line), { resId: '6300000001' });
  assert.equal(email('cgarnier.123456@guest.booking.com').booking.guest.email, 'cgarnier.123456@guest.booking.com');
  for (const bad of ['a@x.test,b@evil.test', 'a@x.test;b@evil.test', '<a@x.test>']) {
    const r = email(bad);
    assert.notEqual(r.ok && r.booking.guest.email, bad, bad);
  }
});
