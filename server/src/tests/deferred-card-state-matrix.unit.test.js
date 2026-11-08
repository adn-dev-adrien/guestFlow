// Audit R29 (2026-11-08) — specs/defer-arrival-complement-to-checkout.md rules 24, 25, 26 and 27 (the state matrix),
// specs/reservation-payment-ledger.md rule 69. Every fix of the merged « Complément de fin de séjour » card regressed a
// neighbouring state, so its whole matrix is written down once, as a table: the deferral marker (0/1) × the arrival
// complement (0 € / due / paid) × the end of stay (0 € / due / settled apart / settled together / caisse interne). Each
// state names the card(s) the ledger draws; each gesture (mark, un-mark, caisse switch, the end of stay sent alone) names
// its answer, the columns it leaves and the cards after it. The departure SAS ownership and the single payment are judged
// by the chains below the tables.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, inDays, rowOf, mark, ADMIN, NO_ACOMPTE, S, forced, fiche, pay, ficheView,
} = require('./moneyLedgerFixture');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const sas = optionalPlugin(() => require('../plugins/sas/controller'));
const SAS = { skip: skipWithout(['sas']) };

const ON = inDays(-1);
const OTHER_DAY = inDays(-2);
const EOS_LINES = JSON.stringify([{ label: 'Bois', qty: 1, unitPrice: 12, amount: 12 }]);
const cards = (id) => ficheView(id).ledger.rows.filter((r) => /omplement/i.test(r.key)).map((r) => [r.key, r.amount, r.state]);
const columns = (id) => {
  const r = rowOf(id);
  return [r.complementPaid, r.complementPaidCash, r.endOfStayComplementPaid, r.endOfStayComplementPaidCash, r.endOfStayComplementPaidDate];
};

/**
 * A checked-out direct stay, solde paid, in one state of the matrix.
 * @param {object} s
 * @param {0|1} s.marker      complementDeferredToCheckout
 * @param {0|'due'|'paid'|'cash'} s.arrival  the 20 € arrival complement (0 = none); paid / cash on ON
 * @param {0|'due'|'apart'|'together'|'caisse'} s.eos  the 12 € end of stay (0 = none); apart = paid on another day,
 *   together = paid on ON with the arrival part's caisse flag, caisse = caisse interne on ON (apart from a books arrival)
 */
function stay({ marker, arrival, eos }) {
  const s = fiche(NO_ACOMPTE, 'direct', arrival === 0 ? {} : { customOptions: [forced(20)] });
  pay(s.id, S);
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = ?, startDate = ?, endDate = ? WHERE id = ?')
    .run(marker, inDays(-5), inDays(-3), s.id);
  if (arrival === 'paid' || arrival === 'cash') {
    db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ?, complementPaidCash = ? WHERE id = ?')
      .run(ON, arrival === 'cash' ? 1 : 0, s.id);
  }
  if (eos !== 0) {
    db.prepare('UPDATE reservations SET endOfStayComplementAmount = 12, endOfStayComplementDetail = ? WHERE id = ?').run(EOS_LINES, s.id);
  }
  if (eos === 'apart' || eos === 'together' || eos === 'caisse') {
    const date = eos === 'apart' ? OTHER_DAY : ON;
    const cash = eos === 'caisse' || (eos === 'together' && arrival === 'cash') ? 1 : 0;
    db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1, endOfStayComplementPaidDate = ?, endOfStayComplementPaidCash = ? WHERE id = ?')
      .run(date, cash, s.id);
  }
  return s.id;
}

const CC = 'checkoutComplement';
const OWN = 'complement';
const EOS = 'endOfStayComplement';

