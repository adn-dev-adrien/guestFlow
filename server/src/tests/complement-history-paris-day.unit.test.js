// specs/pricing-components.md §3 rules 74 and 76 (formerly finance-dashboard-redesign.md rule 50) — the complement excess does not depend
// on the day an edit was stamped: the lines the complement collected are read from its frozen split and the payments that name
// them, so an edit made just after midnight Paris time, on the collection day or not, changes nothing. The tourist tax a legacy
// complement collected (no stamp) is the one the allocations of its bucket name on the stay's tax line.
process.env.TZ = 'Europe/Paris';
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stayWithCollectedLines, OPTION } = require('./complementExcessFixture');

const db = require('../database');
const controller = require('../controllers/reservationsController');

test('rule 50 — an option dropped from the complement counts, whatever the stamp of the edit that dropped it', () => {
  const id = stayWithCollectedLines(db, { complement: [{ key: OPTION(3), bucket: 'options', cents: 3000 }], balancePaid: false, startDate: '2026-10-29' });
  db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields, createdAt) VALUES (?, 'update', '[]', '2026-10-30 23:30:00')").run(id);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.equal(controller.__test.complementLeftOf(id, { complementDetailLines: [], optionLines: [] }, row).options, 30);
});

test('rule 50 — the tourist tax a legacy complement collected is read from the allocation on the stay\'s tax line', () => {
  const id = stayWithCollectedLines(db, { complement: [], balancePaid: false, startDate: '2026-10-29' });
  const split = { taxCents: 1200, accommodationCents: 0, optionsCents: 3000, resourcesCents: 0, lines: [{ key: OPTION(3), label: 'Ligne', bucket: 'options', cents: 3000 }] };
  db.prepare("UPDATE reservations SET complementPaid = 1, complementPaidDate = '2026-10-31', complementAmount = 42, complementPaidSplit = ?, touristTaxInComplement = 1 WHERE id = ?")
    .run(JSON.stringify(split), id);
  db.prepare('UPDATE reservations SET complementCollectedTax = NULL WHERE id = ?').run(id);
  db.prepare("INSERT INTO reservation_stay_lines (reservationId, kind, label, totalCents, vatClass) VALUES (?, 'touristTax', 'Taxe de séjour', 600, 'tourist-tax')").run(id);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.equal(row.complementCollectedTax, null);
  const left = controller.__test.complementLeftOf(id, { complementDetailLines: [], optionLines: [{ optionId: 3, totalPrice: 30 }], touristTaxInComplement: true, touristTaxTotal: 6 }, row);
  assert.equal(left.touristTax, 6);
});
