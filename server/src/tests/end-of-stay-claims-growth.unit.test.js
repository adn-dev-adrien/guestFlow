// specs/mid-stay-extras-to-end-of-stay-complement.md rule 20, reading of 2026-11-05 (D9, audit R22-1) — growth of a stay
// after solde and arrival complement are paid is claimed on the end-of-stay complement once the buckets are known to
// have agreed: the solde's contribs are captured and the pre-arrival money is settled. A legacy row stays unjudged.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, ADMIN, TODAY, rowOf, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, C, D, forced, free, fiche, put, pay, ficheView, unclaimed, inDays,
} = require('./moneyLedgerFixture');

const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const installmentsController = require('../controllers/installmentsController');

const EXCESS_KEY = 'arrivalComplementExcess';
const excessOf = (id) => (ficheView(id).ledger.rows || []).length && (JSON.parse(rowOf(id).endOfStayComplementDetail || '[]').find((line) => line.key === EXCESS_KEY) || {}).amount;

test('D9 — direct, solde and complement paid, one adult more: the whole 42,40 € is claimed at the end of stay', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).balanceAmount, 604.8);
  assert.equal(rowOf(stay.id).complementAmount, 20);
  assert.equal(ficheView(stay.id).ledger.remaining, 42.4);
  assert.equal(excessOf(stay.id), 42.4);
  assert.equal(unclaimed(stay.id), 0);
});

test('D9 — one night more: 302,40 € claimed, nothing left unclaimed', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { endDate: inDays(Math.round((Date.parse(stay.body.endDate) - Date.parse(inDays(0))) / 86400000) + 1) });
  assert.equal(ficheView(stay.id).ledger.remaining, 302.4);
  assert.equal(unclaimed(stay.id), 0);
});

test('D9 — the same with the acompte paid too', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, D, S, C);
  await put(stay, { adults: 3 });
  assert.equal(ficheView(stay.id).ledger.remaining, 42.4);
  assert.equal(unclaimed(stay.id), 0);
});

test('D9 — tax routed to the complement: the tax alone used to be claimed, now the accommodation too', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { touristTaxInComplement: 1, customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  assert.equal(ficheView(stay.id).ledger.remaining, 42.4);
  assert.equal(unclaimed(stay.id), 0);
});

test('D9 — controls: complement unpaid asks the same on the arrival complement, an owner platform already did', async () => {
  const unpaid = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(unpaid.id, S);
  await put(unpaid, { adults: 3 });
  assert.equal(rowOf(unpaid.id).complementAmount, 62.4);
  assert.equal(ficheView(unpaid.id).ledger.remaining, 62.4);

  const owner = fiche(NO_ACOMPTE, PLATFORM.owner, { platformGrossAmount: 600, customOptions: [forced(20)] });
  pay(owner.id, S, C);
  await put(owner, { adults: 3 });
  assert.equal(unclaimed(owner.id), 0);
});

test('D9 — a free line of 30 € after solde and complement still goes to the end of stay, gap 0', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { customOptions: [forced(20), free(30, 'Ajout', null)] });
  assert.equal(ficheView(stay.id).ledger.remaining, 30);
  assert.equal(unclaimed(stay.id), 0);
});

test('D9 — legacy row: a solde with no captured contribs stays unjudged, nothing more is asked', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  db.prepare('UPDATE reservations SET accommodationSoldeContribTtc = NULL, touristTaxSoldeContribTtc = NULL WHERE id = ?').run(stay.id);
  db.prepare('UPDATE reservation_custom_options SET soldeContribTtc = NULL WHERE reservationId = ?').run(stay.id);
  await put(stay, { adults: 3 });
  assert.equal(ficheView(stay.id).ledger.remaining, 0, 'as before');
});

test('D9 — an adjusted arrival complement is the operator\'s decision: never second-guessed', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3, complementAmountOverride: 20 });
  assert.equal(excessOf(stay.id) || 0, 0);
});

test('D9 — a stay reduced after payment asks nothing', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { adults: 3, customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 2 });
  assert.equal(ficheView(stay.id).ledger.remaining, 0);
  assert.equal(excessOf(stay.id) || 0, 0);
});

