// specs/pricing/pricing-components.md §3 rule 103 (stabilisation loop t3, T3-1, 2026-11-16) — the acceptance probe of the sale path, on fixtures: at every
// moment of a stay (J-3, the arrival day at 09:00 as stored / ticked / ticked then unticked, 17:00 as stored / ticked / unticked, 21:30, the day after,
// the departure day at 09:00 and 11:00, the day after the departure) and for a stay whose arrival complement was collected before the arrival, a sale,
// an offer, a re-bill, a discount, a move there and back and a removal each agree with one judge: the moment the line says, the bucket its money lands
// in, the arrival e-mail, the departure section and the moments a move offers. Every stay is booked 20 days ahead (`saleRound1Fixtures`, check-in
// 15:00, 3 nights).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, stay, row, beer, addDaysToIsoDate,
} = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const reservations = require('../models/reservationsModel');
const { withNow } = require('../utils/localDate');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (value) => Math.round(Number(value || 0) * 100);
const BUCKETS = { plan: ['depositAmount', 'balanceAmount'], arrival: ['complementAmount'], departure: ['endOfStayComplementAmount'] };
const buckets = (id) => {
  const r = row(id);
  return Object.fromEntries(Object.entries(BUCKETS).map(([name, fields]) => [name, fields.reduce((sum, field) => sum + cents(r[field]), 0)]));
};
const final = (id) => cents(row(id).finalPrice);

const MOMENTS = [
  ['J-3', (id) => at(id, '12:00', -3)],
  ['09:00 as stored', (id) => at(id, '09:00')],
  ['09:00 ticked', (id) => at(id, '09:00'), 'tick'],
  ['09:00 ticked then unticked', (id) => at(id, '09:00'), 'false-start'],
  ['17:00 as stored', (id) => at(id, '17:00')],
  ['17:00 ticked', (id) => at(id, '17:00'), 'tick'],
  ['17:00 ticked then unticked', (id) => at(id, '17:00'), 'false-start'],
  ['21:30', (id) => at(id, '21:30')],
  ['the day after the arrival', (id) => at(id, '12:00', 1)],
  ['departure day 09:00', (id) => at(id, '09:00', 3)],
  ['departure day 11:00', (id) => at(id, '11:00', 3)],
  ['the day after the departure', (id) => at(id, '12:00', 4)],
];

// The arrival complement collected before the arrival (a link, the fiche's tick, a reconciliation — defer-arrival-complement-to-checkout rule 21):
// the payment pins the baseline as the payments PATCH does.
function complementCollectedBeforeArrival(id) {
  const early = at(id, '12:00', -5);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: early }).status, 200);
  withNow(early, () => {
    db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ? WHERE id = ?').run(row(id).startDate, id);
    reservations.captureArrivalExtrasBaseline(id);
  });
}

// A false start: the box ticked at 08:00, a sale carved out to the departure, then unticked through the payments PATCH's own path.
function falseStart(id, now) {
  const tick = new Date(now.getTime() - 60 * 60 * 1000);
  db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Vente cochée', amount: 4 }], { now: tick }).status, 200);
  extraSale.unmarkArrival(id, tick);
}

