// specs/mixed-method-payments.md rule 42 (audit R34-DB-M1) — a paid complement split over several methods, lowered on
// the fiche: rule 39 reads it at its new amount, and the refund guard of reservation-refunds.md rule 52 judges the state
// the save writes. With no book refund on the stay nothing can block the save; with one, only a real shortfall does.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  controller, respond, ADMIN, TODAY, rowOf, mark, NO_ACOMPTE, forced, fiche, refund, register,
} = require('./moneyLedgerFixture');

const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });

// A direct stay whose only money in is an 80 € complement paid as 30 € cash in the caisse + 50 € card (the
// auditor's stay: nothing else on the books, so the stale aggregates of the old amount pushed « after » below 0).
function splitComplement() {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  const res = mark(stay.id, {
    complementPaid: true, complementPaidDate: TODAY, expectedAmountCents: 8000, tenders: [cashIn(3000), card(5000)],
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).splitOffBooksAmount, 30);
  return stay;
}

async function save(stay, over) {
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, ...over, forceOverpayment: true }, user: ADMIN }, res);
  return res;
}

test('specs/mixed-method-payments.md rule 42 — 80 € (30 caisse + 50 CB) lowered to 20 €, no refund: saved, read at 20 €', async () => {
  const stay = splitComplement();
  const res = await save(stay, { complementAmountOverride: 20 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rowOf(stay.id);
  assert.equal(r.complementAmount, 20);
  // Rule 39 — the money counted comes down by the same factor: 30 × 20 / 80 in the caisse.
  assert.equal(r.splitOffBooksAmount, 7.5);
});

test('specs/mixed-method-payments.md rule 42 — lowered to 0 €, no refund: saved', async () => {
  const stay = splitComplement();
  const res = await save(stay, { complementAmountOverride: 0 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).splitOffBooksAmount, 0);
});

test('specs/mixed-method-payments.md rule 42 — a book refund above what the lowered complement leaves: refused, naming it', async () => {
  const stay = splitComplement();
  const line = register(stay.id).refundableLines.find((l) => l.label === 'Forcée');
  const given = refund(stay.id, [{ key: line.key, amountTtc: 40 }]);
  assert.equal(given.statusCode, 201, JSON.stringify(given.body));
  const res = await save(stay, { complementAmountOverride: 0 });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'REFUND_BLOCKS_UNTICK');
  assert.equal(res.body.refundIds.length, 1);
  assert.match(res.body.error, /^Remboursement du /);
  assert.equal(rowOf(stay.id).complementAmount, 80);
});

test('specs/mixed-method-payments.md rule 42 — a refund between the stale and the true « after »: the lowered complement still saves', async () => {
  // Solde paid whole on the books (604,80 €) + the split complement: once lowered to 20 €, the books hold
  // 604,80 + 20 × 50 / 80 = 617,30 €. The aggregates of the old amount (30 € off the books) would read 594,80 €.
  const stay = splitComplement();
  assert.equal(mark(stay.id, { balancePaid: true, balancePaidDate: TODAY }).statusCode, 200);
  const given = refund(stay.id, [{ key: 'accommodation', amountTtc: 600 }]);
  assert.equal(given.statusCode, 201, JSON.stringify(given.body));
  const res = await save(stay, { complementAmountOverride: 20 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).complementAmount, 20);
});

test('specs/mixed-method-payments.md rule 42 — nothing refunded on the books: nothing to protect, whatever « after » reads', () => {
  const { untickRefusal } = require('../utils/refundUntickGuard');
  // An installment taken back beyond what the row recorded reads a negative « after »: with no book refund, no refusal.
  assert.equal(untickRefusal({ installmentsPaidAmount: 0 }, { installmentsPaidAmount: -30 }, []), null);
  assert.equal(untickRefusal({ installmentsPaidAmount: 0 }, { installmentsPaidAmount: -30 }, [{ method: 'internal', totalTtc: 30 }]), null);
});