// Rule 27 — the cards of every state.
const STATES = [
  // marker 0: never merged.
  [{ marker: 0, arrival: 'due', eos: 0 }, [[OWN, 20, 'due']]],
  [{ marker: 0, arrival: 'due', eos: 'due' }, [[OWN, 20, 'due'], [EOS, 12, 'due']]],
  [{ marker: 0, arrival: 'paid', eos: 0 }, [[OWN, 20, 'paid']]],
  [{ marker: 0, arrival: 'paid', eos: 'together' }, [[OWN, 20, 'paid'], [EOS, 12, 'paid']]],
  [{ marker: 0, arrival: 0, eos: 'due' }, [[EOS, 12, 'due']]],
  // marker 1, no arrival part: nothing to merge (stay 22281).
  [{ marker: 1, arrival: 0, eos: 'due' }, [[EOS, 12, 'due']]],
  [{ marker: 1, arrival: 0, eos: 'apart' }, [[EOS, 12, 'paid']]],
  // marker 1, arrival part due: one merged card, without an end of stay settled apart.
  [{ marker: 1, arrival: 'due', eos: 0 }, [[CC, 20, 'due']]],
  [{ marker: 1, arrival: 'due', eos: 'due' }, [[CC, 32, 'due']]],
  [{ marker: 1, arrival: 'due', eos: 'apart' }, [[CC, 20, 'due'], [EOS, 12, 'paid']]],
  [{ marker: 1, arrival: 'due', eos: 'caisse' }, [[CC, 20, 'due'], [EOS, 12, 'paid']]],
  // marker 1, arrival part paid: merged when the card's one collection settled it (rule 24: nothing at the end of stay).
  [{ marker: 1, arrival: 'paid', eos: 0 }, [[CC, 20, 'paid']]],
  [{ marker: 1, arrival: 'cash', eos: 0 }, [[CC, 20, 'paid']]],
  [{ marker: 1, arrival: 'paid', eos: 'together' }, [[CC, 32, 'paid']]],
  [{ marker: 1, arrival: 'cash', eos: 'together' }, [[CC, 32, 'paid']]],
  [{ marker: 1, arrival: 'paid', eos: 'apart' }, [[OWN, 20, 'paid'], [EOS, 12, 'paid']]],
  [{ marker: 1, arrival: 'paid', eos: 'caisse' }, [[OWN, 20, 'paid'], [EOS, 12, 'paid']]],
  [{ marker: 1, arrival: 'paid', eos: 'due' }, [[OWN, 20, 'paid'], [EOS, 12, 'due']]],
];

for (const [state, expected] of STATES) {
  test(`rule 27, cards: ${JSON.stringify(state)} → ${JSON.stringify(expected)}`, () => {
    assert.deepEqual(cards(stay(state)), expected);
  });
}