function probe(id, now) {
  const problems = [];
  const moment = extraSale.collectionOf(id, now);
  const before = { buckets: buckets(id), final: final(id), baseline: row(id).arrivalExtrasBaseline };
  const request = [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }];
  const quoted = extraSale.quote(id, request, { now });
  const sold = extraSale.sell(id, request, { now, acceptedTotalCents: quoted.totalCents });
  if (sold.status !== 200) return [`sale ${sold.status} ${JSON.stringify(sold.body)}`];
  const after = buckets(id);
  const moved = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before.buckets[k]]));
  if (final(id) - before.final !== sold.totalCents) problems.push('final moved by more than the sale');
  if (quoted.totalCents !== sold.totalCents) problems.push(`quote ${quoted.totalCents} != sold ${sold.totalCents}`);
  if (moved[moment] !== sold.totalCents) problems.push(`${moment} sale landed in ${JSON.stringify(moved)}`);
  if (quoted.buckets[moment] !== sold.totalCents) problems.push(`quote announced ${JSON.stringify(quoted.buckets)} for a ${moment} sale`);
  const detail = extraSale.saleDetailOf(id, now);
  const line = detail.lines.find((l) => l.label === 'Panier du terroir');
  if (!line || line.collectAt !== moment) problems.push(`line reads ${line && line.collectAt}, money at ${moment}`);
  if (detail.buckets.arrival !== after.arrival || detail.buckets.departure !== after.departure || detail.buckets.plan !== after.plan) problems.push('saleDetail buckets != stored');
  const mail = extraSale.arrivalComplementDetailOf(id, now);
  const inMail = (mail.detail || []).some((d) => d.label === 'Panier du terroir');
  const section = extraSale.departureSalesOf(id, now);
  const inSection = Boolean(section && section.lines.some((l) => l.ref === line.ref));
  if (inMail !== (moment === 'arrival') || inSection !== (moment === 'departure')) problems.push(`e-mail ${inMail} / departure section ${inSection} for a ${moment} line`);
  const gestures = [['offer', { offered: true }, -sold.totalCents], ['re-bill', { offered: false }, 0], ['discount', { discount: { amount: 10 } }, -1000]];
  for (const [name, patch, delta] of gestures) {
    const changed = extraSale.changeLine(id, line.ref, patch, { now });
    if (changed.status !== 200) { problems.push(`${name} ${changed.status} ${changed.body && changed.body.code}`); continue; }
    const expected = name === 'offer' ? before.buckets[moment] : after[moment] + delta;
    if (buckets(id)[moment] !== expected) problems.push(`${name}: ${moment} bucket ${buckets(id)[moment]} != ${expected}`);
  }
  const target = moment === 'arrival' ? 'departure' : 'arrival';
  const offered = extraSale.saleDetailOf(id, now).lines.find((l) => l.ref === line.ref).moments.includes(target);
  const pre = buckets(id);
  const move = extraSale.changeLine(id, line.ref, { collectAt: target }, { now });
  if ((move.status === 200) !== offered) problems.push(`move to ${target} answered ${move.status} while offered=${offered}`);
  if (move.status === 200) {
    const post = buckets(id);
    if (post[target] - pre[target] !== 3500 || pre[moment] - post[moment] !== 3500) problems.push(`move to ${target}: money did not follow ${JSON.stringify(post)}`);
    if (extraSale.saleDetailOf(id, now).lines.find((l) => l.ref === line.ref).collectAt !== target) problems.push('moved line reads its old moment');
    const back = extraSale.changeLine(id, line.ref, { collectAt: moment }, { now });
    if (back.status !== 200 || JSON.stringify(buckets(id)) !== JSON.stringify(pre)) problems.push(`move back ${back.status} ${JSON.stringify(buckets(id))}`);
  }
  const removed = extraSale.removeLine(id, line.ref, { now });
  if (removed.status !== 200) problems.push(`remove ${removed.status} ${removed.body && removed.body.code}`);
  else if (JSON.stringify(buckets(id)) !== JSON.stringify(before.buckets) || final(id) !== before.final) problems.push(`removed != stored ${JSON.stringify(buckets(id))}`);
  return problems;
}

for (const [variant, prepare] of [['a plain stay', () => {}], ['a stay whose arrival complement was collected before the arrival', complementCollectedBeforeArrival]]) {
  for (const [name, when, mark] of MOMENTS) {
    test(`rule 103 — ${variant}, ${name}: the line's moment, its bucket, the e-mail, the departure section and the move agree`, () => {
      const id = stay(20);
      prepare(id);
      const now = when(id);
      if (mark === 'tick') db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
      if (mark === 'false-start') falseStart(id, now);
      assert.deepEqual(probe(id, now), []);
    });
  }
}

test('rule 103 — complement collected before the arrival: a sale at J-3 is the departure\'s everywhere (label, bucket, e-mail, SAS, moments)', () => {
  const id = stay(20);
  complementCollectedBeforeArrival(id);
  const now = at(id, '12:00', -3);
  assert.equal(extraSale.collectionOf(id, now), 'departure');
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 65 }], { now });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  const line = sold.saleDetail.lines.find((l) => l.label === 'Panier du terroir');
  assert.deepEqual([line.collectAt, line.moments, line.movable], ['departure', ['departure'], false]);
  assert.deepEqual([cents(row(id).complementAmount), cents(row(id).endOfStayComplementAmount)], [600, 6500]);
  assert.equal(extraSale.arrivalComplementDetailOf(id, now).detail.some((d) => d.label === 'Panier du terroir'), false);
  const plan = withNow(now, () => reservations.planArrivalSas(id, {}));
  assert.deepEqual(plan.lines.map((l) => l.label), ['Bière ronde'], 'the arrival SAS lists what it collected, not the departure line');
  assert.deepEqual(extraSale.departureSalesOf(id, now).lines.map((l) => l.label), ['Panier du terroir']);
  const refused = extraSale.quote(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now, payment: 'cash' });
  assert.deepEqual([refused.status, refused.body.code], [409, 'PAYMENT_BEFORE_ARRIVAL'], 'a payment taken now still waits for the guest');
});
