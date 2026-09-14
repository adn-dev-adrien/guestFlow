// specs/gate-access-portier.md §3.1 — every path that makes, moves or ends a stay writes ONE outbox
// row, inside the transaction of the change itself.
//
// Each hook runs for real against an in-memory database built from schema.sql plus the outbox table.
// « Same transaction » is proven the only way it can be: a failure after the hook, inside the change,
// must take the outbox row down with the reservation change.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const Database = require('better-sqlite3');

const portierSync = require('../utils/portierSync');
const { PORTIER_OUTBOX_SQL } = require('../utils/portierSchema');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// schema.sql is the baseline; these columns arrive through database.js migrations in production.
const MIGRATED_COLUMNS = {
  reservations: ['reservationNumber TEXT', 'emailLanguage TEXT', 'complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0',
    'complementAmountOverride REAL', 'endOfStayComplementAmountOverride REAL', 'complementAllocation TEXT',
    'arrivalExtrasBaseline TEXT', 'midStaySettledNotes TEXT'],
  ical_sources: ['emptyFeedStreak INTEGER NOT NULL DEFAULT 0'],
  clients: ['emailLanguage TEXT'],
};

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  for (const [table, columns] of Object.entries(MIGRATED_COLUMNS)) {
    for (const column of columns) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  }
  db.exec(PORTIER_OUTBOX_SQL);
  db.prepare("INSERT INTO properties (id, name, defaultCheckIn, defaultCheckOut) VALUES (1, 'Gîte', '16:00', '10:00'), (2, 'Lodge', '17:00', '11:00')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Camille', 'Roux', 'camille@example.com')").run();
  return db;
}

function insertStay(db, over = {}) {
  const row = {
    kind: 'reservation', propertyId: 1, startDate: '2099-09-10', endDate: '2099-09-12',
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct', notes: '', finalPrice: 300,
    reservationNumber: '209909001', ...over,
  };
  const info = db.prepare(`
    INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, adults,
                              platform, notes, totalPrice, finalPrice, depositAmount, balanceAmount, reservationNumber)
    VALUES (@kind, @propertyId, 1, @startDate, @endDate, @checkInTime, @checkOutTime, 2,
            @platform, @notes, @finalPrice, @finalPrice, 0, @finalPrice, @reservationNumber)
  `).run(row);
  return Number(info.lastInsertRowid);
}

const outbox = (db) => db.prepare('SELECT reservationId, type, payload FROM portier_outbox ORDER BY id').all()
  .map((r) => ({ reservationId: r.reservationId, type: r.type, payload: JSON.parse(r.payload) }));

// ── portierSync itself ───────────────────────────────────────────────────────────────────────────

test('a push written inside a transaction that rolls back leaves no row', () => {
  const db = seed();
  const id = insertStay(db);
  assert.throws(() => db.transaction(() => {
    portierSync.pushStay(db, id);
    portierSync.cancelStay(db, id, 'cancelled');
    throw new Error('rollback');
  })(), /rollback/);
  assert.deepEqual(outbox(db), []);
});

test('a devis is not a stay: pushing it writes nothing', () => {
  const db = seed();
  assert.equal(portierSync.pushStay(db, insertStay(db, { kind: 'devis' })), null);
  assert.deepEqual(outbox(db), []);
});

// ── The reservation form: create, update, delete ─────────────────────────────────────────────────

