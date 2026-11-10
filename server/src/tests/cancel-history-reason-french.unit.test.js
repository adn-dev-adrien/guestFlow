// specs/payment-schedule-and-cancellation.md rule 23a reading of 2026-11-10 (audits R45-RES-L1 = R45-DB-L1) — a
// cancellation confirmed with the optional « Motif » left empty stored the derived key (`unpaid_balance`) on its
// history entry, and « Voir historique » printed « Motif : vide → unpaid_balance ». The key reads French at read time,
// the stored row untouched; a reason the operator typed reads as typed.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, respond, rowOf, mark, ADMIN, WITH_ACOMPTE, D, fiche } = require('./moneyLedgerFixture');
const cancellationController = require('../controllers/reservationCancellationController');
const { buildHistoryRows } = require('../utils/reservationAudit');

const motifOf = (changes) => buildHistoryRows(changes).changes.find((row) => row.field === 'cancellationReason');

test('rule 23a reading — each derived cancellation key reads French', () => {
  const read = (key) => motifOf([{ field: 'cancellationReason', label: 'Motif', from: null, to: key }]).toText;
  assert.equal(read('unpaid_deposit'), 'Acompte impayé');
  assert.equal(read('unpaid_balance'), 'Solde impayé');
  assert.equal(read('manual'), 'Annulation manuelle');
});

test('rule 23a reading — a reason the operator typed reads as typed, even one holding a key', () => {
  const read = (text) => motifOf([{ field: 'cancellationReason', label: 'Motif', from: null, to: text }]).toText;
  assert.equal(read('Le client a appelé'), 'Le client a appelé');
  assert.equal(read('manual check by phone'), 'manual check by phone');
});

test('rule 23a reading — a cancel with an empty Motif: the history reads the French label, the stored row keeps the key', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  const res = respond();
  await cancellationController.cancel({ params: { id: String(stay.id) }, body: { reason: '' }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const key = res.body.cancellationReason;
  assert.ok(['unpaid_deposit', 'unpaid_balance', 'manual'].includes(key));
  const entry = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'cancel' ORDER BY id DESC").get(stay.id);
  const changes = JSON.parse(entry.changedFields);
  assert.equal(changes.find((change) => change.field === 'cancellationReason').to, key, 'the stored row is untouched');
  const shown = motifOf(changes);
  assert.doesNotMatch(shown.toText, /_|manual/);
  assert.equal(rowOf(stay.id).kind, 'cancelled');
});