// Rule 27 — each gesture from a state: [state, body, status, columns after, cards after]. Columns are
// [complementPaid, complementPaidCash, endOfStayComplementPaid, endOfStayComplementPaidCash, endOfStayComplementPaidDate].
const GESTURES = [
  // Rule 24 — the merged card at 0 € end of stay: its mark, un-mark and caisse switch move the arrival part only, the card stays merged.
  [{ marker: 1, arrival: 'due', eos: 0 }, { complementPaid: true, complementPaidDate: ON }, 200, [1, 0, 0, 0, null], [[CC, 20, 'paid']]],
  [{ marker: 1, arrival: 'paid', eos: 0 }, { complementPaid: false }, 200, [0, 0, 0, 0, null], [[CC, 20, 'due']]],
  [{ marker: 1, arrival: 'paid', eos: 0 }, { complementPaidCash: true }, 200, [1, 1, 0, 0, null], [[CC, 20, 'paid']]],
  // Rule 8 — the merged card holding the end of stay: one collection, both buckets.
  [{ marker: 1, arrival: 'due', eos: 'due' }, { complementPaid: true, complementPaidDate: ON }, 200, [1, 0, 1, 0, ON], [[CC, 32, 'paid']]],
  [{ marker: 1, arrival: 'paid', eos: 'together' }, { complementPaid: false }, 200, [0, 0, 0, 0, null], [[CC, 32, 'due']]],
  [{ marker: 1, arrival: 'paid', eos: 'together' }, { complementPaidCash: true }, 200, [1, 1, 1, 1, ON], [[CC, 32, 'paid']]],
  // « Tout solder » sends both marks: one collection.
  [{ marker: 1, arrival: 'due', eos: 'due' }, { complementPaid: true, endOfStayComplementPaid: true }, 200, [1, 0, 1, 0, inDays(0)], [[CC, 32, 'paid']]],
  // Rule 25 — the end of stay sent alone while the merged card holds it and its arrival part is due: refused, nothing written.
  [{ marker: 1, arrival: 'due', eos: 'due' }, { endOfStayComplementPaid: true }, 409, [0, 0, 0, 0, null], [[CC, 32, 'due']]],
  [{ marker: 1, arrival: 'due', eos: 'due' }, { endOfStayComplementPaidCash: true }, 409, [0, 0, 0, 0, null], [[CC, 32, 'due']]],
  [{ marker: 1, arrival: 'due', eos: 'due' }, { complementPaid: false, endOfStayComplementPaid: true }, 409, [0, 0, 0, 0, null], [[CC, 32, 'due']]],
  // Rule 25 — the deferral switched off in the same PATCH: two cards, the end of stay alone passes.
  [{ marker: 1, arrival: 'due', eos: 'due' }, { complementDeferredToCheckout: false, endOfStayComplementPaid: true, endOfStayComplementPaidDate: ON }, 200, [0, 0, 1, 0, ON], [[OWN, 20, 'due'], [EOS, 12, 'paid']]],
  // Rule 22 — an end of stay settled apart: the merged mark never re-dates it, its own un-tick passes.
  [{ marker: 1, arrival: 'due', eos: 'apart' }, { complementPaid: true, complementPaidDate: ON }, 200, [1, 0, 1, 0, OTHER_DAY], [[OWN, 20, 'paid'], [EOS, 12, 'paid']]],
  [{ marker: 1, arrival: 'due', eos: 'apart' }, { endOfStayComplementPaid: false }, 200, [0, 0, 0, 0, null], [[CC, 32, 'due']]],
  // Two cards: each gesture is its own.
  [{ marker: 1, arrival: 'paid', eos: 'due' }, { endOfStayComplementPaid: true, endOfStayComplementPaidDate: ON }, 200, [1, 0, 1, 0, ON], [[CC, 32, 'paid']]],
  [{ marker: 1, arrival: 'paid', eos: 'apart' }, { complementPaid: false }, 200, [0, 0, 1, 0, OTHER_DAY], [[CC, 20, 'due'], [EOS, 12, 'paid']]],
  [{ marker: 1, arrival: 0, eos: 'due' }, { endOfStayComplementPaid: true, endOfStayComplementPaidDate: ON }, 200, [0, 0, 1, 0, ON], [[EOS, 12, 'paid']]],
  [{ marker: 0, arrival: 'due', eos: 'due' }, { endOfStayComplementPaid: true, endOfStayComplementPaidDate: ON }, 200, [0, 0, 1, 0, ON], [[OWN, 20, 'due'], [EOS, 12, 'paid']]],
  [{ marker: 0, arrival: 'paid', eos: 'together' }, { complementPaid: false }, 200, [0, 0, 1, 0, ON], [[OWN, 20, 'due'], [EOS, 12, 'paid']]],
  // Stay 22281: nothing to collect on the arrival part.
  [{ marker: 1, arrival: 0, eos: 'apart' }, { complementPaid: true }, 409, [0, 0, 1, 0, OTHER_DAY], [[EOS, 12, 'paid']]],
];

for (const [state, body, status, after, expected] of GESTURES) {
  test(`rule 27, gesture: ${JSON.stringify(state)} + ${JSON.stringify(body)} → ${status}`, () => {
    const id = stay(state);
    const res = mark(id, body);
    assert.equal(res.statusCode, status, JSON.stringify(res.body));
    assert.deepEqual(columns(id), after);
    assert.deepEqual(cards(id), expected);
  });
}

test('rule 25: the refusal names the merged card, code END_OF_STAY_WITH_ARRIVAL_COMPLEMENT', () => {
  const id = stay({ marker: 1, arrival: 'due', eos: 'due' });
  const res = mark(id, { endOfStayComplementPaid: true });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'END_OF_STAY_WITH_ARRIVAL_COMPLEMENT');
  assert.equal(res.body.error, 'Complément de fin de séjour : à percevoir avec le complément d’arrivée.');
});

test('rule 25: the R29-RES-L1 chain no longer reads as settled together — the end of stay alone is refused', () => {
  const id = stay({ marker: 1, arrival: 'paid', eos: 'together' });
  assert.equal(mark(id, { complementPaid: false }).statusCode, 200);
  assert.equal(mark(id, { endOfStayComplementPaid: true }).statusCode, 409);
  assert.equal(mark(id, { complementPaid: true }).statusCode, 200);
  assert.equal(mark(id, { complementPaid: false }).statusCode, 200);
  assert.deepEqual(columns(id), [0, 0, 0, 0, null]);
  assert.deepEqual(cards(id), [[CC, 32, 'due']]);
});

