// specs/reconciliation-assisted-matching.md rules 23–27, 29–30 — platform penalties: scope, guards, the
// « before » and « after » cases and their commission figures, previews with their warnings, removal,
// the aggregate column, the history, the ledger line and the finance figures before / after.
// Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = process.env.DB_PATH || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-pen-')), 'pen.db');
const silent = console.log;
console.log = () => {};
const db = require('../database');
console.log = silent;

const { buildController } = require('../controllers/platformPenaltiesController');
const penaltiesModel = require('../models/platformPenaltiesModel');
const reservationsModel = require('../models/reservationsModel');
const { buildLedger } = require('../utils/reservationLedger');
const { comptaCollected, remainingToPay } = require('../utils/reservationSettlement');
const { computePlatformCommission } = require('../utils/platformCommission');

const TODAY = '2026-10-28';
const controller = buildController({ database: db, penaltiesModel, reservationsModel, todayOf: () => TODAY });

db.prepare("INSERT OR IGNORE INTO properties (id, name) VALUES (1, 'Gîte')").run();
db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('Booking')").run();

let next = 5000;
function stay(over = {}) {
  const row = {
    id: (next += 1), kind: 'reservation', propertyId: 1, clientId: 1, startDate: '2026-05-10', endDate: '2026-05-12', adults: 2, platform: 'Booking',
    finalPrice: 800, depositAmount: 0, balanceAmount: 800, balanceDueDate: '2026-05-20', platformGrossAmount: 800,
    platformPayoutAmount: 610.02, platformCommissionAmount: 189.98, balancePaid: 1, balancePaidDate: '2026-05-25', ...over,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
  return row.id;
}
const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const history = (id) => db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id).map((r) => r.changedFields).join(' ');
const body = (over = {}) => ({ amount: 40, reason: 'Frais de relogement', date: '2026-05-26', source: 'reconciliation', ...over });

test('rule 23, 26 — a direct (422) or a cancelled (409) stay cannot carry a penalty', () => {
  const direct = stay({ platform: 'direct' });
  const cancelled = stay({ kind: 'cancelled' });
  assert.equal(controller.declare(direct, body(), null).body.code, 'PENALTY_NOT_PLATFORM');
  assert.equal(controller.preview(direct, body()).status, 422);
  assert.equal(controller.declare(cancelled, body(), null).status, 409);
  assert.equal(controller.list(direct).body.canDeclare, false);
  assert.equal(controller.declare(999999, body(), null).status, 404);
});

test('rule 26 — amount, motif and date are refused in words', () => {
  const id = stay();
  const refuse = (over) => controller.declare(id, body(over), null);
  assert.equal(refuse({ amount: 0 }).body.field, 'amount');
  assert.equal(refuse({ amount: -5 }).status, 422);
  assert.match(refuse({ amount: 12.345 }).body.error, /deux décimales/);
  assert.equal(refuse({ reason: 'ab' }).body.field, 'reason');
  assert.equal(refuse({ reason: 'x'.repeat(121) }).body.field, 'reason');
  assert.equal(refuse({ date: '2026-11-30' }).body.error, 'La date ne peut pas être dans le futur.');
  assert.equal(refuse({ date: '2026-02-30' }).body.field, 'date');
  assert.equal(penaltiesModel.listFor(id).length, 0, 'a refusal stores nothing');
});

test('rule 26 — penalties above the payout are refused (PENALTY_EXCEEDS_PAYOUT), also together', () => {
  const id = stay();
  assert.equal(controller.declare(id, body({ amount: 700 }), null).body.code, 'PENALTY_EXCEEDS_PAYOUT');
  assert.equal(controller.declare(id, body({ amount: 400 }), null).status, 201);
  assert.equal(controller.declare(id, body({ amount: 300 }), null).body.code, 'PENALTY_EXCEEDS_PAYOUT', '400 + 300 > 610,02');
});

