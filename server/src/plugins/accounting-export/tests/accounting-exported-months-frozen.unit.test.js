const test = require('node:test');
const assert = require('node:assert/strict');

// specs/accountant-accounting-export.md rule 33 — a month the accountant may already have imported
// keeps its cents. Final review 2026-10-18, N4: the rule 32 split moved one cent on April (Nouville
// 624,54 / 62,46), July (Nicolet 40,34 / 11,23) and September 2026 (Van Dijk 117,28 / 11,72).
const { buildRows } = require('../accountingExport');

function entry(paidDate) {
  // 129,00 € of a 150,07 € stay at 10 %, the Van Dijk shape.
  return {
    reservationId: 1, kind: 'balance', paidDate,
    client: { firstName: 'Anna', lastName: 'Van Dijk' },
    platform: 'direct', clientGrossAmount: null,
    finalPrice: 150.07, encaissementTtc: 129, taxTtc: 0, fraction: 0.859599,
    buckets: [{ name: 'accommodation', ht: 136.43, vat: 13.64, ratePercent: 10 }],
  };
}

const credits = (rows) => rows.map((r) => Number(String(r[8]).replace(',', '.'))).filter((v) => v > 0).sort((a, b) => b - a);

test('rule 33 — a payment of September 2026 keeps the cents it was exported with', () => {
  assert.deepEqual(credits(buildRows([entry('2026-09-28')])), [117.28, 11.72]);
});

test('rule 33 — from 1 October 2026 the TTC share is split at its rate', () => {
  assert.deepEqual(credits(buildRows([entry('2026-10-01')])), [117.27, 11.73]);
});
