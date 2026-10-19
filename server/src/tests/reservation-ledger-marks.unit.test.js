// specs/reservation-payment-ledger.md §3.2 — recording a movement from the ledger (rules 8-14): the
// server validates every date, refuses a mark whose amount moved, keeps the caution in order, never
// lets the save write a payment state, and undoes with a confirmation naming the date and the entry.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createStay, rowOf, liveQuote, save, mark } = require('./ledgerFixture');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

const rowIn = (quote, key) => quote.ledger.rows.find((r) => r.key === key);
const TODAY = getTodayIsoDate();

test('rule 8 — one action per due row; « Caisse interne » only on the complements', async () => {
  const id = createStay();
  db.prepare('UPDATE reservations SET complementAmount = 24 WHERE id = ?').run(id);
  const q = await liveQuote(id);
  assert.deepEqual(rowIn(q, 'deposit').action, { kind: 'mark', label: 'Marquer perçu' });
  assert.deepEqual(rowIn(q, 'balance').action, { kind: 'mark', label: 'Marquer perçu' });
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
