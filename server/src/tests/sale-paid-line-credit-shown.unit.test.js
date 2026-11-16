// specs/pricing-components.md §3 rules 25, 31, 104 (stabilisation loop t5, S5-3, 2026-11-16) — the money a note paid on a line since discounted or
// offered is credited to what the stay still asks (rule 104), and every reader shows that credit as a line of its own, « Déjà réglé (<line>) »
// −amount, in the bucket it comes off: each article keeps its price and the lines of every recap sum to what its bucket asks. Before: the
// arrival e-mail and SAS listed the basket at 45 € for a complement of 35 €, and the end-of-stay detail billed another article at the credited
// remainder under its own name (« Balade 1 × 35 € »).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { shapeArrivalRecap } = require('../plugins/sas/arrivalRecap');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const patch = (id, body) => {
  let status = 200;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  ctrl.updatePayment({ params: { id: String(id) }, body, query: {}, user: { id: 1, role: 'admin' } }, res);
  return status;
};

// A direct stay started, its solde paid, a 45 € basket due in the arrival complement (`collected`: the complement taken at the door), then 30 € of
// beer paid in cash the day after the arrival.
function cashBeer({ collected = false } = {}) {
  const id = stay(20);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }).status, 200);
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '12:00', -3) }).status, 200);
  assert.equal(patch(id, { balancePaid: true, balancePaidDate: todayIso() }), 200);
  assert.equal(patch(id, { checkInDone: true }), 200);
  if (collected) assert.equal(patch(id, { complementPaid: true, complementPaidDate: todayIso() }), 200);
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at(id, '12:00', 1), payment: 'cash' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  return { id, ref: sold.saleDetail.lines.find((line) => line.articleKey === `option:${beer}`).ref };
}

test('S5-3 — arrival: the paid line discounted 10 €, the e-mail and the SAS recap list the basket at 45 € and « Déjà réglé (Bière ronde) » −10 €', () => {
  const { id, ref } = cashBeer();
  const now = at(id, '13:00', 1);
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now }).status, 200);
  assert.equal(cents(row(id).complementAmount), 3500);
  const mail = extraSale.arrivalComplementDetailOf(id, now);
  assert.deepEqual(mail.detail.map((line) => [line.kind, line.label, cents(line.amount)]),
    [['option', 'Panier du terroir', 4500], ['credit', 'Déjà réglé (Bière ronde)', -1000]]);
  assert.equal(mail.detail.reduce((sum, line) => sum + cents(line.amount), 0), cents(mail.amount));
  const { credits } = extraSale.saleDetailOf(id, now);
  const recap = shapeArrivalRecap({ lines: [{ key: 'custom:1', group: 'existing', label: 'Panier du terroir', real: 45, billed: 45 }], arrivalComplementTotal: 35 }, { credits });
  assert.deepEqual(recap.lines.map((line) => [line.label, line.billed]), [['Panier du terroir', 45], ['Déjà réglé (Bière ronde)', -10]]);
});

test('S5-3 — departure: the paid line offered, its 30 € come off the basket left for the departure under the credit\'s name, and « Ventes du séjour — au départ » sums to it', () => {
  const { id, ref } = cashBeer({ collected: true });
  const now = at(id, '13:00', 1);
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Balade', amount: 65 }], { now }).status, 200);
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now }).status, 200);
  const detail = JSON.parse(row(id).endOfStayComplementDetail || '[]');
  assert.deepEqual(detail.map((line) => [line.label, cents(line.amount)]), [['Balade (déjà réglé : 30,00 € — Bière ronde)', 3500]]);
  const section = extraSale.departureSalesOf(id, now);
  assert.deepEqual(section.lines.map((line) => [line.label, line.totalCents]), [['Balade', 6500], ['Déjà réglé (Bière ronde)', -3000]]);
  assert.equal(section.dueCents, cents(row(id).endOfStayComplementAmount));
});

test('S5-3 — the guest e-mail lists the credit with its negative amount (« Already paid (…) » in English), the total unchanged', () => {
  const { buildContext } = require('../utils/emailContextBuilder');
  const input = (lang) => ({
    reservation: {
      startDate: '2026-07-10', endDate: '2026-07-13', checkInTime: '15:00', checkOutTime: '10:00', adults: 2, finalPrice: 380, depositAmount: 0, balanceAmount: 345, complementAmount: 35, complementPaid: 0,
    }, // date-literal-ok: an e-mail context built from literals, no clock reads it
    client: { firstName: 'Test', lastName: 'Ronde' },
    property: { name: 'Ronde', defaultCheckIn: '15:00', defaultCheckOut: '10:00' },
    options: [],
    resources: [],
    customOptions: [],
    settings: { companyName: 'GuestFlow Demo' },
    arrivalComplementDetail: {
      amount: 35, paid: 0, detail: [
        { kind: 'option', label: 'Panier du terroir', qty: 1, unitPrice: 45, amount: 45 },
        { kind: 'credit', label: 'Déjà réglé (Bière ronde)', paidLabels: ['Bière ronde'], qty: 1, unitPrice: -10, amount: -10 },
      ],
    },
    lang,
  });
  const fr = buildContext(input('fr')).vars.complementNotice;
  assert.match(fr, /- Panier du terroir : 45 €/);
  assert.match(fr, /- Déjà réglé \(Bière ronde\) : -10 €/);
  assert.match(fr, /Total : 35 €/);
  assert.match(buildContext(input('en')).vars.complementNotice, /- Already paid \(Bière ronde\): -€10/);
});
