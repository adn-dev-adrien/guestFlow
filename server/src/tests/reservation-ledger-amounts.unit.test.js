// specs/reservation-payment-ledger.md §3.3 — setting the acompte and the solde from the ledger
// (rules 15-23; UI/UX review 2026-10-18 decision 8: « il faut quand même pouvoir setter les montants »,
// §9 Q1 decided 2026-10-19). Driven through the real calculate-price and save of the fiche, on the
// real engine: the stay is 3 nights at 100 € for two adults, tax 1,20 € per adult and night
// (H = 300 €, T = 7,20 €, P = 307,20 €, acompte 30 % = 90 €).

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createStay, rowOf, liveQuote, save, mark } = require('./ledgerFixture');
const { formatEuros: eur } = require('../utils/reservationLedger');
const { parseAmount } = require('../utils/ledgerAmountEdit');

const edit = async (id, row, amount, over = {}) => (await liveQuote(id, { ledgerEdit: { row, amount }, ...over })).ledgerEdit;
const rowIn = (quote, key) => quote.ledger.rows.find((r) => r.key === key);

test('rule 15 — every row says whether its amount can be edited, between which bounds, and why not', async () => {
  const id = createStay();
  const q = await liveQuote(id);
  assert.deepEqual(
    [rowIn(q, 'deposit').amountEdit.editable, rowIn(q, 'deposit').amountEdit.min, rowIn(q, 'deposit').amountEdit.max],
    [true, 0, 300],
  );
  assert.deepEqual([rowIn(q, 'balance').amountEdit.mode, rowIn(q, 'balance').amountEdit.min, rowIn(q, 'balance').amountEdit.max], ['split', 7.2, 307.2]);
  mark(id, { depositPaid: true, depositPaidDate: '2026-10-01' });
  const paid = await liveQuote(id);
  assert.equal(rowIn(paid, 'deposit').amountEdit.editable, false);
  assert.equal(rowIn(paid, 'deposit').amountEdit.reason, 'Acompte perçu le 01/10/2026 : annuler la perception pour corriger le montant.');
  assert.equal(rowIn(paid, 'balance').amountEdit.mode, 'price', 'acompte perçu → a different solde is a different price');
});

test('rule 16 — acompte 0 ≤ A ≤ H: 0 and H accepted, H + 0,01 and −1 refused in French', async () => {
  const id = createStay();
  const zero = await edit(id, 'deposit', 0);
  assert.equal(zero.ok, true);
  assert.deepEqual(zero.formPatch, { depositAmountOverride: 0, ledgerAmountEdit: 'deposit' });
  const atH = await edit(id, 'deposit', 300);
  assert.equal(atH.ok, true);
  assert.deepEqual(atH.effects, [`Solde : ${eur(217.2)} → ${eur(7.2)}`]);
  const above = await edit(id, 'deposit', 300.01);
  assert.equal(above.ok, false);
  assert.equal(above.reason, `L'acompte ne dépasse pas l'hébergement (${eur(300)}) : la taxe de séjour reste sur le solde.`);
  const negative = await edit(id, 'deposit', -1);
  assert.equal(negative.reason, 'Un montant ne peut pas être négatif.');
});

test('rule 16 — emptying the acompte restores the percentage: the row offers the reset patch', async () => {
  const id = createStay({ depositAmountOverride: 120 });
  const q = await liveQuote(id, { depositAmountOverride: 120 });
  assert.deepEqual(rowIn(q, 'deposit').amountEdit.reset, { label: 'Calcul automatique', patch: { depositAmountOverride: '' } });
  assert.equal(rowIn(q, 'deposit').detail.hint, `Montant fixé · calcul auto ${eur(90)}`);
});

test('rule 17 — solde with the acompte unpaid: T ≤ S ≤ P sets the split, not the price', async () => {
  const id = createStay();
  const belowTax = await edit(id, 'balance', 7.19);
  assert.equal(belowTax.reason, `Le solde porte la taxe de séjour (${eur(7.2)}) : pas en dessous.`);
  const atTax = await edit(id, 'balance', 7.2);
  assert.deepEqual(atTax.formPatch, { depositAmountOverride: 300, ledgerAmountEdit: 'balance' });
  const atP = await edit(id, 'balance', 307.2);
  assert.deepEqual(atP.formPatch, { depositAmountOverride: 0, ledgerAmountEdit: 'balance' });
  const aboveP = await edit(id, 'balance', 307.21);
  assert.equal(aboveP.reason, `Au-delà du séjour (${eur(307.2)}) : modifier le prix de l'hébergement.`);

  const ok = await edit(id, 'balance', 250);
  assert.deepEqual(ok.effects, [`Acompte : ${eur(90)} → ${eur(57.2)} · total inchangé`]);
  // Applying the patch: the total of the stay does not move, the solde is the one typed.
  const after = await liveQuote(id, ok.formPatch);
  assert.equal(after.balanceAmount, 250);
  assert.equal(after.depositAmount, 57.2);
  assert.equal(after.preArrivalAmount, 307.2);
});