// Rule 27 — a « paiement unique » is another collection. Probe p2 of R29-M-L1: the arrival part marked on the merged card
// at 0 € of end of stay, an end of stay billed afterwards, then a single payment settling solde + end of stay the same day.
// Read on the date alone it was « settled together »: one merged card whose « Annuler » un-paid the end of stay and left
// the group claiming it. The group names the end of stay and not the arrival part: two cards, each un-tick its own.
test('rule 27: a single payment naming the end of stay alone keeps its own card; the arrival un-tick leaves the group', () => {
  const s = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1, startDate = ?, endDate = ? WHERE id = ?').run(inDays(-5), inDays(-1), s.id);
  assert.equal(mark(s.id, { complementPaid: true, complementPaidDate: inDays(0) }).statusCode, 200);
  assert.deepEqual(cards(s.id), [[CC, 20, 'paid']]);
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 12, endOfStayComplementDetail = ? WHERE id = ?').run(EOS_LINES, s.id);
  assert.deepEqual(cards(s.id), [[OWN, 20, 'paid'], [EOS, 12, 'due']]);
  const res = respond();
  controller.settleArrivalPayment({ params: { id: String(s.id) }, body: { mode: 'card', date: inDays(0) }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const group = rowOf(s.id).arrivalPaymentGroup;
  assert.deepEqual(JSON.parse(group).buckets, ['balance', 'endOfStayComplement']);
  assert.deepEqual(cards(s.id), [[OWN, 20, 'paid'], [EOS, 12, 'paid-group']]);

  assert.equal(mark(s.id, { complementPaid: false }).statusCode, 200);
  const r = rowOf(s.id);
  assert.deepEqual([r.complementPaid, r.endOfStayComplementPaid, r.balancePaid], [0, 1, 1]);
  assert.equal(r.arrivalPaymentGroup, group);
  assert.deepEqual(cards(s.id), [[CC, 20, 'due'], [EOS, 12, 'paid-group']]);
});

test('rule 27: a single payment naming both buckets is the merged card\'s one collection; its « Annuler » dissolves it', () => {
  const id = stay({ marker: 1, arrival: 'paid', eos: 'together' });
  const group = JSON.stringify({ at: ON, cash: 0, total: 32, buckets: ['complement', 'endOfStayComplement'] });
  db.prepare('UPDATE reservations SET arrivalPaymentGroup = ? WHERE id = ?').run(group, id);
  assert.deepEqual(cards(id), [[CC, 32, 'paid-group']]);
  assert.equal(mark(id, { complementPaid: false }).statusCode, 200);
  assert.deepEqual(columns(id), [0, 0, 0, 0, null]);
  assert.equal(rowOf(id).arrivalPaymentGroup, null);
  assert.deepEqual(cards(id), [[CC, 32, 'due']]);
});

// Rule 26 — the merged card's mirror of the end of stay releases it like the explicit path
// (recall-unpaid-arrival-complement-at-checkout rule 9bis).
// Probe p3 of R29-M-L1: the departure SAS settled both; the fiche takes the collection over (« Annuler » then « Marquer
// perçu »), so a re-opened departure SAS answering « pas maintenant » no longer un-pays what the fiche collected.
test('rule 26: the merged card takes the end of stay from the departure SAS; a re-opened SAS leaves it paid', SAS, () => {
  const s = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(s.id, S);
  db.prepare("UPDATE reservations SET complementDeferredToCheckout = 1, startDate = ?, endDate = ?, arrivalSasDoneAt = datetime('now') WHERE id = ?")
    .run(inDays(-3), inDays(0), s.id);
  const item = db.prepare("INSERT INTO linen_priced_items (label, price) VALUES ('Serviette', 12)").run().lastInsertRowid;
  const missingItems = [{ itemId: Number(item), qty: 1 }];
  const departure = (complementsSettled) => {
    const res = respond();
    sas.commitDeparture({ params: { id: String(s.id) }, body: { missingItems, complementsSettled }, user: ADMIN }, res);
    return res;
  };
  let res = departure(true);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(s.id).endOfStayComplementPaidAtDeparture, 1);
  assert.deepEqual(cards(s.id), [[CC, 32, 'paid']]);

  assert.equal(mark(s.id, { complementPaid: false }).statusCode, 200);
  assert.equal(rowOf(s.id).endOfStayComplementPaidAtDeparture, 0);
  assert.equal(mark(s.id, { complementPaid: true, complementPaidDate: inDays(0) }).statusCode, 200);
  assert.deepEqual(cards(s.id), [[CC, 32, 'paid']]);

  res = departure(false);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rowOf(s.id);
  assert.deepEqual([r.complementPaid, r.endOfStayComplementPaid], [1, 1]);
  assert.deepEqual(cards(s.id), [[CC, 32, 'paid']]);
});