function loadReservationsController(db) {
  const model = new Proxy({}, {
    get: (_, key) => {
      if (key === 'insertReservation') return (payload) => insertStay(db, { propertyId: payload.propertyId, startDate: payload.startDate, endDate: payload.endDate, checkInTime: payload.checkInTime, checkOutTime: payload.checkOutTime, reservationNumber: '209909002' });
      if (key === 'getRow' || key === 'getForUpdate') return (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
      if (key === 'updateReservation') {
        return (id, payload) => db.prepare(`UPDATE reservations SET propertyId = ?, startDate = ?, endDate = ?, checkInTime = ?, checkOutTime = ?, notes = ?, finalPrice = ? WHERE id = ?`)
          .run(payload.propertyId, payload.startDate, payload.endDate, payload.checkInTime, payload.checkOutTime, payload.notes || '', Number(payload.customPrice || 300), Number(id));
      }
      if (key === 'getForArchiveCheck') return (id) => db.prepare('SELECT id, endDate FROM reservations WHERE id = ?').get(Number(id));
      if (key === 'remove') return (id) => db.prepare('DELETE FROM reservations WHERE id = ?').run(Number(id));
      if (key === 'getPropertyCapacity') return () => ({ maxGuests: 9, maxBabies: 2, singleBeds: 9, doubleBeds: 9 });
      if (key === 'getPropertyBeds') return () => ({ singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
      if (key === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
      if (key === 'getAuditSnapshotFromDb') return () => ({ startDate: '2099-09-10' });
      if (key === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [] });
      if (key === 'totalsByReservation') return () => ({ book: 0 });
      return () => null;
    },
  });
  const mocks = {
    '../database': db,
    '../models/reservationsModel': model,
    '../utils/pricing': {
      calculateReservationQuote: () => ({
        totalPrice: 300, finalPrice: 300, depositAmount: 0, balanceAmount: 300, optionLines: [], resourceLines: [],
        nightlyBreakdown: [], depositDueDate: null, balanceDueDate: null, nights: 2, error: null,
      }),
    },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-09-14' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/settingsModel': { read: () => ({ allowEditPastReservations: 0 }), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../utils/googleCalendarSync': { schedulePush: () => null, scheduleDelete: () => null },
  };
  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    return original.call(this, id);
  };
  try {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    return require('../controllers/reservationsController');
  } finally {
    Module.prototype.require = original;
  }
}

function fakeRes() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

const FORM = {
  clientId: 1, platform: 'direct', options: [], propertyId: 1, startDate: '2099-09-10', endDate: '2099-09-12',
  checkInTime: '16:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0, notes: '',
};

test('create: the new reservation writes one stay push, with the window of gateWindow.js', () => {
  const db = seed();
  const controller = loadReservationsController(db);
  const res = fakeRes();
  controller.create({ body: { ...FORM }, user: { id: 1, roles: ['admin'] } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(outbox(db), [{
    reservationId: res.body.id,
    type: 'stay',
    payload: {
      startsAt: '2099-09-10T14:00:00.000Z', endsAt: '2099-09-12T09:00:00.000Z',
      propertyName: 'Gîte', guestFirstName: 'Camille', reservationNumber: '209909002',
    },
  }]);
});

test('create: a push that cannot be written takes the reservation down with it', () => {
  const db = seed();
  const controller = loadReservationsController(db);
  assert.equal(portierSync.__test.hasOutbox(db), true);
  db.exec('DROP TABLE portier_outbox');
  assert.throws(() => controller.create({ body: { ...FORM }, user: { id: 1, roles: ['admin'] } }, fakeRes()));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, 0);
});

test('update: new dates, new times or another lodging push again; a price or notes change does not', () => {
  const cases = [
    [{ startDate: '2099-09-11' }, 1],
    [{ checkOutTime: '12:00' }, 1],
    [{ propertyId: 2 }, 1],
    [{ notes: 'Arrivée tardive', customPrice: 420 }, 0],
  ];
  for (const [change, rows] of cases) {
    const db = seed();
    const id = insertStay(db);
    const controller = loadReservationsController(db);
    const res = fakeRes();
    controller.update({ params: { id: String(id) }, body: { ...FORM, ...change }, user: { id: 1, roles: ['admin'] } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(outbox(db).length, rows, JSON.stringify(change));
  }
});

test('delete: the reservation leaves with a cancel push, reason « deleted »', () => {
  const db = seed();
  const id = insertStay(db);
  const controller = loadReservationsController(db);
  const res = fakeRes();
  controller.remove({ params: { id: String(id) }, user: { id: 1, roles: ['admin'] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(outbox(db), [{ reservationId: id, type: 'cancel', payload: { reason: 'deleted' } }]);
});

// ── The other doors: devis, payment, cancellation, iCal ──────────────────────────────────────────

test('devis accepted: the conversion pushes the new reservation, in the conversion transaction', () => {
  const devisModel = require('../models/devisModel');
  const db = seed();
  const devisId = insertStay(db, { kind: 'devis', reservationNumber: null });
  const model = devisModel.buildModel(db);

  assert.throws(() => db.transaction(() => { model.convertToReservation(devisId); throw new Error('rollback'); })(), /rollback/);
  assert.deepEqual(outbox(db), []);

  const { data } = model.convertToReservation(devisId);
  assert.deepEqual(outbox(db).map((r) => [r.reservationId, r.type]), [[data.reservationId, 'stay']]);
});

test('payment confirmed: a paid deposit link that converts the devis pushes the stay once', async () => {
  const devisModel = require('../models/devisModel');
  const paymentLinksModel = require('../models/paymentLinksModel');
  const { processPaidLink } = require('../utils/paymentPollRunner');
  const db = seed();
  const devisId = insertStay(db, { kind: 'devis', reservationNumber: null });
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId: devisId, type: 'deposit', amountCents: 9000, qontoPaymentLinkId: 'ql_1', url: 'https://pay/ql_1', status: 'open' });

  const result = await processPaidLink({
    database: db, devisModel: devisModel.buildModel(db), paymentLinksModel: links, link,
    paidPayment: { id: 'pay_1', paid_at: '2026-09-14T10:00:00Z' }, googleCalendarSync: { schedulePush() {} },
  });
  assert.equal(result.effect, 'converted');
  assert.deepEqual(outbox(db).map((r) => [r.reservationId, r.type]), [[result.reservationId, 'stay']]);
});

function cancellationDeps(db) {
  return {
    database: db,
    reservationsModel: require('../models/reservationsModel').create(db),
    refundsModel: require('../models/refundsModel').createModel(db),
    compensationsModel: require('../models/cancellationCompensationsModel').buildModel(db),
    paymentLinksModel: require('../models/paymentLinksModel').buildModel(db),
  };
}

test('cancellation: the cancel push, reason « cancelled », lives and dies with the cancellation', () => {
  const { cancelReservation } = require('../utils/cancelReservation');
  const db = seed();
  const id = insertStay(db);

  assert.throws(() => db.transaction(() => {
    cancelReservation(cancellationDeps(db), id, { today: '2026-09-14', vatRate: 10 });
    throw new Error('rollback');
  })(), /rollback/);
  assert.deepEqual(outbox(db), []);
  assert.equal(db.prepare('SELECT kind FROM reservations WHERE id = ?').get(id).kind, 'reservation');

  const result = cancelReservation(cancellationDeps(db), id, { today: '2026-09-14', vatRate: 10 });
  assert.equal(result.ok, true);
  assert.deepEqual(outbox(db), [{ reservationId: id, type: 'cancel', payload: { reason: 'cancelled' } }]);
});

test('iCal: a date drift approved by the operator pushes the moved stay', () => {
  const db = seed();
  const id = insertStay(db, { platform: 'Airbnb' });
  const drift = require('../models/icalDateDriftModel').buildModel(db);
  drift.recordPending({ reservationId: id, previousStartDate: '2099-09-10', previousEndDate: '2099-09-12', newStartDate: '2099-09-11', newEndDate: '2099-09-13' });
  const alert = db.prepare('SELECT id FROM ical_date_drift_alerts').get();

  assert.equal(drift.approve(alert.id).ok, true);
  const [row] = outbox(db);
  assert.equal(row.type, 'stay');
  assert.equal(row.payload.startsAt, '2099-09-11T14:00:00.000Z');
});

test('iCal: an approved platform cancellation deletes the stay and pushes a cancel « deleted »', () => {
  const db = seed();
  const id = insertStay(db, { platform: 'Airbnb' });
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Airbnb', 'http://feed.test', 'airbnb', 'Airbnb')").run();
  const cancellations = require('../models/icalCancellationModel').buildModel(db);
  cancellations.recordPending({ reservationId: id, sourceId: 1, eventUid: 'E1' });
  const alert = db.prepare('SELECT id FROM ical_cancellation_alerts').get();

  assert.equal(cancellations.approve(alert.id).ok, true);
  assert.deepEqual(outbox(db), [{ reservationId: id, type: 'cancel', payload: { reason: 'deleted' } }]);
});

function icsFeed(events) {
  const lines = ['BEGIN:VCALENDAR'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, `SUMMARY:${e.summary}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function icalHarness() {
  const db = seed();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Airbnb', 'http://feed.test/ical', 'airbnb', 'Airbnb')").run();
  const model = require('../models/propertyIcalModel').buildModel(db);
  const source = { id: 1, propertyId: 1, url: 'http://feed.test/ical', platformKey: 'airbnb', platformLabel: 'Airbnb', name: 'Airbnb' };
  const feed = (events) => { global.fetch = async () => ({ ok: true, text: async () => icsFeed(events) }); };
  return { db, model, source, feed };
}

const originalFetch = global.fetch;
test.afterEach(() => { global.fetch = originalFetch; });

test('iCal import: a new stay pushes; a moved stay pushes; a guest-count-only change does not', async () => {
  const { db, model, source, feed } = icalHarness();
  feed([{ uid: 'E1', start: '20990910', end: '20990912', summary: 'Camille Roux' }]);
  await model.syncSource(source);
  assert.deepEqual(outbox(db).map((r) => r.type), ['stay']);

  feed([{ uid: 'E1', start: '20990911', end: '20990913', summary: 'Camille Roux' }]);
  await model.syncSource(source);
  assert.equal(outbox(db).length, 2);
  assert.equal(outbox(db)[1].payload.startsAt, '2099-09-11T14:00:00.000Z');

  feed([{ uid: 'E1', start: '20990911', end: '20990913', summary: 'Camille Roux (4 voyageurs)' }]);
  await model.syncSource(source);
  assert.equal(outbox(db).length, 2, 'a changed summary is not a changed stay');
});

test('iCal import: a sync that fails mid-way leaves neither the imported stay nor its push', async () => {
  const { db, model, source, feed } = icalHarness();
  db.exec("CREATE TRIGGER second_event_fails BEFORE INSERT ON ical_import_events WHEN NEW.eventUid = 'E2' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  feed([
    { uid: 'E1', start: '20990910', end: '20990912', summary: 'Camille Roux' },
    { uid: 'E2', start: '20990920', end: '20990922', summary: 'Léa Martin' },
  ]);
  await assert.rejects(model.syncSource(source));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, 0);
  assert.deepEqual(outbox(db), []);
});