// A paid solde with its contribs always reads as settled through the fiche (a sweep of 67 200 engine inputs found no gap
// otherwise), so the engine's own condition is judged on the state that does leave money unsettled: a plan part-paid.
test('D9 — the proof given, pre-arrival money not settled: the gap is claimed by nobody yet, only once the plan is all paid', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  const set = respond();
  await installmentsController.put({ params: { id: stay.id }, body: { count: 2 }, user: ADMIN }, set);
  assert.equal(set.statusCode, 200, JSON.stringify(set.body));
  const plan = db.prepare('SELECT id FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(stay.id);
  const payInstallment = async (installment) => {
    const res = respond();
    await installmentsController.markPaid({ params: { id: stay.id, installmentId: installment.id }, body: { paidDate: TODAY, method: 'transfer' }, user: ADMIN }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  };
  const claimed = () => {
    // D17: a fully paid plan pins its tax; a save that changes the party re-prices it (sameStayAsSold), as here.
    const quote = quoteStoredReservation(db, rowOf(stay.id), { paidSoldeCaptured: true, adults: 3, freezeTouristTax: false });
    assert.equal(quote.error, undefined);
    return (quote.midStayExtrasLines || []).find((line) => line.key === EXCESS_KEY);
  };
  await payInstallment(plan[0]);
  pay(stay.id, C);
  assert.equal(claimed(), undefined);
  await payInstallment(plan[1]);
  assert.equal(claimed().amount, 42.4, 'the same gap, settled, is claimed');
});

// Rule 20, reading of 2026-11-05 (audit R23 N1) — a plan never sets `balancePaid`: its being fully paid is the proof.
async function fullyPaidPlan(stay) {
  const set = respond();
  await installmentsController.put({ params: { id: stay.id }, body: { count: 2 }, user: ADMIN }, set);
  assert.equal(set.statusCode, 200, JSON.stringify(set.body));
  for (const installment of db.prepare('SELECT id FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(stay.id)) {
    const res = respond();
    await installmentsController.markPaid({ params: { id: stay.id, installmentId: installment.id }, body: { paidDate: TODAY, method: 'transfer' }, user: ADMIN }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  }
}
const planGap = (id) => {
  const stay = ficheView(id);
  const row = rowOf(id);
  return Math.round((stay.finalPrice + stay.touristTaxTotal - row.installmentsPaidAmount - row.complementAmount - stay.ledger.remaining) * 100) / 100;
};

test('N1 — a fully paid plan, complement paid, one adult more: 42,40 € claimed at the end of stay, gap 0', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  await fullyPaidPlan(stay);
  pay(stay.id, C);
  await put(stay, { adults: 3 });
  assert.equal(ficheView(stay.id).ledger.remaining, 42.4);
  assert.equal(excessOf(stay.id), 42.4);
  assert.equal(planGap(stay.id), 0);
});

test('N1 — the same, one night more: 302,40 € claimed', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  await fullyPaidPlan(stay);
  pay(stay.id, C);
  await put(stay, { endDate: inDays(Math.round((Date.parse(stay.body.endDate) - Date.parse(inDays(0))) / 86400000) + 1) });
  assert.equal(ficheView(stay.id).ledger.remaining, 302.4);
  assert.equal(planGap(stay.id), 0);
});

test('N1 — tax in the complement on a plan: the whole growth is claimed, 42,40 €', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { touristTaxInComplement: 1 });
  await fullyPaidPlan(stay);
  pay(stay.id, C);
  await put(stay, { adults: 3 });
  assert.equal(ficheView(stay.id).ledger.remaining, 42.4);
  assert.equal(planGap(stay.id), 0);
});

test('N1 — a plan part-paid proves nothing: the growth goes on its unpaid installment, never the end of stay', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  const set = respond();
  await installmentsController.put({ params: { id: stay.id }, body: { count: 2 }, user: ADMIN }, set);
  const [first] = db.prepare('SELECT id FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(stay.id);
  const res = respond();
  await installmentsController.markPaid({ params: { id: stay.id, installmentId: first.id }, body: { paidDate: TODAY, method: 'transfer' }, user: ADMIN }, res);
  pay(stay.id, C);
  await put(stay, { adults: 3 });
  assert.equal(excessOf(stay.id) || 0, 0);
});