test('rule 17 — a later price drop under the frozen acompte: the engine clamps it and the row says so', async () => {
  const id = createStay();
  const q = await liveQuote(id, { depositAmountOverride: 250, customPrice: 200 });
  assert.equal(rowIn(q, 'deposit').amount, 200);
  assert.deepEqual(rowIn(q, 'deposit').detail.warnings, [{ tone: 'warning', label: `Acompte ramené à ${eur(200)} : l'hébergement a baissé` }]);
});

test('rule 18 — solde with the acompte perceived: the whole engine finds the accommodation price', async () => {
  const id = createStay();
  mark(id, { depositPaid: true, depositPaidDate: '2026-10-01' });
  const res = await edit(id, 'balance', 150);
  assert.equal(res.ok, true);
  assert.equal(res.reached, 150);
  assert.deepEqual(res.effects, [`Hébergement : ${eur(300)} → ${eur(232.8)}`]);
  assert.deepEqual(res.formPatch, { customPrice: 232.8, ledgerAmountEdit: 'balance' });
  const applied = await liveQuote(id, res.formPatch);
  assert.equal(applied.balanceAmount, 150, '« Valider » applies a value the engine produced');
});

test('rule 18 — the tourist tax follows the accommodation: nearest reachable cent, said', async () => {
  const id = createStay({ propertyId: 2 });
  mark(id, { depositPaid: true, depositPaidDate: '2026-10-01' });
  let unreachable = null;
  for (let cents = 15000; cents < 15100 && !unreachable; cents += 1) {
    const res = await edit(id, 'balance', cents / 100, { propertyId: 2 });
    assert.equal(res.ok, true);
    assert.ok(Math.abs(res.reached * 100 - cents) <= 7, `${cents / 100} reached ${res.reached}`);
    if (Math.round(res.reached * 100) !== cents) unreachable = { target: cents / 100, res };
  }
  assert.ok(unreachable, 'the percentage tax rounds in steps: some soldes are not reachable to the cent');
  const { res } = unreachable;
  assert.equal(res.effects.at(-1), `Solde obtenu : ${eur(res.reached)} (au centime près, la taxe suit l'hébergement)`);
  assert.match(res.effects[0], /^Hébergement : .* · taxe de séjour /);
  const applied = await liveQuote(id, { propertyId: 2, ...res.formPatch });
  assert.equal(applied.balanceAmount, res.reached);
});

test('rule 18 — a stay carrying a cancellation insurance: the percentage option is re-priced too', async () => {
  const res = (await liveQuote(null, {
    propertyId: 2, depositDisabled: 1, selectedOptions: [{ optionId: 10, quantity: 1 }],
    ledgerEdit: { row: 'balance', amount: 250 },
  })).ledgerEdit;
  assert.equal(res.ok, true);
  assert.ok(res.effects.some((e) => e.startsWith('Assurance annulation : ')), res.effects.join(' | '));
  const applied = await liveQuote(null, { propertyId: 2, depositDisabled: 1, selectedOptions: [{ optionId: 10, quantity: 1 }], ...res.formPatch });
  assert.equal(applied.balanceAmount, res.reached);
});

test('rule 18 — floor: the accommodation never falls below the acompte received', async () => {
  const id = createStay();
  mark(id, { depositPaid: true, depositPaidDate: '2026-10-01' });
  const res = await edit(id, 'balance', 1);
  // H' = A = 90 € → solde = the tax alone, 7,20 €.
  assert.equal(res.reason, `Pas en dessous de ${eur(7.2)} : l'acompte perçu (${eur(90)}) couvre déjà l'hébergement.`);
  const atFloor = await edit(id, 'balance', 7.2);
  assert.equal(atFloor.ok, true);
  assert.deepEqual(atFloor.formPatch, { customPrice: 90, ledgerAmountEdit: 'balance' });
});

test('rule 18 — no acompte at all: a different solde is a different price', async () => {
  const id = createStay({ depositDisabled: 1 });
  const q = await liveQuote(id, { depositDisabled: 1, ledgerEdit: { row: 'balance', amount: 207.2 } });
  assert.equal(rowIn(q, 'deposit').stateLabel, 'Sans objet · acompte désactivé');
  assert.equal(rowIn(q, 'balance').amount, 307.2);
  assert.deepEqual(q.ledgerEdit.formPatch, { customPrice: 200, ledgerAmountEdit: 'balance' });
});

test('rule 19 — a perceived row keeps what it collected: lower → refund, higher → undo then redo', async () => {
  const id = createStay({ depositDisabled: 1 });
  const marked = mark(id, { balancePaid: true, balancePaidDate: '2026-10-02' });
  assert.equal(marked.statusCode, 200, JSON.stringify(marked.body));
  const lower = await edit(id, 'balance', 300, { depositDisabled: 1 });
  assert.equal(lower.reason, `Déjà perçu : ${eur(307.2)}. Pour rendre ${eur(7.2)}, créer un remboursement.`);
  assert.deepEqual(lower.refund, { amount: 7.2, label: 'Créer le remboursement' });
  const higher = await edit(id, 'balance', 400, { depositDisabled: 1 });
  assert.equal(higher.reason, `Déjà perçu : ${eur(307.2)}. Pour un autre montant, annuler la perception puis la refaire.`);

  const dep = createStay();
  mark(dep, { depositPaid: true, depositPaidDate: '2026-10-01' });
  const depLower = await edit(dep, 'deposit', 50);
  assert.equal(depLower.reason, `Déjà perçu : ${eur(90)}. Pour rendre ${eur(40)}, créer un remboursement.`);
});

