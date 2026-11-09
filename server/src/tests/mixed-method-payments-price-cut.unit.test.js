// specs/mixed-method-payments.md rule 47 (audit R34-M-H1) — a paid bucket split with a « Reste à percevoir » or a
// « Geste commercial », then the stay's price cut: the engine keeps a paid acompte, solde or complement at what it
// RECEIVED, not at its marked amount (reservation-refunds rule 36 read for a split payment). The cut lowers the bucket
// down to that, so rule 39 cancels the reste, then the geste; only what is left beyond them is a trop-perçu.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  controller, respond, ADMIN, TODAY, rowOf, mark, NO_ACOMPTE, forced, fiche, ficheView, S,
} = require('./moneyLedgerFixture');
const { remainingToPay, comptaCollected } = require('../utils/reservationSettlement');

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

// A direct stay without acompte, its single solde paid by card for `receivedCents`, the rest left as `kind`.
function soldeSplit(receivedCents, kind) {
  const stay = fiche(NO_ACOMPTE, 'direct');
  const due = cents(rowOf(stay.id).balanceAmount);
  const res = mark(stay.id, {
    balancePaid: true, balancePaidDate: TODAY, expectedAmountCents: due, tenders: [card(receivedCents)], shortfall: { kind },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return { stay, due };
}

test('specs/mixed-method-payments.md rule 47 — reste à percevoir, then 20 % off: no trop-perçu, the reste is what the guest still owes', async () => {
  const { stay } = soldeSplit(40000, 'due');
  const res = await save(stay, { discountPercent: 20 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rowOf(stay.id);
  // Owed now: the cut total; received: 400 €. Nothing beyond, the rest is still to collect.
  assert.equal(r.balanceAmount, total(stay.id));
  assert.equal(r.splitShortfallDue, round2(total(stay.id) - 400));
  assert.equal(remainingToPay(r), round2(total(stay.id) - 400));
  assert.equal(comptaCollected(r), 400);
  assert.equal(overRow(stay.id), undefined);
});

test('specs/mixed-method-payments.md rule 47 — geste commercial, then a small cut: the geste shrinks, no trop-perçu', async () => {
  const { stay, due } = soldeSplit(58000, 'waived');
  assert.ok(due > 58000);
  const res = await save(stay, { discountPercent: 3 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rowOf(stay.id);
  assert.ok(total(stay.id) > 580, String(total(stay.id)));
  assert.equal(r.splitWaivedAmount, round2(total(stay.id) - 580));
  assert.equal(r.splitShortfallDue, 0);
  assert.equal(overRow(stay.id), undefined);
});

test('specs/mixed-method-payments.md rule 47 — geste commercial, then a cut below what was received: the trop-perçu is the money beyond', async () => {
  const { stay } = soldeSplit(58000, 'waived');
  const refused = await save(stay, { discountPercent: 20 });
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'OVERPAID');
  const owedNow = round2(Number(refused.body.overpaymentLines.reduce((s, l) => s + l.amountTtc, 0)));
  assert.equal(owedNow, refused.body.overpaymentTtc);
  const forcedSave = await save(stay, {}, { force: true });
  assert.equal(forcedSave.statusCode, 200, JSON.stringify(forcedSave.body));
  // Received 580 €, the stay now costs less: the excess is 580 − total, the geste is gone.
  assert.equal(refused.body.overpaymentTtc, round2(580 - total(stay.id)));
  const r = rowOf(stay.id);
  assert.equal(r.splitWaivedAmount, 0);
  assert.equal(r.balanceAmount, 580);
});

test('specs/mixed-method-payments.md rule 47 — a complement split with a reste, then its line lowered: the reste comes down first', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  const solde = mark(stay.id, S);
  assert.equal(solde.statusCode, 200, JSON.stringify(solde.body));
  const res = mark(stay.id, {
    complementPaid: true, complementPaidDate: TODAY, expectedAmountCents: 8000, tenders: [card(5000)], shortfall: { kind: 'due' },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const lowered = await save(stay, { customOptions: [forced(60)] });
  assert.equal(lowered.statusCode, 200, JSON.stringify(lowered.body));
  const r = rowOf(stay.id);
  assert.equal(r.complementAmount, 60);
  assert.equal(r.splitShortfallDue, 10);
  assert.equal(overRow(stay.id), undefined);
});

test('specs/mixed-method-payments.md rule 47 — the trop-perçu split by poste reads each poste at what the payment received', async () => {
  const { stay, due } = soldeSplit(58000, 'waived');
  const refused = await save(stay, { discountPercent: 20 });
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  const accommodation = refused.body.overpaymentLines.find((l) => l.bucket === 'accommodation');
  // The solde's accommodation (600 €) collected its share of the 580 € received, never its marked 600 €.
  assert.equal(accommodation.collectedTtc, round2((600 * 58000) / due));
});

// A paid solde, then one more buy billed at the check-out (`kind` 'eos': the end-of-stay complement, 'note': a mid-stay
// note), 50 €, paid by card for 40 € with a 10 € geste, then the stay's price lowered by 5 €: received 644,80 € for a
// stay now worth 649,80 € — no trop-perçu. Read at its marked 50 €, the payment would show a false 5 € one.
const { MID_STAY_SOURCE } = require('../utils/midStayExtras');

function laterBuyWithGeste(kind) {
  const { db } = require('./moneyLedgerFixture');
  const settlementsModel = require('../models/paymentSettlementsModel');
  const stay = fiche(NO_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, S).statusCode, 200);
  const r = rowOf(stay.id);
  const base = { reservationId: stay.id, paidDate: TODAY, dueCents: 5000, shortfallCents: 1000, shortfallKind: 'waived', lines: [card(4000)] };
  if (kind === 'eos') {
    db.prepare(`UPDATE reservations SET finalPrice = ?, endOfStayComplementAmount = 50, endOfStayComplementPaid = 1, endOfStayComplementPaidDate = ?,
      endOfStayComplementDetail = ? WHERE id = ?`).run(Number(r.finalPrice) + 50, TODAY, JSON.stringify([{ key: 'menage', label: 'Ménage', amount: 50, source: MID_STAY_SOURCE }]), stay.id);
    settlementsModel.insert({ ...base, targetKind: 'bucket', targetKey: 'endOfStayComplement', parts: [{ kind: 'endOfStayComplement', key: 'endOfStayComplement', amountCents: 5000 }] });
  } else {
    const note = { id: 'n1', paidDate: TODAY, total: 50, lines: [{ key: 'menage', label: 'Ménage', amount: 50 }] };
    db.prepare('UPDATE reservations SET finalPrice = ?, midStaySettledNotes = ? WHERE id = ?').run(Number(r.finalPrice) + 50, JSON.stringify([note]), stay.id);
    settlementsModel.insert({ ...base, targetKind: 'midStayNote', targetKey: 'n1', parts: [{ kind: 'note', key: 'n1', amountCents: 5000 }] });
  }
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 5 WHERE id = ?').run(stay.id);
  return stay;
}

for (const kind of ['eos', 'note']) {
  test(`specs/mixed-method-payments.md rule 47 — ${kind === 'eos' ? 'an end of stay' : 'a mid-stay note'} paid with a geste counts what it received in the stored trop-perçu`, () => {
    const stay = laterBuyWithGeste(kind);
    const { storedOverpayment } = require('../controllers/reservationsController');
    const over = storedOverpayment(stay.id);
    assert.ok(over, 'the stored stay is read');
    assert.equal(over.overpaymentTtc, 0);
  });
}

test('specs/mixed-method-payments.md rule 47 — an end of stay with a departure line (outside the price) paid with several methods: no trop-perçu', () => {
  const { db } = require('./moneyLedgerFixture');
  const settlementsModel = require('../models/paymentSettlementsModel');
  const stay = fiche(NO_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, S).statusCode, 200);
  // 30 € bought during the stay (inside the price) + 20 € of cleaning the departure added (outside it), paid 50 € whole.
  const detail = [{ key: 'bois', label: 'Bois', amount: 30, source: MID_STAY_SOURCE }, { key: 'menage', label: 'Ménage', amount: 20 }];
  db.prepare(`UPDATE reservations SET finalPrice = finalPrice + 30, endOfStayComplementAmount = 50, endOfStayComplementPaid = 1,
    endOfStayComplementPaidDate = ?, endOfStayComplementDetail = ? WHERE id = ?`).run(TODAY, JSON.stringify(detail), stay.id);
  settlementsModel.insert({
    reservationId: stay.id, targetKind: 'bucket', targetKey: 'endOfStayComplement', paidDate: TODAY, dueCents: 5000,
    parts: [{ kind: 'endOfStayComplement', key: 'endOfStayComplement', amountCents: 5000 }], lines: [card(2000), { method: 'cash', amountCents: 3000, internal: false }],
  });
  const { storedOverpayment } = require('../controllers/reservationsController');
  assert.equal(storedOverpayment(stay.id).overpaymentTtc, 0);
});
