// specs/platform-statement-after-payout.md — the platform's statement (brut, commissions) written on a received
// payout or a locked fiche, outside the fiche save: re-split, never re-priced, traced.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, inDays, createStay, rowOf, liveQuote, mark } = require('./ledgerFixture');
const statementController = require('../controllers/platformStatementController');
const correction = require('../utils/platformStatementCorrection');
const { formatEuros } = require('../utils/reservationLedger');

function call(handler, id, body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ params: { id }, body, user: { role: 'admin' } }, res);
  return res;
}
const patch = (id, body) => call(statementController.update, id, body);
const preview = (id, body) => call(statementController.preview, id, body);

const moveToPast = (id) => db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(inDays(-40), inDays(-37), id);

/** A finished Booking stay priced at `net` through « Prix ajusté », its solde received: the 202605014 shape. */
function receivedNetStay({ net = 300, propertyId = 1 } = {}) {
  const id = createStay({ platform: 'Booking', customPrice: net, propertyId });
  const row = rowOf(id);
  const res = mark(id, { balancePaid: true, balancePaidDate: inDays(-60), expectedAmountCents: Math.round(row.balanceAmount * 100) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  moveToPast(id);
  return id;
}

const historyOf = (id) => db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'platform_statement'").all(id);

test('rules 4, 6, 8, 10 — a received solde takes its brut and commission: re-split, transfer kept, traced', () => {
  const id = receivedNetStay();
  const before = rowOf(id);
  const res = patch(id, { platformGrossAmount: before.balanceAmount + 75, platformCommissionAmount: 75 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.netGap, 0);
  const after = rowOf(id);
  assert.equal(after.platformGrossAmount, before.balanceAmount + 75);
  assert.equal(after.balanceAmount, before.balanceAmount + 75);
  assert.equal(after.platformCommissionAmount, 75);
  assert.equal(after.finalPrice, Math.round((before.finalPrice + 75) * 100) / 100, 'the final price moves by the brut only');
  assert.equal(after.platformPayoutAmount, before.balanceAmount, 'the transfer as it came in');
  assert.deepEqual([after.balancePaid, after.balancePaidDate, after.touristTaxTotal, after.complementAmount],
    [before.balancePaid, before.balancePaidDate, before.touristTaxTotal, before.complementAmount], 'marks, tax and complement untouched');
  const [history] = historyOf(id);
  const fields = JSON.parse(history.changedFields).map((c) => c.label);
  assert.ok(fields.includes('Montant total payé par le client') && fields.includes('Prix final') && fields.includes('Virement reçu'));
});

test('rule 4 (Q1) — a net different from the transfer is accepted and returned as a gap', async () => {
  const id = receivedNetStay();
  const before = rowOf(id);
  const res = patch(id, { platformGrossAmount: before.balanceAmount + 75, platformCommissionAmount: 70 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.netGap, 5);
  assert.equal(rowOf(id).platformPayoutAmount, before.balanceAmount);
  const quote = await liveQuote(id, { platformGrossAmount: before.balanceAmount + 75, platformCommissionAmount: 70, balancePaid: true });
  const balance = quote.ledger.rows.find((r) => r.key === 'balance');
  assert.match(balance.detail.reconciliation.label, /écart/);
});

test('rules 3-4 — the preview words the net against the transfer and writes nothing', () => {
  const id = receivedNetStay();
  const before = rowOf(id);
  const same = preview(id, { platformGrossAmount: before.balanceAmount + 75, platformCommissionAmount: 75 });
  assert.equal(same.statusCode, 200, JSON.stringify(same.body));
  assert.deepEqual(same.body.netLabel, { tone: 'done', label: `Net : ${formatEuros(before.balanceAmount)} — identique au virement ✓` });
  const off = preview(id, { platformGrossAmount: before.balanceAmount + 75, platformCommissionAmount: 70 });
  assert.equal(off.body.netLabel.tone, 'warning');
  assert.match(off.body.netLabel.label, /écart 5,00.€\)\. Le relevé sera enregistré avec cet écart\.$/);
  assert.equal(rowOf(id).platformGrossAmount, before.platformGrossAmount);
  assert.equal(historyOf(id).length, 0);
});

test('rules 1, 3 — a received platform solde opens the statement with the transfer it stands for', async () => {
  const id = receivedNetStay();
  const row = rowOf(id);
  const quote = await liveQuote(id, { balancePaid: true });
  const balance = quote.ledger.rows.find((r) => r.key === 'balance');
  assert.equal(balance.amountEdit.mode, 'statement');
  assert.equal(balance.amountEdit.editable, true);
  assert.deepEqual([balance.amountEdit.received.date, balance.amountEdit.received.net], [row.balancePaidDate, row.balanceAmount]);
  assert.match(balance.amountEdit.received.label, /^Virement reçu le \d{2}\/\d{2}(\/\d{4})? \(€\)$/);
});

test('rule 7 — a statement that would move the tourist tax is refused, nothing written', () => {
  // A tax on a percentage of the accommodation, not frozen yet (nothing collected): the brut would move it.
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Abracadaroom', 0, 0)").run();
  const id = createStay({ platform: 'Abracadaroom', propertyId: 2 });
  moveToPast(id);
  const before = rowOf(id);
  const res = patch(id, { platformGrossAmount: before.balanceAmount + 200, platformCommissionAmount: 200 });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'STATEMENT_WOULD_REPRICE');
  assert.ok(res.body.moved.includes('la taxe de séjour'));
  assert.equal(rowOf(id).platformGrossAmount, before.platformGrossAmount);
  assert.equal(historyOf(id).length, 0);
});

test('rule 11 — a locked, unreceived platform solde takes its statement without the transfer comparison', () => {
  const id = createStay({ platform: 'Booking' });
  moveToPast(id);
  const before = rowOf(id);
  const res = patch(id, { platformGrossAmount: 400, platformCommissionAmount: 60 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.netGap, 0);
  const after = rowOf(id);
  assert.equal(after.balanceAmount, 400);
  assert.equal(after.platformPayoutAmount, before.platformPayoutAmount, 'nothing received, no transfer recorded');
  assert.equal(after.balancePaid, 0);
});

test('rule 12 and validation — direct, cancelled, negative or over-commissioned statements are refused', () => {
  const direct = createStay();
  assert.equal(patch(direct, { platformGrossAmount: 300 }).body.code, 'NOT_A_PLATFORM_STAY');
  const cancelled = createStay({ platform: 'Booking' });
  db.prepare('UPDATE reservations SET cancelledAt = ? WHERE id = ?').run(inDays(-1), cancelled);
  assert.equal(patch(cancelled, { platformGrossAmount: 300 }).body.code, 'NOT_A_PLATFORM_STAY');
  const id = createStay({ platform: 'Booking' });
  moveToPast(id);
  assert.equal(patch(id, { platformGrossAmount: -1 }).statusCode, 400);
  assert.equal(patch(id, { platformGrossAmount: 100, platformCommissionAmount: 150 }).body.code, 'INVALID_STATEMENT');
  assert.equal(patch(id, {}).body.code, 'INVALID_STATEMENT');
});

test('pure — the transfer, the final price by the pre-arrival difference, the signed gap', () => {
  assert.equal(correction.netReceived({ platformPayoutAmount: 171.14, balanceAmount: 999 }), 171.14);
  assert.equal(correction.netReceived({ balanceAmount: 171.14, depositAmount: 0, platformCommissionAmount: null }), 171.14);
  // The 202605014 replay: net 171,14 typed as « Prix ajusté », options 70 € collected at arrival.
  const stored = { finalPrice: 241.14, depositAmount: 0, balanceAmount: 171.14 };
  const next = correction.nextColumns(stored, { platformGrossAmount: 215 },
    { depositAmount: 0, balanceAmount: 215, platformCommissionAmount: 43.86, acompteCommissionAmount: 0 });
  assert.deepEqual([next.balanceAmount, next.platformCommissionAmount, next.finalPrice], [215, 43.86, 285]);
  assert.equal(correction.netGapOf(next, 171.14), 0);
  assert.equal(correction.netGapOf({ ...next, platformCommissionAmount: 40 }, 171.14), 3.86);
});

test('review H1 — a channel counted as a direct sale keeps its received solde frozen', async () => {
  db.prepare("INSERT INTO platforms (name, countsAsDirect) VALUES ('Ventedirecte', 1)").run();
  require('../utils/platformNameFormat').refreshDirectChannels(db);
  const id = createStay({ platform: 'Ventedirecte' });
  const row = rowOf(id);
  assert.equal(mark(id, { balancePaid: true, balancePaidDate: inDays(-60), expectedAmountCents: Math.round(row.balanceAmount * 100) }).statusCode, 200);
  moveToPast(id);
  assert.equal(patch(id, { platformGrossAmount: row.balanceAmount + 100 }).body.code, 'NOT_A_PLATFORM_STAY');
  assert.equal(rowOf(id).balanceAmount, row.balanceAmount);
  const quote = await liveQuote(id, { balancePaid: true });
  const balance = quote.ledger.rows.find((r) => r.key === 'balance');
  assert.notEqual(balance.amountEdit.mode, 'statement');
  assert.equal(balance.amountEdit.correctable, undefined);
});

test('review M1 — the transfer typed in the panel is the one stored and compared', () => {
  const id = receivedNetStay();
  const before = rowOf(id);
  const res = patch(id, { platformGrossAmount: before.balanceAmount, platformCommissionAmount: 45, platformPayoutAmount: before.balanceAmount - 45 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.netGap, 0);
  assert.equal(rowOf(id).platformPayoutAmount, before.balanceAmount - 45);
});

test('review M2 — without a brut, a stay the replay no longer prices as stored is refused', () => {
  const id = receivedNetStay();
  db.prepare('UPDATE reservations SET balanceAmount = balanceAmount - 50, finalPrice = finalPrice - 50 WHERE id = ?').run(id);
  const before = rowOf(id);
  const res = patch(id, { platformCommissionAmount: 30 });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'STATEMENT_WOULD_REPRICE');
  assert.equal(rowOf(id).balanceAmount, before.balanceAmount);
  assert.equal(patch(id, { platformGrossAmount: before.balanceAmount, platformCommissionAmount: 30 }).statusCode, 200, 'a brut pins the stay');
});

test('review M3 — a commission above its échéance is refused, not cut', () => {
  const id = receivedNetStay();
  const before = rowOf(id);
  const res = patch(id, { platformGrossAmount: before.balanceAmount, platformCommissionAmount: before.balanceAmount + 10 });
  assert.equal(res.statusCode, 400);
  const fine = createStay({ platform: 'Booking' });
  moveToPast(fine);
  const commissionOver = patch(fine, { platformGrossAmount: 100, platformCommissionAmount: 100 });
  assert.equal(commissionOver.statusCode, 200, JSON.stringify(commissionOver.body));
});

test('review L4 — a stay to come and unreceived, or a stay with a plan, goes through the fiche', () => {
  const future = createStay({ platform: 'Booking' });
  assert.equal(patch(future, { platformGrossAmount: 400 }).body.code, 'STATEMENT_THROUGH_FICHE');
  const planned = createStay({ platform: 'Booking' });
  moveToPast(planned);
  db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents) VALUES (?, 1, ?, 10000)').run(planned, inDays(-50));
  assert.equal(patch(planned, { platformGrossAmount: 400 }).body.code, 'STATEMENT_WITH_PLAN');
});

test('review L1 — the history formats the statement as money', () => {
  const { buildHistoryRows } = require('../utils/reservationAudit');
  const { changes } = buildHistoryRows([
    { field: 'platformGrossAmount', label: 'Montant total payé par le client', from: null, to: 215 },
    { field: 'platformCommissionAmount', label: 'Commission solde', from: null, to: 43.86 },
  ]);
  const printed = JSON.stringify(changes);
  assert.match(printed, /"toText":"215 €"/);
  assert.match(printed, /43,86/);
});