test('rule 25 — declared from a reconciliation gap: payout and commission are kept, the aggregate follows', () => {
  const id = stay();
  const answer = controller.declare(id, body(), { id: 1 });
  assert.equal(answer.status, 201);
  assert.equal(answer.body.item.payoutAdjusted, false);
  const r = row(id);
  assert.equal(r.platformPayoutAmount, 610.02);
  assert.equal(r.platformCommissionAmount, 189.98);
  assert.equal(r.platformPenaltyAmount, 40);
  assert.match(history(id), /Pénalité plateforme/);
  assert.match(history(id), /40,00 € · Frais de relogement/);
});

test('rule 25 — from the fiche with a payout: the choice is required; « avant pénalité » changes nothing else', () => {
  const id = stay();
  const preview = controller.preview(id, body({ source: 'fiche' })).body;
  assert.equal(preview.needsChoice, true);
  assert.equal(controller.declare(id, body({ source: 'fiche' }), null).status, 422);
  const before = controller.declare(id, body({ source: 'fiche', payoutIncludesPenalty: false }), null);
  assert.equal(before.status, 201);
  assert.equal(row(id).platformPayoutAmount, 610.02);
  assert.equal(row(id).platformCommissionAmount, 189.98);
});

test('rule 25 — « le montant reçu » adds the penalty to the payout, so the commission drops by the same amount', () => {
  const id = stay({ platformPayoutAmount: 570.02, platformCommissionAmount: 229.98 });
  const preview = controller.preview(id, body({ source: 'fiche', payoutIncludesPenalty: true })).body;
  assert.equal(preview.valid, true);
  assert.deepEqual([preview.before.payout, preview.after.payout], [570.02, 610.02]);
  assert.deepEqual([preview.before.commission, preview.after.commission], [229.98, 189.98]);
  assert.deepEqual([preview.before.netReceived, preview.after.netReceived], [570.02, 570.02], 'the bank amount does not move');
  const answer = controller.declare(id, body({ source: 'fiche', payoutIncludesPenalty: true }), null);
  assert.equal(answer.status, 201);
  assert.equal(answer.body.item.payoutAdjusted, true);
  assert.equal(row(id).platformPayoutAmount, 610.02);
  assert.equal(row(id).platformCommissionAmount, computePlatformCommission({ gross: 800, payout: 610.02 }));
});

test('rule 26 — a commission that would turn negative is refused (COMMISSION_NEGATIVE)', () => {
  const id = stay({ platformPayoutAmount: 780, platformCommissionAmount: 20 });
  const answer = controller.declare(id, body({ source: 'fiche', payoutIncludesPenalty: true, amount: 30 }), null);
  assert.equal(answer.status, 422);
  assert.equal(answer.body.code, 'COMMISSION_NEGATIVE');
  assert.equal(row(id).platformPayoutAmount, 780);
});

test('rule 25 — no payout recorded: nothing to choose, nothing adjusted', () => {
  const id = stay({ platformPayoutAmount: null, platformCommissionAmount: 150, balancePaid: 0, balancePaidDate: null });
  const preview = controller.preview(id, body({ source: 'fiche' })).body;
  assert.equal(preview.needsChoice, false);
  assert.equal(controller.declare(id, body({ source: 'fiche', date: '2026-10-01' }), null).status, 201);
  assert.equal(row(id).platformPayoutAmount, null);
  assert.equal(row(id).platformCommissionAmount, 150);
});

test('rule 29 — the preview warns when a month before the current one changes, and writes nothing', () => {
  const id = stay({ platformPayoutAmount: 570.02, platformCommissionAmount: 229.98 });
  const preview = controller.preview(id, body({ source: 'fiche', payoutIncludesPenalty: true, date: '2026-10-05' })).body;
  assert.deepEqual(preview.warnings, ['L’écriture de mai change : si mai est déjà transmis, prévenir le comptable.']);
  const backdated = controller.preview(id, body({ source: 'fiche', payoutIncludesPenalty: false, date: '2026-09-02' })).body;
  assert.deepEqual(backdated.warnings, ['L’écriture de septembre change : si septembre est déjà transmis, prévenir le comptable.']);
  assert.equal(penaltiesModel.listFor(id).length, 0);
  const current = controller.preview(stay({ balancePaidDate: '2026-10-10' }), body({ source: 'reconciliation', date: '2026-10-12' })).body;
  assert.deepEqual(current.warnings, []);
});

