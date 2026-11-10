// specs/single-payment-from-the-fiche.md rule 9 reading of 2026-11-10 (audit R45-PL-L1) — the SAS « paiement unique »
// line stored before sas 1.9.3 (and by the core SAS of v3.21.0) carries fromText « — » and toText
// « 144.95 € — CB / Chèque le 2026-09-01 — solde, complément »: it read back as stored. It now reads French like the
// core lines — amount, day, and the bare « complément » named « complément d'arrivée » —, idempotent, stored row
// untouched.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHistoryRows } = require('../utils/reservationAudit');
const { localIsoDate } = require('../utils/localDate');

const dayFr = (iso) => iso.split('-').reverse().join('/');

test('rule 9 reading — a legacy SAS single-payment line reads French', () => {
  const day = localIsoDate(new Date(Date.now() - 40 * 86400000));
  const stored = { field: 'arrivalPayment', label: "Encaissé à l'arrivée — paiement unique", fromText: '—', toText: `530.5 € — CB / Chèque le ${day} — solde, complément` };
  const before = JSON.stringify(stored);
  const [row] = buildHistoryRows([stored]).changes;
  assert.equal(row.fromText, '—');
  assert.equal(row.toText, `530,50 € — CB / Chèque le ${dayFr(day)} — solde, complément d'arrivée`);
  assert.equal(JSON.stringify(stored), before, 'the stored row is untouched');
});

test('rule 9 reading — a line already French reads the same twice (idempotent)', () => {
  const texts = [
    "12,50 € — CB / Chèque le 01/02/2030 — solde, complément d'arrivée",
    '12,50 € — caisse interne le 01/02/2030 — solde, complément de fin de séjour',
    '12,50 € — CB / Chèque le 01/02/2030 — solde, complément d’arrivée',
    '—',
  ];
  for (const text of texts) {
    const [row] = buildHistoryRows([{ field: 'arrivalPaymentAdjustment', label: 'x', fromText: null, toText: text }]).changes;
    assert.equal(row.toText, text);
    assert.equal(row.fromText, null);
  }
});