test('rule 20 — a paid solde freezes the acompte', async () => {
  const id = createStay();
  // The unusual order (solde perceived before the acompte), written as stored data.
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2026-10-02' WHERE id = ?").run(id);
  const deposit = await edit(id, 'deposit', 50);
  assert.equal(deposit.reason, 'Solde déjà perçu : l\'acompte ne peut plus changer.');
  const q = await liveQuote(id);
  assert.equal(rowIn(q, 'deposit').amountEdit.mode, 'locked');
});

test('rule 21 — the field accepts « 12,5 », « 100+20 », rounds a third decimal, refuses the unreadable', async () => {
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount('12.5'), 12.5);
  assert.equal(parseAmount('100+20'), 120);
  assert.equal(parseAmount('12,345'), 12.35);
  assert.equal(parseAmount('1 197,00 €'), 1197);
  assert.equal(parseAmount('abc'), null);
  const id = createStay();
  const res = await edit(id, 'deposit', '100+20');
  assert.equal(res.amount, 120);
  assert.equal((await edit(id, 'deposit', 'x')).reason, 'Montant illisible : chiffres, virgule, + et − seulement.');
});

// specs/editable-deposit-amount.md rule 4 (amended) — refused above the accommodation, not clamped.
test('rule 21 — the save re-validates: a crafted acompte above H gets the same refusal (400)', async () => {
  const id = createStay();
  const res = await save(id, { depositAmountOverride: 400 });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, `L'acompte ne dépasse pas l'hébergement (${eur(300)}) : la taxe de séjour reste sur le solde.`);
  assert.equal(rowOf(id).depositAmountOverride, null, 'nothing written');
  const ok = await save(id, { depositAmountOverride: 120 });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(rowOf(id).depositAmount, 120);
});

test('rule 21 — a crafted solde under the floor is refused at save too', async () => {
  const id = createStay();
  mark(id, { depositPaid: true, depositPaidDate: '2026-10-01' });
  const res = await save(id, { customPrice: 50, ledgerAmountEdit: 'balance' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, `Pas en dessous de ${eur(7.2)} : l'acompte perçu (${eur(90)}) couvre déjà l'hébergement.`);
});

test('rule 22 — complements keep their own adjustment: their rows edit through the complement detail', async () => {
  const id = createStay();
  db.prepare('UPDATE reservations SET complementAmount = 24 WHERE id = ?').run(id);
  const ledger = (await liveQuote(id, { complementAmountOverride: 24 })).ledger;
  const complement = ledger.rows.find((r) => r.key === 'complement');
  assert.ok(complement, JSON.stringify(ledger.rows.map((r) => r.key)));
  assert.equal(complement.amountEdit.mode, 'complement');
  assert.equal(complement.detail.slot, 'complement');
  assert.equal(complement.action.cash, true, 'the complement mark keeps its « Caisse interne » switch');
});

test('rule 23 — an amount set from the ledger is traced with a readable label', async () => {
  const id = createStay();
  const res = await save(id, { depositAmountOverride: 57.2, ledgerAmountEdit: 'balance' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const history = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'update' ORDER BY id DESC").get(id);
  const change = JSON.parse(history.changedFields).find((c) => c.field === 'ledgerBalanceAmount');
  assert.deepEqual(change, { field: 'ledgerBalanceAmount', label: 'Solde', from: eur(217.2), to: `${eur(250)} (acompte ${eur(57.2)})` });

  const res2 = await save(id, { depositAmountOverride: 100, ledgerAmountEdit: 'deposit' });
  assert.equal(res2.statusCode, 200);
  const last = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'update' ORDER BY id DESC").get(id);
  assert.deepEqual(JSON.parse(last.changedFields).find((c) => c.field === 'ledgerDepositAmount'),
    { field: 'ledgerDepositAmount', label: 'Acompte', from: eur(57.2), to: eur(100) });
});

test('edge case + rule 32 — solde typed equal to P keeps an explicit « Aucun acompte » row at 0 €, no deadline, no action', async () => {
  const id = createStay();
  const res = await save(id, { depositAmountOverride: 0, ledgerAmountEdit: 'balance' });
  assert.equal(res.statusCode, 200);
  const q = await liveQuote(id, { depositAmountOverride: 0 });
  const deposit = rowIn(q, 'deposit');
  assert.equal(deposit.amount, 0);
  assert.equal(deposit.stateLabel, 'Aucun acompte');
  assert.equal(deposit.action, null);
  assert.equal(deposit.amountEdit.editable, true);
  assert.equal(rowOf(id).depositDueDate, null);
});