test('rule 30 — removing restores the payout only if it still is the value the declaration wrote', () => {
  const id = stay({ platformPayoutAmount: 570.02, platformCommissionAmount: 229.98 });
  const { item } = controller.declare(id, body({ source: 'fiche', payoutIncludesPenalty: true }), null).body;
  const removed = controller.remove(id, item.id);
  assert.equal(removed.body.payoutRestored, true);
  assert.deepEqual([row(id).platformPayoutAmount, row(id).platformCommissionAmount, row(id).platformPenaltyAmount], [570.02, 229.98, 0]);
  assert.match(history(id), /supprimée/);

  const other = stay({ platformPayoutAmount: 570.02, platformCommissionAmount: 229.98 });
  const second = controller.declare(other, body({ source: 'fiche', payoutIncludesPenalty: true }), null).body.item;
  db.prepare('UPDATE reservations SET platformPayoutAmount = 615 WHERE id = ?').run(other);
  const answer = controller.remove(other, second.id);
  assert.equal(answer.body.payoutRestored, false);
  assert.match(answer.body.message, /Versement modifié depuis/);
  assert.equal(row(other).platformPayoutAmount, 615, 'the operator\'s edit stands');
  assert.equal(row(other).platformPenaltyAmount, 0);
  assert.equal(controller.remove(other, second.id).status, 404);
});

test('rule 27 — the aggregate column is the sum of the lines through declarations and removals', () => {
  const id = stay();
  const a = controller.declare(id, body({ amount: 40 }), null).body.item;
  controller.declare(id, body({ amount: 10.5, reason: 'Non-conformité' }), null);
  assert.equal(row(id).platformPenaltyAmount, 50.5);
  controller.remove(id, a.id);
  assert.equal(row(id).platformPenaltyAmount, 10.5);
  assert.deepEqual(controller.list(id).body.items.map((i) => [i.amount, i.dateLabel]), [[10.5, '26/05']]);
  assert.equal(controller.list(id).body.total, 10.5);
});

test('rule 27 — the ledger\'s payout row shows a line per penalty and the net after penalties', () => {
  const id = stay();
  controller.declare(id, body(), null);
  const ledger = buildLedger({ row: row(id), penalties: penaltiesModel.listFor(id), today: TODAY });
  const payout = ledger.rows.find((r) => r.key === 'balance');
  const plain = (t) => t.replace(/[\u00a0\u202f]/g, ' ');
  assert.deepEqual(payout.detail.penalties.map((p) => plain(p.label)), ['Pénalité plateforme −40,00 € · Frais de relogement']);
  assert.equal(payout.detail.penalties[0].id > 0, true);
  assert.deepEqual(payout.penaltyAction, { label: 'Déclarer une pénalité' }, 'offered on the payout row itself, even when the amounts are frozen');
  const direct = buildLedger({ row: { ...row(id), platform: 'direct' }, today: TODAY }).rows.find((r) => r.key === 'balance');
  assert.equal(direct.penaltyAction, undefined);
  assert.match(plain(payout.detail.commission), /Commission 189,98 € · net 570,02 €/);
});

test('rule 27 — finance figures of a platform stay with and without a penalty: net, collected, remaining', () => {
  const paid = stay();
  const unpaid = stay({ balancePaid: 0, balancePaidDate: null });
  const before = { collected: comptaCollected(row(paid)), remaining: remainingToPay(row(unpaid)) };
  assert.deepEqual(before, { collected: 610.02, remaining: 610.02 });
  controller.declare(paid, body(), null);
  controller.declare(unpaid, body({ date: '2026-10-01' }), null);
  assert.equal(comptaCollected(row(paid)), 570.02, 'collected is net of the penalty, the commission is untouched');
  assert.equal(remainingToPay(row(unpaid)), 570.02);
  assert.equal(row(paid).platformCommissionAmount, 189.98, 'commissions shown anywhere stay the commission alone');
});
