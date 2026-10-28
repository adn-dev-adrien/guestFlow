// specs/calendar-property-parity.md rules 22-24 — the stays the removed « platform disabled » filter used to
// hide are not all duplicates. The one-shot migration sets aside only the true copies (a hidden stay
// overlapping a visible stay of the same logement, carrying no money), audits it, and the other hidden
// stays simply reappear. A stay set aside leaves every read, the iCal sync never resurrects it, and
// « Rétablir » undoes it when its dates are still free.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const calendarModel = require('../models/calendarModel');
const reservationsModel = require('../models/reservationsModel');
const propertyIcalModel = require('../models/propertyIcalModel');
const accountingModelFactory = require('../plugins/accounting-export/accountingModel');
const reservationsController = require('../controllers/reservationsController');
const { findCandidates, setAsideDuplicates, REASON } = require('../utils/supersededDuplicates');

function stay(id, propertyId, startDate, endDate, { platform = 'direct', balancePaid = 0 } = {}) {
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, finalPrice, totalPrice, balancePaid, reservationNumber)
              VALUES (?, 'reservation', 1, ?, ?, ?, ?, 2, 300, 300, ?, ?)`).run(id, propertyId, startDate, endDate, platform, balancePaid, `2026${String(id).padStart(5, '0')}`);
  return id;
}
const kindOf = (id) => db.prepare('SELECT kind FROM reservations WHERE id = ?').get(id).kind;
const historyOf = (id) => db.prepare('SELECT eventType, changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id').all(id);
const ids = (list) => list.map((s) => s.id).sort((a, b) => a - b);
const rm = reservationsModel.create(db);

function fakeRes() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
const restore = (id, user = { id: 1, email: 'admin@example.com', roles: ['admin'] }) => {
  const res = fakeRes();
  reservationsController.restoreSuperseded({ params: { id: String(id) }, user }, res);
  return res;
};

db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Granja')").run();
db.prepare("INSERT INTO properties (id, name) VALUES (2, 'Estiva')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Martin')").run();
// Lodgify is disabled for both logements: the old filter hid its stays from their calendars.
db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive, disabled) VALUES (1, 'Lodgify', '', 'lodgify', 'Lodgify', 0, 1)").run();
db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive, disabled) VALUES (2, 'Lodgify', '', 'lodgify', 'Lodgify', 0, 1)").run();

// Prod-shaped: one true duplicate on a direct stay, nine isolated past stays.
stay(14, 1, '2026-04-13', '2026-04-16', { platform: 'direct' });
stay(22279, 1, '2026-04-13', '2026-04-17', { platform: 'Lodgify' });
const ISOLATED = [22201, 22224, 22226, 22227, 22229, 22242, 22269, 22271, 22272];
ISOLATED.forEach((id, i) => stay(id, 1, `2026-0${1 + (i % 3)}-${String(2 + i * 3).padStart(2, '0')}`, `2026-0${1 + (i % 3)}-${String(4 + i * 3).padStart(2, '0')}`, { platform: 'Lodgify' }));
// Estiva: three direct stays, no hidden one.
stay(30, 2, '2026-05-01', '2026-05-04');
stay(31, 2, '2026-05-10', '2026-05-12');
stay(32, 2, '2026-06-01', '2026-06-03');

const allSet = (propertyId) => ids(calendarModel.listRange({ from: '2026-01-01', to: '2026-12-31', propertyId }).stays);

test('rule 23 — the old filter hides 10 Granja stays; only the one overlapping a visible stay is a duplicate', () => {
  const found = findCandidates(db);
  assert.deepEqual(found.superseded, [{ id: 22279, byReservationId: 14 }]);
  assert.deepEqual(found.keptVisible.sort((a, b) => a - b), ISOLATED);
  assert.deepEqual(found.skippedPaid, []);
});

test('rule 23-24 — the migration sets the duplicate aside, names its keeper, and audits it', () => {
  const before = { granja: allSet(1), all: ids(calendarModel.listRange({ from: '2026-01-01', to: '2026-12-31' }).stays) };
  assert.equal(before.granja.length, 11, 'the new calendar already shows everything, the duplicate included');
  const found = setAsideDuplicates(db);
  assert.deepEqual(found.superseded.map((s) => s.id), [22279]);
  const row = db.prepare('SELECT kind, supersededByReservationId, supersededReason, supersededAt FROM reservations WHERE id = 22279').get();
  assert.equal(row.kind, 'superseded');
  assert.equal(row.supersededByReservationId, 14);
  assert.equal(row.supersededReason, REASON);
  assert.ok(row.supersededAt);
  const [event] = historyOf(22279);
  assert.equal(event.eventType, 'superseded');
  const fields = JSON.parse(event.changedFields);
  assert.deepEqual(fields.map((f) => f.field), ['kind', 'supersededByReservationId', 'supersededReason', 'actor']);
  assert.equal(fields.find((f) => f.field === 'actor').toText, 'migration');
  assert.match(fields.find((f) => f.field === 'supersededByReservationId').toText, /202600014/);
});

test('rule 23 — prod-shaped fixture: every calendar shows today\'s set plus the isolated stays, minus the duplicate', () => {
  assert.deepEqual(allSet(1), [14, ...ISOLATED].sort((a, b) => a - b), 'Granja: the direct stay + the 9 isolated, not 22279');
  assert.deepEqual(allSet(2), [30, 31, 32]);
  const general = ids(calendarModel.listRange({ from: '2026-01-01', to: '2026-12-31' }).stays);
  assert.deepEqual(general, [...allSet(1), ...allSet(2)].sort((a, b) => a - b), 'both calendars agree');
});

test('rule 23 — a second boot changes nothing', () => {
  const again = setAsideDuplicates(db);
  assert.deepEqual(again.superseded, []);
  assert.equal(historyOf(22279).length, 1, 'no second audit entry');
  assert.ok(db.prepare("SELECT 1 FROM migrations WHERE name = 'calendar_parity_superseded_v1'").get(), 'the boot recorded the migration');
});

test('rule 23 — a hidden duplicate carrying money is left untouched and reported', () => {
  stay(40, 2, '2026-08-05', '2026-08-08', { platform: 'direct' });
  stay(41, 2, '2026-08-06', '2026-08-09', { platform: 'Lodgify', balancePaid: 1 });
  const found = setAsideDuplicates(db);
  assert.deepEqual(found.skippedPaid, [41]);
  assert.equal(kindOf(41), 'reservation');
});

test('rule 23 — a paid payment link or a paid installment also counts as money', () => {
  const keeper = stay(50, 2, '2026-09-05', '2026-09-08', { platform: 'direct' });
  const withLink = stay(51, 2, '2026-09-06', '2026-09-09', { platform: 'Lodgify' });
  const withInstallment = stay(52, 2, '2026-09-04', '2026-09-07', { platform: 'Lodgify' });
  db.prepare("INSERT INTO payment_links (reservationId, type, url, status, paidAt) VALUES (?, 'balance', 'x', 'paid', '2026-08-01')").run(withLink);
  db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid) VALUES (?, 1, ?, 1000, 1)').run(withInstallment, '2026-08-01');
  const found = findCandidates(db);
  assert.ok(found.skippedPaid.includes(withLink));
  assert.ok(found.skippedPaid.includes(withInstallment));
  assert.ok(!found.superseded.some((s) => s.byReservationId === keeper && (s.id === withLink || s.id === withInstallment)));
});

test('rule 23 — a hidden stay overlapping only hidden stays is not superseded; the keeper is the earliest overlap', () => {
  stay(60, 1, '2026-11-01', '2026-11-06', { platform: 'Lodgify' });
  stay(61, 1, '2026-11-04', '2026-11-08', { platform: 'Lodgify' });
  stay(70, 1, '2026-12-01', '2026-12-10', { platform: 'Lodgify' });
  stay(72, 1, '2026-12-05', '2026-12-07', { platform: 'direct' });
  stay(71, 1, '2026-12-02', '2026-12-04', { platform: 'direct' });
  const found = findCandidates(db);
  assert.ok(found.keptVisible.includes(60) && found.keptVisible.includes(61), 'nothing visible proves they are copies');
  assert.deepEqual(found.superseded.find((s) => s.id === 70), { id: 70, byReservationId: 71 }, 'earliest by arrival date, not by id');
});

test('rule 22 — a stay set aside is absent from the calendar, the lists, the availability and the books; search flags it', () => {
  assert.ok(!allSet(1).includes(22279));
  assert.ok(!rm.list({ propertyId: 1 }).some((r) => r.id === 22279));
  assert.equal(rm.validateAvailability(1, '2027-04-16', '2027-04-17', '15:00', '10:00', null), null, 'a free night is free');
  assert.equal(rm.getOccupiedReservations(1, '2026-04-01', '2026-04-30').some((r) => r.id === 22279), false);
  const found = rm.search({ q: 'Camille' });
  assert.equal(found.find((r) => r.id === 22279).superseded, true);
  assert.equal(found.find((r) => r.id === 14).superseded, false);
  db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2026-05-10', depositAmount = 100 WHERE id = 22279").run();
  const accounting = accountingModelFactory.create(db);
  assert.equal(accounting.encaissementsByMonth({ month: 5, year: 2026 }).filter((e) => e.reservationId === 22279 || e.id === 22279).length, 0, 'the books skip it');
  db.prepare("UPDATE reservations SET kind = 'reservation' WHERE id = 22279").run();
  assert.ok(accounting.encaissementsByMonth({ month: 5, year: 2026 }).length > 0, 'the same row as a reservation would be booked');
  db.prepare("UPDATE reservations SET kind = 'superseded', depositPaid = 0, depositPaidDate = NULL, depositAmount = 0 WHERE id = 22279").run();
});

test('rule 22 — the fiche of a stay set aside opens with the number of its keeper, and refuses writes', () => {
  const fiche = rm.getByIdWithDetails(22279);
  assert.equal(fiche.kind, 'superseded');
  assert.equal(fiche.supersededByReservationId, 14);
  assert.equal(fiche.supersededByReservationNumber, '202600014');
  assert.equal(rm.getByIdWithDetails(14).supersededByReservationNumber, undefined);
});

test('rule 22-24 — « Rétablir » restores it with an audit entry; 409 when its dates were booked since', () => {
  const taken = restore(22279);
  assert.equal(taken.statusCode, 409, 'reservation 14 still holds the dates');
  assert.equal(taken.body.error, 'Ces dates sont déjà prises.');
  assert.equal(kindOf(22279), 'superseded', 'the stay stays set aside');

  db.prepare('DELETE FROM reservations WHERE id = 14').run();
  const ok = restore(22279);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(kindOf(22279), 'reservation');
  assert.equal(db.prepare('SELECT supersededByReservationId s FROM reservations WHERE id = 22279').get().s, null);
  const events = historyOf(22279).map((e) => e.eventType);
  assert.deepEqual(events, ['superseded', 'unsuperseded']);
  const fields = JSON.parse(historyOf(22279)[1].changedFields);
  assert.equal(fields.find((f) => f.field === 'actor').toText, 'admin@example.com');
  assert.equal(restore(22279).statusCode, 400, 'a plain reservation is not restorable');
  assert.equal(restore(999999).statusCode, 404);
});

test('rule 22 — the iCal sync never updates, re-imports nor resurrects a stay set aside', async () => {
  const origFetch = global.fetch;
  const feed = (start, end, uid = 'L1') => {
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, 'SUMMARY:Jean Dupont', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    global.fetch = async () => ({ ok: true, status: 200, text: async () => ics });
  };
  try {
    const propertyId = Number(db.prepare("INSERT INTO properties (name, defaultCheckIn, defaultCheckOut) VALUES ('Tente', '16:00', '10:00')").run().lastInsertRowid);
    const sourceId = db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive) VALUES (?, 'Greengo', 'http://x.test/f.ics', 'greengo', 'Greengo', 1)").run(propertyId).lastInsertRowid;
    const source = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(sourceId);
    feed('20271105', '20271110');
    await propertyIcalModel.syncSourceAndRecord(source);
    const id = db.prepare('SELECT id FROM reservations WHERE propertyId = ?').get(propertyId).id;
    db.prepare("UPDATE reservations SET kind = 'superseded' WHERE id = ?").run(id);
    const dates = () => db.prepare('SELECT startDate, endDate, kind FROM reservations WHERE propertyId = ?').all(propertyId);

    feed('20271106', '20271112');
    const moved = await propertyIcalModel.syncSourceAndRecord(source);
    assert.equal(moved.updatedCount, 0);
    assert.equal(moved.createdCount, 0);
    assert.deepEqual(dates(), [{ startDate: '2027-11-05', endDate: '2027-11-10', kind: 'superseded' }], 'untouched, no copy');

    db.prepare('DELETE FROM ical_import_events WHERE reservationId = ?').run(id);
    const lost = await propertyIcalModel.syncSourceAndRecord(source);
    assert.equal(lost.createdCount, 0, 'with the mapping memory lost, the UID still finds the row');
    assert.equal(dates().length, 1);

    feed('20271201', '20271203', 'OTHER');
    const dropped = await propertyIcalModel.syncSourceAndRecord(source);
    assert.equal(dropped.removedCount, 0, 'leaving the feed raises no cancellation alert');
    assert.equal(kindOf(id), 'superseded');
  } finally {
    global.fetch = origFetch;
  }
});
