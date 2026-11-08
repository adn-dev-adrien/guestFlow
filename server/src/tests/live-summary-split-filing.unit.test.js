// Audit R30-C-L1 (2026-11-08) — specs/complement-buckets-by-moment.md rule 4 (reading R30-C-L1), defer rules 22, 24, 27.
// The live summary panel (`quote.complementSplit` of calculate-price) files the arrival complement where the merged card
// and the stored summary file it: from the block's row-aware `deferred` (`isComplementDeferred`), never the raw marker.
// A complement settled together with the end of stay, or at a 0 € end of stay, read « Complément d'arrivée (perçu sur
// place) » live while the ledger and the stored panel said « Complément de fin de séjour ».
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, controller, respond, inDays, ADMIN, NO_ACOMPTE, S, forced, fiche, pay, ficheView } = require('./moneyLedgerFixture');

const ON = inDays(-1);
const OTHER_DAY = inDays(-2);
const EOS_LINES = JSON.stringify([{ label: 'Bois', qty: 1, unitPrice: 12, amount: 12 }]);

function stay({ marker, arrival, eos, group = null }) {
  const s = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(s.id, S);
  s.body = { ...s.body, startDate: inDays(-5), endDate: inDays(-3) };
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = ?, startDate = ?, endDate = ? WHERE id = ?')
    .run(marker, s.body.startDate, s.body.endDate, s.id);
  if (arrival !== 'due') {
    db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ?, complementPaidCash = ? WHERE id = ?')
      .run(ON, arrival === 'cash' ? 1 : 0, s.id);
  }
  if (eos !== 0) db.prepare('UPDATE reservations SET endOfStayComplementAmount = 12, endOfStayComplementDetail = ? WHERE id = ?').run(EOS_LINES, s.id);
  if (eos === 'apart' || eos === 'together') {
    db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1, endOfStayComplementPaidDate = ?, endOfStayComplementPaidCash = ? WHERE id = ?')
      .run(eos === 'apart' ? OTHER_DAY : ON, arrival === 'cash' ? 1 : 0, s.id);
  }
  if (group) db.prepare('UPDATE reservations SET arrivalPaymentGroup = ? WHERE id = ?').run(JSON.stringify(group), s.id);
  return s;
}

async function liveSplit(s) {
  const res = respond();
  await controller.calculatePrice({ user: ADMIN, params: {}, query: {}, body: { ...s.body, reservationId: s.id } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.complementSplit;
}
const storedSplit = (s) => ficheView(s.id).storedSummary.complementSplit;

test('R30-C-L1 — a merged complement collected at a 0 € end of stay is filed at the end of stay, live as stored (stay 11)', async () => {
  for (const arrival of ['paid', 'cash']) {
    const s = stay({ marker: 1, arrival, eos: 0 });
    const live = await liveSplit(s);
    assert.deepEqual({ arrival: live.arrival, endOfStay: live.endOfStay }, { arrival: 0, endOfStay: 20 }, arrival);
    assert.deepEqual({ arrival: live.arrival, endOfStay: live.endOfStay }, { arrival: storedSplit(s).arrival, endOfStay: storedSplit(s).endOfStay });
  }
});

test('R30-C-L1 — a « paiement unique » naming both buckets keeps both at the end of stay (stay 12)', async () => {
  const s = stay({ marker: 1, arrival: 'paid', eos: 'together', group: { buckets: ['balance', 'complement', 'endOfStayComplement'], total: 332 } });
  const live = await liveSplit(s);
  assert.deepEqual({ arrival: live.arrival, endOfStay: live.endOfStay }, { arrival: 0, endOfStay: 32 });
  assert.deepEqual({ arrival: live.arrival, endOfStay: live.endOfStay }, { arrival: storedSplit(s).arrival, endOfStay: storedSplit(s).endOfStay });
});

test('R30-C-L1 — every matrix state files the same way live and stored; paid apart stays at the arrival', async () => {
  const expected = {
    '1/due/0': [0, 20], '1/due/due': [0, 32], '1/due/apart': [0, 32], '1/paid/0': [0, 20], '1/paid/due': [20, 12],
    '1/paid/apart': [20, 12], '1/paid/together': [0, 32], '0/paid/0': [20, 0], '0/due/due': [20, 12], '0/paid/together': [20, 12],
  };
  for (const [key, [arrival, endOfStay]] of Object.entries(expected)) {
    const [marker, arr, eos] = key.split('/');
    const s = stay({ marker: Number(marker), arrival: arr, eos: eos === '0' ? 0 : eos });
    const live = await liveSplit(s);
    assert.deepEqual([live.arrival, live.endOfStay], [arrival, endOfStay], `${key} live`);
    const stored = storedSplit(s);
    assert.deepEqual([stored.arrival, stored.endOfStay], [arrival, endOfStay], `${key} stored`);
  }
});
