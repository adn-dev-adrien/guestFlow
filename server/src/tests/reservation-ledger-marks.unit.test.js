// specs/reservation-payment-ledger.md §3.2 — recording a movement from the ledger (rules 8-14): the
// server validates every date, refuses a mark whose amount moved, keeps the caution in order, never
// lets the save write a payment state, and undoes with a confirmation naming the date and the entry.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const { skipWithout } = require('../plugins/sdk/testing');
const assert = require('node:assert/strict');
const { db, createStay, rowOf, liveQuote, save, mark } = require('./ledgerFixture');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

const rowIn = (quote, key) => quote.ledger.rows.find((r) => r.key === key);
const TODAY = getTodayIsoDate();

test('rule 8 — one action per due row; « Caisse interne » only on the complements', async () => {
  const id = createStay();
  db.prepare('UPDATE reservations SET complementAmount = 24 WHERE id = ?').run(id);
  const q = await liveQuote(id);
  assert.deepEqual(rowIn(q, 'deposit').action, { kind: 'mark', label: 'Marquer perçu', dateLabel: 'Perçu le' });
  assert.deepEqual(rowIn(q, 'balance').action, { kind: 'mark', label: 'Marquer perçu', dateLabel: 'Perçu le' });
  assert.equal(rowIn(q, 'cautionReceived').action.label, 'Recevoir');
  const stored = await liveQuote(id, { complementAmountOverride: 24 });
  assert.equal(rowIn(stored, 'complement').action.cash, true);
  assert.equal(rowIn(q, 'deposit').action.cash, undefined, 'no caisse interne on the acompte');
  assert.equal(rowIn(q, 'balance').action.cash, undefined, 'no caisse interne on the solde');
});

