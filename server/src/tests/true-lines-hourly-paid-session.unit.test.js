// specs/pricing-components.md §3 rule 85 (owner Q-C7) — a session added to an hourly line that is already PAID becomes a NEW line (the paid line
// keeps what it was sold with); added to an unpaid line, it stays on that line. Nothing is moved when no session is new.
const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();
const { db, stayWithTwoSales } = require('./trueLinesFixture');
const { splitPaidLineSessions } = require('../utils/paidLineSessions');
const controller = require('../controllers/reservationsController');
const { storedBody } = require('../utils/midStayOrderCommit');

const resourceId = Number(db.prepare("INSERT INTO resources (name, priceType, price, showsPlanningCard, quantity, propertyId) VALUES ('Bain', 'per_hour', 40, 1, 1, 9301)").run().lastInsertRowid);
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (?, 9301)').run(resourceId);
const { addDaysToIsoDate } = require('../utils/devisHelpers');

// The sessions follow the stay they belong to: the first and the second day.
let day;
let evening;

function stayWithBathLine({ paid }) {
  const id = stayWithTwoSales();
  const { startDate } = db.prepare('SELECT startDate FROM reservations WHERE id = ?').get(id);
  day = { date: startDate, start: '10:00', end: '11:00' };
  evening = { date: addDaysToIsoDate(startDate, 1), start: '20:00', end: '21:00' };
  db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, sessions) VALUES (?, ?, 1, 40, 1, 'per_hour', 40, ?)")
    .run(id, resourceId, JSON.stringify([day]));
  const { lineId } = db.prepare('SELECT lineId FROM reservation_resources WHERE reservationId = ?').get(id);
  if (paid) {
    db.prepare("INSERT INTO payment_allocations (documentRef, lineRef, amountCents, kind, at, books) VALUES (?, ?, 4000, 'payment', '2030-04-01', 1)")
      .run(`reservation:${id}`, `line:reservation_resources:${lineId}`);
  }
  return { id, lineId };
}
const withSession = (id, lineId, quantity) => {
  const body = storedBody(id);
  body.resources = body.resources.map((r) => (r.lineId === lineId ? { ...r, quantity, sessions: [day, evening] } : r));
  return body;
};

test('Q-C7 — a session added to a PAID line moves to a line the save appends; the paid line keeps its hour and its sessions', () => {
  const { id, lineId } = stayWithBathLine({ paid: true });
  const split = splitPaidLineSessions(db, id, withSession(id, lineId, 2));
  assert.equal(split.resources.length, 2);
  const [kept, added] = split.resources;
  assert.deepEqual([kept.lineId, kept.quantity, kept.sessions], [lineId, 1, [day]]);
  assert.deepEqual([added.newLine, added.quantity, added.sessions, added.lineId], [true, 1, [evening], undefined]);
});

test('Q-C7 — a session added to an UNPAID line stays on it; so does a body that adds no session', () => {
  const { id, lineId } = stayWithBathLine({ paid: false });
  const body = withSession(id, lineId, 2);
  assert.equal(splitPaidLineSessions(db, id, body), body);
  const paid = stayWithBathLine({ paid: true });
  const untouched = storedBody(paid.id);
  assert.deepEqual(splitPaidLineSessions(db, paid.id, untouched).resources, untouched.resources);
});

test('Q-C7 — through the fiche save: the paid line is untouched, a new row holds the new session and the new hour', () => {
  const { id, lineId } = stayWithBathLine({ paid: true });
  const result = controller.performUpdate(id, withSession(id, lineId, 2));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const rows = db.prepare('SELECT lineId, quantity, sessions FROM reservation_resources WHERE reservationId = ? ORDER BY lineId').all(id);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].lineId, rows[0].quantity, JSON.parse(rows[0].sessions).map((s) => s.date)], [lineId, 1, [day.date]]);
  assert.deepEqual([rows[1].quantity, JSON.parse(rows[1].sessions).map((s) => s.date)], [1, [evening.date]]);
});
