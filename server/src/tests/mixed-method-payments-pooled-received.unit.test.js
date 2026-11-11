// specs/mixed-method-payments.md rule 50 (audit R34 NEW-1, D25 « Une seule somme », Adrien 2026-11-09) — the money
// received by a settlement paying several buckets (the single arrival payment, the SAS arrival and departure, the
// complement carrying the end of stay) is ONE pool across its buckets. A later cut lowers the reste / the geste first:
// the engine may lower any paid bucket of the pool down to what the pool received, the solde first, and every
// trop-perçu reader counts the pool once. Never a false OVERPAID, never a refund prompt for money never received.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  controller, respond, ADMIN, TODAY, rowOf, NO_ACOMPTE, forced, fiche, ficheView,
} = require('./moneyLedgerFixture');
const { remainingToPay, comptaCollected } = require('../utils/reservationSettlement');
const { readSplitReceived } = require('../utils/splitReceived');
const db = require('../database');

const cents = (euros) => Math.round(Number(euros) * 100);
const round2 = (n) => Math.round(n * 100) / 100;
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });

async function save(stay, over, { force = false } = {}) {
  stay.body = { ...stay.body, ...over };
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, ...(force ? { forceOverpayment: true } : {}) }, user: ADMIN }, res);
  return res;
}
const total = (id) => round2(Number(rowOf(id).finalPrice) + Number(rowOf(id).touristTaxTotal));
const overRow = (id) => (ficheView(id).ledger.rows || []).find((r) => /Trop-perçu/.test(String(r.label || '')));

function call(handler, params, body) {
  const res = respond();
  handler({ params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), body, user: ADMIN }, res);
  return res;
}

// A direct stay without acompte and an 80 € line collected at arrival, paid in one go (solde + complement) by card for
// `shortCents` less than it owes, the rest left as `kind`.
function arrivalSplit(kind, shortCents = 5000) {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  const r0 = rowOf(stay.id);
  const due = cents(r0.balanceAmount) + cents(r0.complementAmount);
  const res = call(controller.settleArrivalPayment, { id: stay.id }, {
    mode: 'split', date: TODAY, expectedAmountCents: due, tenders: [card(due - shortCents)], shortfall: { kind },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).balancePaid, 1);
  assert.equal(rowOf(stay.id).complementPaid, 1);
  return { stay, received: round2((due - shortCents) / 100) };
}

test('specs/mixed-method-payments.md rule 50 — single arrival payment with a reste, then 5 % off: the reste shrinks, no trop-perçu (P12)', async () => {
  const { stay, received } = arrivalSplit('due');
  const res = await save(stay, { discountPercent: 5 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rowOf(stay.id);
  assert.ok(total(stay.id) > received, String(total(stay.id)));
  assert.equal(r.splitShortfallDue, round2(total(stay.id) - received));
  assert.equal(remainingToPay(r), round2(total(stay.id) - received));
  assert.equal(round2(Number(r.balanceAmount) + Number(r.complementAmount)), total(stay.id));
  assert.equal(comptaCollected(r), received);
  assert.equal(overRow(stay.id), undefined);
});

test('specs/mixed-method-payments.md rule 50 — single arrival payment with a geste, then 5 % off: the geste shrinks, no trop-perçu (P12 geste)', async () => {
  const { stay, received } = arrivalSplit('waived');
  const res = await save(stay, { discountPercent: 5 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rowOf(stay.id);
  assert.equal(r.splitWaivedAmount, round2(total(stay.id) - received));
  assert.equal(r.splitShortfallDue, 0);
  assert.equal(overRow(stay.id), undefined);
});

test('specs/mixed-method-payments.md rule 50 — a cut beyond the reste: the trop-perçu is the money received beyond the new total', async () => {
  const { stay, received } = arrivalSplit('due');
  const refused = await save(stay, { discountPercent: 20 });
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'OVERPAID');
  const forcedSave = await save(stay, {}, { force: true });
  assert.equal(forcedSave.statusCode, 200, JSON.stringify(forcedSave.body));
  assert.equal(refused.body.overpaymentTtc, round2(received - total(stay.id)));
  assert.equal(round2(refused.body.overpaymentLines.reduce((s, l) => s + l.amountTtc, 0)), refused.body.overpaymentTtc);
  const r = rowOf(stay.id);
  assert.equal(r.splitShortfallDue, 0);
  assert.equal(overRow(stay.id).amount, round2(received - total(stay.id)));
});

test('specs/mixed-method-payments.md rule 50 — the line collected at arrival removed: the pool gives up the reste, the rest is a true trop-perçu', async () => {
  const { stay, received } = arrivalSplit('due');
  const refused = await save(stay, { customOptions: [] });
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  // Received 80 − 50 € beyond the stay that now costs the solde alone.
  assert.equal(refused.body.overpaymentTtc, 30);
  const forcedSave = await save(stay, {}, { force: true });
  assert.equal(forcedSave.statusCode, 200, JSON.stringify(forcedSave.body));
  assert.equal(round2(received - total(stay.id)), 30);
  assert.equal(rowOf(stay.id).splitShortfallDue, 0);
  assert.equal(overRow(stay.id).amount, 30);
});

test('specs/mixed-method-payments.md rule 50 — a small cut, then the line collected at arrival removed: one pool, counted once', async () => {
  const { stay, received } = arrivalSplit('due');
  assert.equal((await save(stay, { discountPercent: 3 })).statusCode, 200);
  const refused = await save(stay, { customOptions: [] });
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.equal((await save(stay, {}, { force: true })).statusCode, 200);
  assert.equal(refused.body.overpaymentTtc, round2(received - total(stay.id)));
  assert.equal(overRow(stay.id).amount, refused.body.overpaymentTtc);
  assert.equal(rowOf(stay.id).splitShortfallDue, 0);
});

test('specs/mixed-method-payments.md rule 50 — readSplitReceived reads a pool: the buckets it cannot lower full, the solde the rest', () => {
  const { stay, received } = arrivalSplit('due');
  const r = rowOf(stay.id);
  const read = readSplitReceived(db, stay.id);
  assert.equal(read.complement, Number(r.complementAmount));
  assert.equal(read.balance, round2(received - Number(r.complementAmount)));
  assert.deepEqual(read.pools.map((p) => [p.buckets.slice().sort(), p.received]), [[["balance", "complement"], received]]);
});
