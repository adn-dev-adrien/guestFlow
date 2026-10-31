// specs/payment-link-lifecycle.md rule 32 (review of #907, M1) — withdrawing the links of a stay whose nights were
// taken is a side concern: a throw there never rolls back the iCal import (the over-booking record GuestFlow exists
// to keep) nor turns a successful creation or save into a 500. It is logged and left to the lifecycle pass (rule 16).
// Re-review of #907 (N1): an error that made SQLite abort the caller's whole transaction (disk full, I/O) is not
// swallowed — the caller must not go on in autocommit and commit half a sync.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf, bookingFeed } = require('./datesTakenFixture');
const lifecycle = require('../utils/paymentLinkLifecycle');
const { retireLapsedAndWithdrawn } = lifecycle;

function breakWithdrawal(t) {
  const real = lifecycle.withdrawLinksOverlapping;
  const warned = [];
  const warn = console.warn;
  lifecycle.withdrawLinksOverlapping = () => { throw new Error('schema surprise'); };
  console.warn = (...args) => { warned.push(args.join(' ')); };
  t.after(() => { lifecycle.withdrawLinksOverlapping = real; console.warn = warn; });
  return warned;
}

test('rule 32: a failing withdrawal never loses the iCal booking; the pass withdraws the link later', async (t) => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(40), end: inDays(44) });
  const link = addLink(devisId);
  const warned = breakWithdrawal(t);
  const result = await bookingFeed(propertyId).sync([{ uid: 'm1@booking', start: inDays(41), end: inDays(43) }]);
  assert.equal(result.createdReservationIds.length, 1, 'the platform booking is recorded');
  assert.ok(db.prepare('SELECT 1 FROM ical_import_events WHERE eventUid = ?').get('m1@booking'), 'its mapping is kept');
  assert.equal(linkOf(link).status, 'open');
  assert.ok(warned.some((l) => l.includes('dates-taken withdrawal') && l.includes('schema surprise')), warned.join('\n'));
});

test('rule 32: a failing withdrawal after a manual creation still answers the created stay', async (t) => {
  const propertyId = freshProperty();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (?, 'Standard', 100)").run(propertyId);
  breakWithdrawal(t);
  const controller = require('../controllers/reservationsController');
  const created = await new Promise((resolve) => {
    controller.create({ body: {
      propertyId, clientId: 1, startDate: inDays(60), endDate: inDays(62), checkInTime: '16:00', checkOutTime: '10:00', platform: 'Booking',
      adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1, options: [],
    }, user: { role: 'admin' } }, { status() { return this; }, json: resolve });
  });
  assert.ok(created.id, JSON.stringify(created));
});

test('rule 16: the lifecycle pass is the safety net for a withdrawal that never ran', () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(80), end: inDays(83) });
  const link = addLink(devisId);
  addStay({ propertyId, platform: 'Booking', start: inDays(81), end: inDays(82) });
  retireLapsedAndWithdrawn(db, { now: new Date() });
  assert.equal(linkOf(link).cancelReason, 'dates-taken');
});

test('rule 32 (N1): an error that aborted the caller transaction propagates; the caller writes nothing, before or after', (t) => {
  const { seedDb, addStay: addFixtureStay } = require('./paymentLinkLifecycleFixture');
  const { withdrawForStay } = require('../utils/datesTaken');
  const { db: own } = seedDb();
  const stay = addFixtureStay(own, { startDate: inDays(90), endDate: inDays(92) });
  own.exec('CREATE TABLE probe (x)');
  const real = lifecycle.withdrawLinksOverlapping;
  lifecycle.withdrawLinksOverlapping = (database) => { database.prepare('INSERT INTO probe VALUES (randomblob(200000))').run(); return []; };
  t.after(() => { lifecycle.withdrawLinksOverlapping = real; });
  const pages = own.pragma('page_count', { simple: true });
  own.pragma(`max_page_count = ${pages + 2}`);
  assert.throws(() => own.transaction(() => {
    own.prepare("INSERT INTO probe VALUES ('before')").run();
    withdrawForStay(own, stay, { deactivate: null });
    own.prepare("INSERT INTO probe VALUES ('after')").run();
  })(), /full/i);
  own.pragma(`max_page_count = ${pages + 1000}`);
  assert.deepEqual(own.prepare("SELECT x FROM probe WHERE typeof(x) = 'text'").all(), [], 'neither outer write survives');
});
