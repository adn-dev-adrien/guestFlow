// specs/mid-stay-extras-to-end-of-stay-complement.md rule 20, reading of 2026-11-06 (audit R27-RES-1) — on a started, still
// locked fiche whose end of stay is collected, a rise of finalPrice + touristTaxTotal is refused only for the part nothing
// claims. Every source that can claim it, one test each:
//   - an unpaid acompte / solde / complement / end of stay: eos-paid-refuses-growth « finding 1 » (direct and the three
//     platform modes, the platform payout still pending included);
//   - an unpaid installment: eos-paid-refuses-growth « L3 »;
//   - the trop-perçu still open before the save (the ledger's figure, net of the free refunds): eos-paid-refuses-growth
//     « R27-RES-1 », and below, net of a refund, held in the caisse interne, on a fully paid plan;
//   - a refund already made: not a claim, the money is gone (below);
//   - a platform stay whose payout is received: no trop-perçu there (specs/reservation-refunds.md rule 38), nothing claims (below).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, rowOf, NO_ACOMPTE, PLATFORM, S, C, TODAY, forced, fiche, put, pay, storedEndOfStayPaid,
  ficheView, refund,
} = require('./moneyLedgerFixture');
const installmentsController = require('../controllers/installmentsController');

async function save(stay, over) {
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, ...over, forceOverpayment: true }, user: ADMIN }, res);
  return res;
}

const overpayment = (id) => (ficheView(id).ledger.rows.find((r) => r.key === 'overpayment') || { amount: 0 }).amount;

function checkOut(stay) {
  db.prepare("UPDATE reservations SET startDate = date('now', '-3 day'), endDate = date('now', '-1 day') WHERE id = ?").run(stay.id);
  return { startDate: rowOf(stay.id).startDate, endDate: rowOf(stay.id).endDate, adults: 3 };
}

// A direct stay, solde and complement paid, the end of stay collected, checked out; then a 20 % discount typed by mistake.
async function typoAfterCollection({ platform = 'direct', soldeInCaisse = false, endOfStayInCaisse = false, soldePaid = true } = {}) {
  const stay = fiche(NO_ACOMPTE, platform, { customOptions: [forced(20)], discountPercent: 5 });
  pay(stay.id, ...(soldePaid ? [S, C] : [C]));
  await put(stay, { adults: 3 });
  if (soldeInCaisse) db.prepare('UPDATE reservations SET balancePaidCash = 1 WHERE id = ?').run(stay.id);
  storedEndOfStayPaid(stay.id, { cash: endOfStayInCaisse });
  const moved = checkOut(stay);
  const typo = await save(stay, { ...moved, discountPercent: 20 });
  assert.equal(typo.statusCode, 200, JSON.stringify(typo.body));
  return { stay, moved };
}

function assertRefused(res, stay, finalPrice) {
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'MID_STAY_EXTRAS_CLOSED');
  assert.equal(rowOf(stay.id).finalPrice, finalPrice);
  assert.equal(rowOf(stay.id).discountPercent, 20);
}

test('open trop-perçu net of a free refund: the rise it covers passes, above it refused', async () => {
  const { stay, moved } = await typoAfterCollection();
  assert.equal(overpayment(stay.id), 90);
  assert.equal(refund(stay.id, [{ label: 'Trop-perçu', bucket: 'accommodation', amountTtc: 30 }]).statusCode, 201);
  assert.equal(overpayment(stay.id), 60);
  assertRefused(await save(stay, { ...moved, discountPercent: 5 }), stay, 540);
  const res = await save(stay, { ...moved, discountPercent: 10 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).finalPrice, 600);
  assert.equal(overpayment(stay.id), 0);
});

test('a refund already made is not a claim: the whole trop-perçu given back, the discount cannot be taken back', async () => {
  const { stay, moved } = await typoAfterCollection();
  assert.equal(refund(stay.id, [{ label: 'Trop-perçu', bucket: 'accommodation', amountTtc: 90 }]).statusCode, 201);
  assert.equal(overpayment(stay.id), 0);
  assertRefused(await save(stay, { ...moved, discountPercent: 5 }), stay, 540);
  assert.equal((await save(stay, { ...moved, discountPercent: 20 })).statusCode, 200);
});

