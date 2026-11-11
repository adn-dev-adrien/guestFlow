// specs/payment-schedule-and-cancellation.md rule 55 and specs/reservation-refunds.md rule 48, readings of 2026-11-02
// (review of PR #929, F1). The cancellation requalified the commission withheld on a paid solde whole, even when a book
// refund made before it had already reversed that solde's 706 at gross: the avoir then reversed 706 + 4457 the books no
// longer held and 7588 kept money that was given back. Now each solde bucket requalifies at most what the books still
// hold of the solde there, once the earlier refunds took their share: given everything back, 706, 4457, 4671 and the
// client end at 0 whatever was refunded before, and 7588 keeps exactly the commissions 622600 carries.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { setDirectChannels } = require('../utils/platformNameFormat');
const {
  TODAY, round2, accounting, seedWithContribs, seedLegacy, call, cancel, registerOf, giveBackAll, netByAccount, sumOf,
} = require('./cancelledStayCommissionFixtures');

test.before(() => setDirectChannels(['Lodgify']));
test.after(() => setDirectChannels([]));

const refundBefore = (controller, lines) => {
  const out = call(controller.create, { refundDate: TODAY, method: 'transfer', lines });
  assert.equal(out.statusCode, 201, JSON.stringify(out.body));
};
const avoirOf = (deps) => deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained');
const commissionOf = (avoir) => round2(avoir.lines.filter((l) => l.lineKey === 'commission').reduce((t, l) => t + l.amountTtc, 0));

function assertBooksNet(db, commission) {
  const net = netByAccount(db);
  for (const prefix of ['706', '4457', '4671', '411']) assert.equal(sumOf(net, prefix), 0, `${prefix} ${JSON.stringify(net)}`);
  for (const account of Object.keys(net).filter((a) => /^(706|4457)/.test(a))) assert.equal(net[account], 0, `${account} ${JSON.stringify(net)}`);
  assert.equal(net['622600'], commission, JSON.stringify(net));
  assert.equal(net['75880000'], -commission, JSON.stringify(net));
}

// The 914 € stay: solde 640 € (514 € of accommodation, 126 € of dinner), 19,20 € withheld on it, 8,22 € on the acompte.
for (const [given, soldeCommission] of [[640, 0], [630, 10], [620.8, 19.2], [300, 19.2]]) {
  test(`rule 55 reading — ${given} € of the solde refunded before the cancellation: the solde commission is capped at what the books hold (${soldeCommission} €)`, accounting, () => {
    const { db, deps, controller } = seedWithContribs();
    const lines = [{ key: 'accommodation', amountTtc: Math.min(514, given) }];
    if (given > 514) lines.push({ key: 'opt:1', amountTtc: round2(given - 514) });
    refundBefore(controller, lines);
    const out = cancel(deps);
    assert.equal(out.retainedDepositAmount, 274, 'the solde absorbed the refund: the acompte is kept whole');
    const avoir = avoirOf(deps);
    assert.equal(commissionOf(avoir), round2(8.22 + soldeCommission));
    assert.equal(avoir.totalTtc, round2(274 + soldeCommission));
    assert.equal(round2(avoir.lines.reduce((t, l) => t + l.amountTtc, 0)), avoir.totalTtc);
    assert.equal(deps.compensationsModel.getById(out.compensationId).receivedAmount, avoir.totalTtc);
    assert.equal(giveBackAll(controller).statusCode, 201);
    assert.equal(registerOf(controller).collectedTtc, 0);
    assertBooksNet(db, 27.42);
  });
}

test('rule 55 reading — the commission lands on the buckets that still hold solde money, never on a bucket given back', () => {
  const { deps, controller } = seedWithContribs();
  // The solde's 514 € of accommodation given back: only its 126 € of dinner is still booked.
  refundBefore(controller, [{ key: 'accommodation', amountTtc: 514 }]);
  cancel(deps);
  const solde = avoirOf(deps).lines.filter((l) => l.lineKey === 'commission');
  const byBucket = Object.fromEntries(solde.map((l) => [l.bucket, l.amountTtc]));
  // 8,22 € from the acompte (200 € / 74 € of it), 19,20 € from the solde, all of it on the dinner.
  assert.equal(round2(byBucket.accommodation), 6);
  assert.equal(round2(byBucket.options), round2(2.22 + 19.2));
});

test('rule 55 reading — stay #22226 (no contribs), its solde refunded before the cancellation: every account nets, 7588 −6,82', accounting, () => {
  const { db, deps, controller } = seedLegacy();
  refundBefore(controller, [{ key: 'accommodation', amountTtc: 88.12 }, { key: 'touristTax', amountTtc: 2.32 }]);
  refundBefore(controller, [{ key: 'opt:16', amountTtc: 35.94 }]);
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 126.38);
  assert.equal(avoirOf(deps).totalTtc, 126.38, 'nothing of the solde left in the books: its commission is not requalified');
  assert.equal(giveBackAll(controller).statusCode, 201);
  assertBooksNet(db, 6.82);
});
