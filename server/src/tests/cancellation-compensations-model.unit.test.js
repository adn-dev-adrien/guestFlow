const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const compensationsModel = require('../models/cancellationCompensationsModel');

// Pins the lifecycle of a cancellation compensation (specs/cancellation-compensation.md §3.1, §5):
// pending is editable and invisible to accounting, received is frozen and booked at its date.

const DDL = `
  CREATE TABLE cancellation_compensations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    cancellationAlertId INTEGER UNIQUE,
    reservationId       INTEGER,
    propertyId          INTEGER,
    propertyName        TEXT    NOT NULL DEFAULT '',
    platform            TEXT    NOT NULL DEFAULT '',
    clientFirstName     TEXT    NOT NULL DEFAULT '',
    clientLastName      TEXT    NOT NULL DEFAULT '',
    startDate           TEXT,
    endDate             TEXT,
    cancelledStayAmount REAL,
    expectedAmount      REAL    NOT NULL DEFAULT 0,
    expectedDate        TEXT,
    receivedAmount      REAL,
    receivedDate        TEXT,
    status              TEXT    NOT NULL DEFAULT 'pending',
    origin              TEXT    NOT NULL DEFAULT 'platform',
    notes               TEXT    NOT NULL DEFAULT '',
    createdAt           TEXT    NOT NULL DEFAULT (datetime('now')),
    updatedAt           TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

const DRAFT = {
  propertyName: 'Le Lodge',
  platform: 'Airbnb',
  clientFirstName: 'Claire',
  clientLastName: 'Notin',
  startDate: '2026-09-04',
  endDate: '2026-09-07',
  cancelledStayAmount: 612.5,
  expectedAmount: 84,
  expectedDate: '2026-08-26',
  notes: 'Annulation hors délai',
};

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: compensationsModel.buildModel(db) };
}

// specs/cancellation-compensation.md rule 2
test('create: persists the snapshot and starts pending', () => {
  const { model } = freshModel();
  const created = model.create(DRAFT);
  assert.equal(created.status, 'pending');
  assert.equal(created.propertyName, 'Le Lodge');
  assert.equal(created.platform, 'Airbnb');
  assert.equal(created.clientName, 'Claire Notin');
  assert.equal(created.cancelledStayAmount, 612.5);
  assert.equal(created.expectedAmount, 84);
  assert.equal(created.receivedAmount, null);
  assert.equal(created.receivedDate, null);
});

// specs/cancellation-compensation.md rule 28
test('create: amounts are rounded to the cent', () => {
  const { model } = freshModel();
  const created = model.create({ ...DRAFT, expectedAmount: 84.567, cancelledStayAmount: 612.499 });
  assert.equal(created.expectedAmount, 84.57);
  assert.equal(created.cancelledStayAmount, 612.5);
});

// specs/cancellation-compensation.md rule 4
test('update: rewrites a pending row', () => {
  const { model } = freshModel();
  const created = model.create(DRAFT);
  const result = model.update(created.id, { ...DRAFT, expectedAmount: 120, notes: 'Montant confirmé' });
  assert.equal(result.ok, true);
  assert.equal(result.data.expectedAmount, 120);
  assert.equal(result.data.notes, 'Montant confirmé');
});

test('update: keeps the originating alert link (it is not part of the editable payload)', () => {
  const { model } = freshModel();
  const created = model.create({ ...DRAFT, cancellationAlertId: 7 });
  const result = model.update(created.id, { ...DRAFT, expectedAmount: 90 });
  assert.equal(result.data.cancellationAlertId, 7);
});

// specs/cancellation-compensation.md rule 5
test('receive: books the row at its payment date and freezes it', () => {
  const { model } = freshModel();
  const created = model.create(DRAFT);
  const result = model.receive(created.id, { receivedAmount: 79.2, receivedDate: '2026-08-28' });
  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'received');
  assert.equal(result.data.receivedAmount, 79.2);
  assert.equal(result.data.receivedDate, '2026-08-28');
  // The amount actually wired may differ from the announced one — that is normal, not an error.
  assert.equal(result.data.expectedAmount, 84);
  assert.deepEqual(model.update(created.id, DRAFT), { error: 'COMPENSATION_LOCKED', status: 409 });
  assert.deepEqual(model.remove(created.id), { error: 'COMPENSATION_LOCKED', status: 409 });
  assert.deepEqual(model.receive(created.id, { receivedAmount: 10, receivedDate: '2026-08-29' }), { error: 'COMPENSATION_LOCKED', status: 409 });
});

// specs/cancellation-compensation.md rule 6
test('reopen: clears the banked amount + date so a half-corrected row can never look booked', () => {
  const { model } = freshModel();
  const created = model.create(DRAFT);
  model.receive(created.id, { receivedAmount: 79.2, receivedDate: '2026-08-28' });
  const result = model.reopen(created.id);
  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'pending');
  assert.equal(result.data.receivedAmount, null);
  assert.equal(result.data.receivedDate, null);
  // Idempotency guard: reopening a pending row is a 409, not a silent no-op.
  assert.deepEqual(model.reopen(created.id), { error: 'COMPENSATION_NOT_RECEIVED', status: 409 });
});

// specs/cancellation-compensation.md rule 7
test('remove: deletes a pending row, 404s on an unknown one', () => {
  const { model } = freshModel();
  const created = model.create(DRAFT);
  assert.deepEqual(model.remove(created.id), { ok: true });
  assert.equal(model.getById(created.id), null);
  assert.deepEqual(model.remove(created.id), { error: 'INTROUVABLE', status: 404 });
});

// specs/cancellation-compensation.md rule 22
test('listPending: only pending rows, most overdue first, NULL expected dates last', () => {
  const { model } = freshModel();
  const late = model.create({ ...DRAFT, expectedDate: '2026-08-01' });
  const undated = model.create({ ...DRAFT, expectedDate: null });
  const soon = model.create({ ...DRAFT, expectedDate: '2026-08-26' });
  const banked = model.create(DRAFT);
  model.receive(banked.id, { receivedAmount: 50, receivedDate: '2026-08-28' });

  const pending = model.listPending();
  assert.deepEqual(pending.map((c) => c.id), [late.id, soon.id, undated.id]);
});

// specs/cancellation-compensation.md rule 15
test('listReceivedByMonth: half-open range — the 1st is in, the 1st of next month is out', () => {
  const { model } = freshModel();
  const inFirst = model.create(DRAFT);
  const inLast = model.create(DRAFT);
  const nextMonth = model.create(DRAFT);
  const previousMonth = model.create(DRAFT);
  model.receive(inFirst.id, { receivedAmount: 10, receivedDate: '2026-08-01' });
  model.receive(inLast.id, { receivedAmount: 20, receivedDate: '2026-08-31' });
  model.receive(nextMonth.id, { receivedAmount: 30, receivedDate: '2026-09-01' });
  model.receive(previousMonth.id, { receivedAmount: 40, receivedDate: '2026-07-31' });

  const august = model.listReceivedByMonth({ from: '2026-08-01', nextMonth: '2026-09-01' });
  assert.deepEqual(august.map((c) => c.receivedDate), ['2026-08-01', '2026-08-31']);
});

// specs/cancellation-compensation.md rule 23
test('overdue: a pending row whose expected date has passed is flagged server-side', () => {
  const { model } = freshModel();
  const past = model.create({ ...DRAFT, expectedDate: '2020-01-01' });
  const far = model.create({ ...DRAFT, expectedDate: '2099-01-01' });
  const undated = model.create({ ...DRAFT, expectedDate: null });
  const byId = new Map(model.listPending().map((c) => [c.id, c]));
  assert.equal(byId.get(past.id).overdue, true);
  assert.equal(byId.get(far.id).overdue, false);
  assert.equal(byId.get(undated.id).overdue, false);
});

test('overdue: never true once the compensation is banked', () => {
  const { model } = freshModel();
  const created = model.create({ ...DRAFT, expectedDate: '2020-01-01' });
  model.receive(created.id, { receivedAmount: 84, receivedDate: '2020-02-01' });
  assert.equal(model.getById(created.id).overdue, false);
});
