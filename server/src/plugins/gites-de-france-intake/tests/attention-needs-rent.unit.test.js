// specs/gites-de-france-mail-intake.md rule 14 (amended 2026-10-18) — a fiche waiting for the operator to
// choose between two possible rents is listed on the dashboard too, not only in the fiche's banner
// (review 2026-10-18, n5).
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');

test('rule 14: errors, rent choices and day-old unmatched mails are listed; applied and dismissed ones are not', () => {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const intakes = buildModel(db);
  const at = '2026-10-14T16:32:00.000Z';
  const ids = {
    error: intakes.insert({ messageId: '<a>', receivedAt: at, status: 'error', error: 'Mail illisible' }),
    rent: intakes.insert({ messageId: '<b>', receivedAt: at, dossierNumber: '11773', status: 'needs_rent' }),
    pendingOld: intakes.insert({ messageId: '<c>', receivedAt: '2026-10-13T08:00:00.000Z', status: 'pending' }),
    pendingFresh: intakes.insert({ messageId: '<d>', receivedAt: '2026-10-15T09:00:00.000Z', status: 'pending' }),
    applied: intakes.insert({ messageId: '<e>', receivedAt: at, status: 'applied' }),
    dismissed: intakes.insert({ messageId: '<f>', receivedAt: at, status: 'needs_rent' }),
  };
  intakes.dismiss(ids.dismissed);
  const listed = intakes.listAttention('2026-10-15T10:00:00.000Z').map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(listed, [ids.error, ids.rent, ids.pendingOld]);
});
