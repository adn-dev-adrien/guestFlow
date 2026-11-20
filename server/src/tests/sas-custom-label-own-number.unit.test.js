// specs/pricing-components.md §3 rule 102 e as completed by rule 103 (stabilisation loop t3, T3-7, 2026-11-16) — a SAS linen item whose own label ends
// in « (n) » (labels are operator-editable: « Drap-housse (140) », « Drap-housse (160) ») is found again by its own label on a re-run: same row, same
// line id, same amount, whatever the order of the items; a row the SAS numbered itself (« Bière locale (2) ») is still found by its base label.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const reservations = require('../models/reservationsModel');
const { withNow } = require('../utils/localDate');

const rows = (id) => db.prepare('SELECT id, description, amount FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1 ORDER BY id').all(id);

test('T3-7 — two linen items told apart by their own « (n) » keep their rows across re-runs in any order', () => {
  const id = stay(20);
  const door = new Date(`${addDaysToIsoDate(row(id).startDate, 0)}T14:00:00`);
  const items = [{ label: 'Drap-housse (140)', amount: 8 }, { label: 'Drap-housse (160)', amount: 10 }];
  withNow(door, () => reservations.commitArrivalSas(id, { complementItems: items }));
  const first = rows(id);
  assert.deepEqual(first.map((r) => [r.description, r.amount]), [['Drap-housse (140)', 8], ['Drap-housse (160)', 10]]);
  withNow(door, () => reservations.commitArrivalSas(id, { complementItems: items.slice().reverse() }));
  assert.deepEqual(rows(id), first, 'same ids, same labels, same amounts');
});