test('the solde held in the caisse interne: its trop-perçu claims the rise as well', async () => {
  const { stay, moved } = await typoAfterCollection({ soldeInCaisse: true });
  assert.equal(overpayment(stay.id), 90);
  const res = await save(stay, { ...moved, discountPercent: 5 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).finalPrice, 630);
  assert.equal(rowOf(stay.id).balancePaidCash, 1);
  assert.equal((await save(stay, { ...moved, discountPercent: 20 })).statusCode, 200);
  assertRefused(await save(stay, { ...moved, discountPercent: 0 }), stay, 540);
});

test('the end of stay collected in the caisse interne: the same', async () => {
  const { stay, moved } = await typoAfterCollection({ endOfStayInCaisse: true });
  assert.equal((await save(stay, { ...moved, discountPercent: 5 })).statusCode, 200);
  assert.equal(rowOf(stay.id).endOfStayComplementPaidCash, 1);
});

test('a fully paid plan: its trop-perçu claims the rise, above it refused', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)], discountPercent: 5 });
  const set = respond();
  await installmentsController.put({ params: { id: stay.id }, body: { count: 2 }, user: ADMIN }, set);
  assert.equal(set.statusCode, 200, JSON.stringify(set.body));
  for (const row of db.prepare('SELECT id FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(stay.id)) {
    const paid = respond();
    await installmentsController.markPaid({ params: { id: stay.id, installmentId: row.id }, body: { paidDate: TODAY, method: 'transfer' }, user: ADMIN }, paid);
    assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
  }
  pay(stay.id, C);
  storedEndOfStayPaid(stay.id);
  const moved = { ...checkOut(stay), adults: 2 };
  const plan = () => db.prepare('SELECT amountCents, paid FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(stay.id);
  const before = plan();
  const typo = await save(stay, { ...moved, discountPercent: 20 });
  assert.equal(typo.statusCode, 200, JSON.stringify(typo.body));
  const low = rowOf(stay.id).finalPrice;
  assert.ok(overpayment(stay.id) > 0);
  const back = await save(stay, { ...moved, discountPercent: 5 });
  assert.equal(back.statusCode, 200, JSON.stringify(back.body));
  assert.equal(overpayment(stay.id), 0);
  assert.deepEqual(plan(), before);
  assert.equal((await save(stay, { ...moved, discountPercent: 20 })).statusCode, 200);
  const res = await save(stay, { ...moved, discountPercent: 0 });
  assert.equal(res.body.code, 'MID_STAY_EXTRAS_CLOSED');
  assert.equal(rowOf(stay.id).finalPrice, low);
});

test('a platform payout still pending claims the rise: the discount typed by mistake is taken back', async () => {
  const { stay, moved } = await typoAfterCollection({ platform: PLATFORM.remitted, soldePaid: false });
  const res = await save(stay, { ...moved, discountPercent: 5 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).finalPrice, 590);
});

test('a platform payout received: no trop-perçu on a platform (specs/reservation-refunds.md rule 38), nothing claims the rise, refused', async () => {
  const { stay, moved } = await typoAfterCollection({ platform: PLATFORM.remitted });
  assert.equal(overpayment(stay.id), 0);
  assertRefused(await save(stay, { ...moved, discountPercent: 5 }), stay, 500);
});

test('the open trop-perçu claims at most the rise: an unpaid bucket the save lowers is not hidden behind it', () => {
  const { unclaimedRise } = require('../utils/savePriceGuards');
  const stored = { finalPrice: 500, touristTaxTotal: 0, balanceAmount: 100, balancePaid: 0 };
  const quote = { finalPrice: 510, touristTaxTotal: 0, balanceAmount: 80 };
  assert.equal(unclaimedRise(stored, quote), 30);
  assert.equal(unclaimedRise(stored, quote, { openOverpayment: 500 }), 20);
  assert.equal(unclaimedRise(stored, quote, { openOverpayment: 5 }), 25);
  assert.equal(unclaimedRise(stored, { ...quote, finalPrice: 490 }, { openOverpayment: 500 }), 0);
});