test('rule 9 — a future date is refused, nothing is written', () => {
  const id = createStay();
  const res = mark(id, { depositPaid: true, depositPaidDate: '2099-01-01' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Un encaissement ne peut pas être daté dans le futur.');
  assert.equal(res.body.field, 'depositPaidDate');
  assert.equal(rowOf(id).depositPaid, 0);
  const bad = mark(id, { balancePaid: true, balancePaidDate: '2026-02-31' });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, 'Date invalide.');
  const caution = mark(id, { cautionReceived: true, cautionReceivedDate: '2099-01-01' });
  assert.equal(caution.statusCode, 400);
});

test('rule 9 — a date before the reservation was created is accepted (stays entered after the fact)', () => {
  const id = createStay();
  const created = String(rowOf(id).createdAt).slice(0, 10);
  assert.ok('2020-01-15' < created);
  const res = mark(id, { depositPaid: true, depositPaidDate: '2020-01-15' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(id).depositPaidDate, '2020-01-15');
});

test('rule 9 — today is accepted', () => {
  const id = createStay();
  assert.equal(mark(id, { depositPaid: true, depositPaidDate: TODAY }).statusCode, 200);
});

test('rule 11 — the mark carries the amount the operator saw: one cent off → 409 AMOUNT_CHANGED, nothing recorded', () => {
  const id = createStay();
  const stored = Math.round(rowOf(id).depositAmount * 100);
  const off = mark(id, { depositPaid: true, depositPaidDate: TODAY, expectedAmountCents: stored + 1 });
  assert.equal(off.statusCode, 409);
  assert.deepEqual(off.body, { error: 'Le montant a changé entre-temps : relire la fiche.', code: 'AMOUNT_CHANGED' });
  assert.equal(rowOf(id).depositPaid, 0);
  const exact = mark(id, { depositPaid: true, depositPaidDate: TODAY, expectedAmountCents: stored });
  assert.equal(exact.statusCode, 200);
  assert.equal(rowOf(id).depositPaid, 1);
  const bal = mark(id, { balancePaid: true, balancePaidDate: TODAY, expectedAmountCents: Math.round(rowOf(id).balanceAmount * 100) - 1 });
  assert.equal(bal.statusCode, 409);
});

test('rule 11 — on a deferred complement the expected amount is the merged one', () => {
  const id = createStay();
  db.prepare('UPDATE reservations SET complementAmount = 24, endOfStayComplementAmount = 12, complementDeferredToCheckout = 1 WHERE id = ?').run(id);
  assert.equal(mark(id, { complementPaid: true, complementPaidDate: TODAY, expectedAmountCents: 2400 }).statusCode, 409);
  assert.equal(mark(id, { complementPaid: true, complementPaidDate: TODAY, expectedAmountCents: 3600 }).statusCode, 200);
  assert.equal(rowOf(id).endOfStayComplementPaid, 1);
});

test('rule 12 — the caution follows the order of events', () => {
  const id = createStay();
  const early = mark(id, { cautionReturned: true, cautionReturnedDate: TODAY });
  assert.equal(early.statusCode, 409);
  assert.deepEqual(early.body, { error: 'La caution n\'a pas encore été reçue.', code: 'CAUTION_NOT_RECEIVED' });
  assert.equal(rowOf(id).cautionReturned, 0);

  assert.equal(mark(id, { cautionReceived: true, cautionReceivedDate: '2026-08-14' }).statusCode, 200);
  const before = mark(id, { cautionReturned: true, cautionReturnedDate: '2026-08-10' });
  assert.equal(before.statusCode, 400);
  assert.equal(before.body.error, 'Restitution avant la réception (14/08).');
  assert.equal(mark(id, { cautionReturned: true, cautionReturnedDate: '2026-08-21' }).statusCode, 200);
  const row = rowOf(id);
  assert.deepEqual([row.cautionReceived, row.cautionReturned, row.cautionReturnedDate], [1, 1, '2026-08-21']);
});

// specs/single-payment-from-the-fiche.md rule 11bis — extended to the caution columns.
test('rule 13 — the save never writes a payment state: forged caution columns are ignored', async () => {
  const id = createStay();
  const res = await save(id, { cautionReceived: true, cautionReceivedDate: '2026-08-01', cautionReturned: true, cautionReturnedDate: '2026-08-02' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = rowOf(id);
  assert.deepEqual([row.cautionReceived, row.cautionReceivedDate, row.cautionReturned, row.cautionReturnedDate], [0, null, 0, null]);

  mark(id, { cautionReceived: true, cautionReceivedDate: '2026-08-14' });
  const clear = await save(id, { cautionReceived: false, cautionReceivedDate: '' });
  assert.equal(clear.statusCode, 200);
  assert.equal(rowOf(id).cautionReceived, 1, 'a stale form cannot un-receive the caution either');
});

test('rule 13 — same on a past-locked fiche: the caution columns left the locked whitelist', async () => {
  const id = createStay();
  db.prepare("UPDATE reservations SET startDate = '2026-01-10', endDate = '2026-01-13', depositDueDate = NULL, depositAmount = 0, balanceAmount = 307.2 WHERE id = ?").run(id);
  const res = await save(id, { startDate: '2026-01-10', endDate: '2026-01-13', cautionReturned: true, cautionReturnedDate: '2026-01-13' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(id).cautionReturned, 0);
});

test('rule 14 — undo asks for a confirmation naming the date and the accounting entry', async () => {
  const id = createStay();
  mark(id, { depositPaid: true, depositPaidDate: '2026-08-12' });
  mark(id, { cautionReceived: true, cautionReceivedDate: '2026-08-14' });
  mark(id, { cautionReturned: true, cautionReturnedDate: '2026-08-21' });
  const q = await liveQuote(id);
  const deposit = rowIn(q, 'deposit');
  assert.equal(deposit.action.kind, 'undo');
  assert.equal(deposit.action.label, 'Annuler');
  assert.equal(deposit.action.confirm, 'Annuler la perception de l\'acompte du 12/08/2026 ? L\'écriture comptable correspondante disparaît.');
  assert.equal(rowIn(q, 'cautionReceived').action.confirm, 'Annuler la réception de la caution du 14/08/2026 ? La restitution est annulée aussi.');
});

test('rule 14 — undoing « Caution reçue » also undoes « Caution restituée »; undoing the acompte un-ticks it', () => {
  const id = createStay();
  mark(id, { depositPaid: true, depositPaidDate: '2026-08-12' });
  mark(id, { cautionReceived: true, cautionReceivedDate: '2026-08-14' });
  mark(id, { cautionReturned: true, cautionReturnedDate: '2026-08-21' });
  assert.equal(mark(id, { cautionReceived: false }).statusCode, 200);
  const row = rowOf(id);
  assert.deepEqual([row.cautionReceived, row.cautionReceivedDate, row.cautionReturned, row.cautionReturnedDate], [0, null, 0, null]);
  assert.equal(mark(id, { depositPaid: false }).statusCode, 200);
  assert.equal(rowOf(id).depositPaid, 0);
});

test('rule 14 — undoing a bucket of a single payment names the dissolved group', async () => {
  const id = createStay({ depositDisabled: 1 });
  db.prepare('UPDATE reservations SET complementAmount = 24 WHERE id = ?').run(id);
  const group = JSON.stringify({ at: '2026-08-14', cash: 0, total: 331.2, buckets: ['balance', 'complement'] });
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2026-08-14', complementPaid = 1, complementPaidDate = '2026-08-14', arrivalPaymentGroup = ? WHERE id = ?")
    .run(group, id);
  const q = await liveQuote(id, { depositDisabled: 1 });
  const balance = rowIn(q, 'balance');
  assert.equal(balance.stateLabel, 'Perçu le 14/08/2026 · paiement unique');
  assert.match(balance.action.confirm, /Le paiement unique du 14\/08\/2026 est dissous\.$/);
  assert.equal(mark(id, { balancePaid: false }).statusCode, 200);
  assert.equal(rowOf(id).arrivalPaymentGroup, null, 'single-payment-at-check-in rule 17 — the group is dissolved');
});

test('rule 32 — a zero bucket is never marked: no action on the row, and the server refuses the mark', async () => {
  const id = createStay();
  // A converted devis carrying a 0 € acompte (Solio 22293, 22296).
  db.prepare('UPDATE reservations SET depositAmount = 0, depositAmountOverride = 0 WHERE id = ?').run(id);
  const q = await liveQuote(id, { depositAmountOverride: 0 });
  const deposit = rowIn(q, 'deposit');
  assert.equal(deposit.stateLabel, 'Aucun acompte');
  assert.equal(deposit.action, null);
  const res = mark(id, { depositPaid: true, depositPaidDate: TODAY });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'Rien à percevoir sur cette échéance.', code: 'NOTHING_TO_COLLECT', field: 'depositPaid' });
  assert.equal(rowOf(id).depositPaid, 0);
  assert.equal(mark(id, { complementPaid: true, complementPaidDate: TODAY }).statusCode, 409, 'no complement either');
  assert.equal(mark(id, { complementPaidCash: true }).statusCode, 409, 'nor through the caisse interne');
});

test('rule 32 — a 0 € acompte already stored as perceived is shown with a warning', async () => {
  const id = createStay();
  db.prepare("UPDATE reservations SET depositAmount = 0, depositAmountOverride = 0, depositPaid = 1, depositPaidDate = '2026-09-01' WHERE id = ?").run(id);
  const q = await liveQuote(id, { depositAmountOverride: 0 });
  assert.deepEqual(rowIn(q, 'deposit').detail.warnings.map((w) => w.label), [`Acompte de ${require('../utils/reservationLedger').formatEuros(0)} marqué perçu`]);
});

test('rule 26 — « Marquer reçu » asks for the transfer: the server words the gap and the commission it implies', () => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  require('../controllers/reservationsController').platformCommission({ body: { gross: 987.39, payout: 817.39, expectedNet: 829.42 } }, res);
  assert.equal(res.body.gap, 12.03);
  assert.equal(res.body.gapLabel, 'Écart : 12,03\u00a0€ avec le net attendu');
  assert.equal(res.body.commission, 170);
  assert.equal(res.body.commissionLabel, 'Commission solde → 170,00\u00a0€');
  const same = { ...res, body: null };
  require('../controllers/reservationsController').platformCommission({ body: { gross: 987.39, payout: 829.42, expectedNet: 829.42 } }, same);
  assert.equal(same.body.gapLabel, null);
});

// Review of #727 (B1) — a payout received on a past, locked stay: the transfer and the commission
// ride the mark, no full save, nothing re-priced.
test('rule 34 — « Marquer reçu » writes the transfer and the commission with the mark, on a past locked stay', () => {
  const id = createStay({ platform: 'Booking' });
  db.prepare("UPDATE reservations SET startDate = '2026-01-10', endDate = '2026-01-13' WHERE id = ?").run(id);
  const before = rowOf(id);
  const res = mark(id, { balancePaid: true, balancePaidDate: '2026-01-20', platformPayoutAmount: 260.5, platformCommissionAmount: 46.7,
    expectedAmountCents: Math.round(before.balanceAmount * 100) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const after = rowOf(id);
  assert.deepEqual([after.balancePaid, after.platformPayoutAmount, after.platformCommissionAmount], [1, 260.5, 46.7]);
  assert.deepEqual([after.balanceAmount, after.finalPrice], [before.balanceAmount, before.finalPrice], 'nothing re-priced');
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id).map((h) => h.changedFields).join(' ');
  assert.match(history, /Virement reçu/);
});

test('rule 34 — the transfer is refused without the reception, and when not a money amount', () => {
  const id = createStay({ platform: 'Booking' });
  assert.equal(mark(id, { platformPayoutAmount: 100 }).body.code, 'PAYOUT_WITHOUT_MARK');
  const bad = mark(id, { balancePaid: true, balancePaidDate: TODAY, platformPayoutAmount: -3 });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.field, 'platformPayoutAmount');
  assert.equal(rowOf(id).balancePaid, 0);
});

test('rule 11 — one expected amount for two marked buckets is refused', () => {
  const id = createStay();
  const r = rowOf(id);
  const res = mark(id, { depositPaid: true, balancePaid: true, depositPaidDate: TODAY, balancePaidDate: TODAY, expectedAmountCents: Math.round(r.depositAmount * 100) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'AMBIGUOUS_EXPECTED_AMOUNT');
  assert.equal(rowOf(id).depositPaid, 0);
});

// Review of #727 (B2) — undo then redo a received acompte must land on the same amount.
test('rule 35 — undoing a received acompte freezes it at the received amount, so redoing it is not refused', async () => {
  const id = createStay();
  const received = rowOf(id).depositAmount;
  mark(id, { depositPaid: true, depositPaidDate: TODAY, expectedAmountCents: Math.round(received * 100) });
  await save(id, { customPrice: 200 }); // the stay is re-priced after the acompte was received
  assert.equal(mark(id, { depositPaid: false }).statusCode, 200);
  assert.equal(rowOf(id).depositAmountOverride, received);
  const q = await liveQuote(id, { customPrice: 200, depositAmountOverride: received });
  const deposit = q.ledger.rows.find((r) => r.key === 'deposit');
  assert.equal(deposit.amount, received);
  const redo = mark(id, { depositPaid: true, depositPaidDate: TODAY, expectedAmountCents: Math.round(deposit.amount * 100) });
  assert.equal(redo.statusCode, 200, JSON.stringify(redo.body));
});

test('rule 33 — while the fiche is edited, a row whose amount the save would change shows the stored amount', async () => {
  const id = createStay();
  const q = await liveQuote(id, { customPrice: 250 });
  const balance = q.ledger.rows.find((r) => r.key === 'balance');
  assert.equal(balance.changesOnSave, true);
  assert.equal(balance.storedAmount, rowOf(id).balanceAmount);
  assert.match(balance.detail.pending, /^Enregistré : /);
  const same = (await liveQuote(id)).ledger.rows.find((r) => r.key === 'balance');
  assert.equal(same.changesOnSave, undefined);
});

test('rule 26 — no commission suggestion when the gap is the tourist tax, nor without a gross', () => {
  const ctl = require('../controllers/reservationsController');
  const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const tax = res();
  ctl.platformCommission({ body: { gross: 1000, payout: 829.6, expectedNet: 850, taxEstimate: 20.4 } }, tax);
  assert.equal(tax.body.commissionLabel, null);
  assert.match(tax.body.gapLabel, /taxe de séjour/);
  const noGross = res();
  ctl.platformCommission({ body: { gross: '', payout: 400, expectedNet: 838.92 } }, noGross);
  assert.equal(noGross.body.commissionLabel, null);
});

test('rule 32 — a stay imported without a price says « Prix à renseigner », never « En retard »', async () => {
  const id = createStay();
  db.prepare("UPDATE reservations SET finalPrice = 0, totalPrice = 0, depositAmount = 0, balanceAmount = 0, balanceDueDate = '2026-01-01' WHERE id = ?").run(id);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  require('../controllers/reservationsController').getById({ params: { id: String(id) }, user: { role: 'admin' } }, res);
  const balance = res.body.ledger.rows.find((r) => r.key === 'balance');
  assert.equal(balance.stateLabel, 'Prix à renseigner');
  assert.equal(balance.action, null);
  assert.equal(res.body.ledger.remaining, 0);
});

// Review of #727 (B1, Solio 11, 12, 22245) — a stay priced under an earlier rule: its stored solde no
// longer matches today's engine, the per-line capture cannot balance, the money is still recorded.
test('rule 37 — a payout on a stay whose stored amounts drifted is recorded, with a warning, nothing re-priced', () => {
  const id = createStay({ platform: 'Booking' });
  db.prepare('UPDATE reservations SET balanceAmount = balanceAmount - 50.4 WHERE id = ?').run(id);
  const before = rowOf(id);
  const res = mark(id, { balancePaid: true, balancePaidDate: TODAY, expectedAmountCents: Math.round(before.balanceAmount * 100), platformPayoutAmount: 200 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(res.body.warning, /la répartition comptable reprend les montants enregistrés/);
  const after = rowOf(id);
  assert.deepEqual([after.balancePaid, after.balanceAmount, after.finalPrice], [1, before.balanceAmount, before.finalPrice]);
});

// Second review of #727 (N1) — the solde recorded without its capture after a captured acompte: its
// entry must carry revenue and VAT, never land whole on the tourist-tax account.
function exportMonth(day) {
  const { create: accountingModel } = require('../plugins/accounting-export/accountingModel');
  const { create: accountingController } = require('../plugins/accounting-export/controller');
  let json = null;
  const res = { setHeader() {}, status() { return res; }, json(b) { json = b; return res; } };
  accountingController(accountingModel(db)).salesJson({ query: { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) } }, res);
  return json;
}

test('rule 37 — acompte captured, solde recorded on drifted amounts: revenue and VAT, never all on 46710000', { skip: skipWithout(['accounting-export']) }, () => {
  const id = createStay();
  mark(id, { depositPaid: true, depositPaidDate: TODAY, expectedAmountCents: Math.round(rowOf(id).depositAmount * 100) });
  db.prepare('UPDATE reservations SET balanceAmount = round(balanceAmount + 30, 2), finalPrice = round(finalPrice + 30, 2) WHERE id = ?').run(id);
  const res = mark(id, { balancePaid: true, balancePaidDate: TODAY, expectedAmountCents: Math.round(rowOf(id).balanceAmount * 100) });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.warning);
  const history = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'payment_capture_failed'").get(id);
  assert.match(history.changedFields, /Encaissement \(solde\)/, 'worded by origin: a mark on the fiche, not an online payment');
  const month = exportMonth(TODAY);
  assert.equal(month.totals.allBalanced, true);
  const balance = month.entries.find((e) => e.reservationId === id && e.kind === 'balance');
  const credits = balance.lines.filter((l) => Number(l.credit) > 0);
  assert.ok(credits.some((l) => l.compte !== '46710000'), JSON.stringify(balance.lines));
  assert.ok(credits.some((l) => /^706/.test(l.compte)), 'revenue credited');
  assert.ok(credits.some((l) => l.compte === '44571100'), 'VAT credited');
});

test('export invariant — no sale entry of the month has all its credits on the tourist-tax account', { skip: skipWithout(['accounting-export']) }, () => {
  const month = exportMonth(TODAY);
  for (const entry of month.entries.filter((e) => e.direction === 'sale' && e.kind !== 'tip')) {
    const credits = entry.lines.filter((l) => Number(l.credit) > 0);
    if (credits.length === 0) continue;
    assert.ok(credits.some((l) => l.compte !== '46710000'), `entry ${entry.reservationId}/${entry.kind} credits only 46710000`);
  }
});

// Second review of #727 (N2) — an already received bucket is never marked again.
test('rule 38 — marking an already perceived bucket is refused (409 ALREADY_PAID), its date and figures untouched', () => {
  const id = createStay({ platform: 'Booking' });
  const cents = Math.round(rowOf(id).balanceAmount * 100);
  assert.equal(mark(id, { balancePaid: true, balancePaidDate: '2026-07-24', expectedAmountCents: cents, platformPayoutAmount: 200 }).statusCode, 200);
  // A second tab sends the same mark, with the same expected amount.
  const again = mark(id, { balancePaid: true, balancePaidDate: TODAY, expectedAmountCents: cents, platformCommissionAmount: 999, platformPayoutAmount: 1 });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.code, 'ALREADY_PAID');
  const row = rowOf(id);
  assert.deepEqual([row.balancePaidDate, row.platformPayoutAmount, row.platformCommissionAmount ?? null], ['2026-07-24', 200, null]);
  for (const field of ['cautionReceived']) {
    mark(id, { [field]: true, [`${field}Date`]: TODAY });
    assert.equal(mark(id, { [field]: true, [`${field}Date`]: TODAY }).body.code, 'ALREADY_PAID');
  }
});

test('rule 34 — the transfer is refused on a direct stay, and a commission above the billed amount', () => {
  const direct = createStay();
  const d = mark(direct, { balancePaid: true, balancePaidDate: TODAY, platformCommissionAmount: 999 });
  assert.equal(d.statusCode, 400);
  assert.equal(d.body.code, 'PAYOUT_NOT_PLATFORM');
  assert.equal(rowOf(direct).balancePaid, 0);
  const booking = createStay({ platform: 'Booking' });
  const big = mark(booking, { balancePaid: true, balancePaidDate: TODAY, platformCommissionAmount: 10000 });
  assert.equal(big.statusCode, 400);
  assert.match(big.body.error, /La commission dépasse le montant facturé/);
});

// Second review of #727 (H-b) — the headline of the sticky bar, from the stored row.
test('rule 39 — the fiche carries a headline built from the stored row (« Vous percevez » = Finance net)', () => {
  const id = createStay({ platform: 'Booking' });
  db.prepare('UPDATE reservations SET platformCommissionAmount = 46.08 WHERE id = ?').run(id);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  require('../controllers/reservationsController').getById({ params: { id: String(id) }, user: { role: 'admin' } }, res);
  const row = rowOf(id);
  assert.equal(res.body.storedHeadline.label, 'Vous percevez');
  assert.equal(res.body.storedHeadline.amount, Math.round((row.balanceAmount - 46.08) * 100) / 100);
});

test('rule 26 — with the commission unknown, the typed transfer proposes the commission from the gross', () => {
  const ctl = require('../controllers/reservationsController');
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  ctl.platformCommission({ body: { gross: 706, payout: 600, forMark: true } }, res);
  assert.equal(res.body.gapLabel, null);
  assert.equal(res.body.commission, 106);
  assert.match(res.body.commissionLabel, /^Commission solde → 106,00/);
});

// Third review of #727 (N1-bis) — every capture path shares the stored-amount fallback: the single
// payment from the fiche, its adjustment, and the SAS stay payment (production stay 22224's cause).
function assertNoTaxOnlyEntry(month) {
  assert.equal(month.totals.allBalanced, true);
  assert.deepEqual(month.totals.taxOnlyEntries, [], JSON.stringify(month.totals.taxOnlyEntries));
}
function driftedStayWithCapturedAcompte(extra = {}) {
  const id = createStay(extra);
  mark(id, { depositPaid: true, depositPaidDate: TODAY, expectedAmountCents: Math.round(rowOf(id).depositAmount * 100) });
  db.prepare('UPDATE reservations SET balanceAmount = round(balanceAmount + 30, 2), finalPrice = round(finalPrice + 30, 2), clientGrossAmount = NULL WHERE id = ?').run(id);
  return id;
}

test('rule 42 — « Encaisser en une fois » on drifted amounts: the solde gets the stored-amount split', { skip: skipWithout(['accounting-export']) }, () => {
  const id = driftedStayWithCapturedAcompte();
  db.prepare('UPDATE reservations SET complementAmount = 24 WHERE id = ?').run(id);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  require('../controllers/reservationsController').settleArrivalPayment({ params: { id: String(id) }, body: { mode: 'card', date: TODAY }, user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(id).balancePaid, 1);
  assert.ok(rowOf(id).accommodationSoldeContribTtc > 0);
  assertNoTaxOnlyEntry(exportMonth(TODAY));
  // …and its adjustment (a réduction accordée) keeps the journal sound.
  const adjust = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  require('../controllers/reservationsController').settleArrivalPayment({ params: { id: String(id) }, body: { mode: 'adjust', total: 250 }, user: { role: 'admin' } }, adjust);
  assert.equal(adjust.statusCode, 200, JSON.stringify(adjust.body));
  assertNoTaxOnlyEntry(exportMonth(TODAY));
});

test('rule 42 — the SAS stay payment on drifted amounts: the stored-amount split, never all on 46710000', { skip: skipWithout(['accounting-export']) }, () => {
  const id = driftedStayWithCapturedAcompte();
  require('../models/reservationsModel').commitArrivalSas(id, { stayPaid: true, stayPaidCash: false });
  assert.equal(rowOf(id).balancePaid, 1);
  assert.ok(rowOf(id).accommodationSoldeContribTtc > 0);
  assertNoTaxOnlyEntry(exportMonth(TODAY));
});

test('rule 42 — the shared capture never throws: with no possible split it logs and leaves NULL', () => {
  const { captureBucketSplit } = require('../utils/forceItemContribsCapture');
  const logged = [];
  const outcome = captureBucketSplit({ db, reservation: null, bucket: 'balance', log: { error: (m) => logged.push(m) } });
  assert.equal(outcome, 'none');
  assert.equal(logged.length, 1);
});

test('rule 43 — the export announces an entry whose credits are all on the tourist-tax account', { skip: skipWithout(['accounting-export']) }, () => {
  const { __test } = require('../plugins/accounting-export/controller');
  const entries = [
    { direction: 'sale', reservationId: 1, kind: 'balance', libelle: 'A', paidDate: '2026-06-19', encaissementTtc: 67.13,
      lines: [{ compte: 'CA', debit: 67.13 }, { compte: '46710000', credit: 67.13 }] },
    { direction: 'sale', reservationId: 2, kind: 'balance', libelle: 'B', encaissementTtc: 100,
      lines: [{ compte: 'CB', debit: 100 }, { compte: '70600000', credit: 90.91 }, { compte: '44571100', credit: 9.09 }] },
  ];
  assert.deepEqual(__test.taxOnlyEntries(entries), [{ reservationId: 1, kind: 'balance', libelle: 'A', paidDate: '2026-06-19', amount: 67.13 }]);
});

// Third review of #727 — the pricing summary's money figures, stored, for the rule-39 switch.
test('rule 44 — the fiche carries the stored money figures of the pricing summary', () => {
  const id = createStay({ platform: 'Booking' });
  db.prepare('UPDATE reservations SET platformCommissionAmount = 46.08, touristTaxTotal = 0 WHERE id = ?').run(id);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  require('../controllers/reservationsController').getById({ params: { id: String(id) }, user: { role: 'admin' } }, res);
  const row = rowOf(id);
  const summary = res.body.storedSummary;
  assert.equal(summary.finalPrice, row.finalPrice);
  assert.equal(summary.platformNetReceivedAmount, Math.round((row.balanceAmount - 46.08) * 100) / 100);
  assert.equal(summary.sejourNetTotal, res.body.storedHeadline.amount, 'the summary and the bar say the same net');
});

// Final review of #727 — a drifted stay: the stored summary carries every money figure and date as
// stored, and the live quote says it differs (so the fiche never mixes the two).
test('rule 45 — on a drifted stay every figure and date of the stored summary is the stored one', async () => {
  const id = createStay();
  db.prepare("UPDATE reservations SET finalPrice = 330, balanceAmount = round(balanceAmount + 30, 2), balanceDueDate = '2027-01-15' WHERE id = ?").run(id);
  const row = rowOf(id);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  require('../controllers/reservationsController').getById({ params: { id: String(id) }, user: { role: 'admin' } }, res);
  const s = res.body.storedSummary;
  assert.equal(s.finalPrice, row.finalPrice);
  assert.equal(s.accommodation, 330, 'no option on the stay: the whole stored price');
  assert.equal(s.depositAmount, row.depositAmount);
  assert.equal(s.balanceAmount, row.balanceAmount);
  assert.equal(s.touristTaxTotal, row.touristTaxTotal);
  assert.equal(s.totalStayPrice, Math.round((row.finalPrice + row.touristTaxTotal) * 100) / 100);
  assert.equal(s.totalVatAmount, 30, '10 % of 330 TTC');
  assert.equal(s.totalNetPrice, 300);
  assert.equal(s.depositDueDate, row.depositDueDate);
  assert.equal(s.balanceDueDate, '2027-01-15');
  const live = await liveQuote(id);
  assert.equal(live.storedDrift, true, 'today\'s quote differs: the fiche shows the stored summary whole');
  const clean = createStay();
  assert.equal((await liveQuote(clean)).storedDrift, false);
});
