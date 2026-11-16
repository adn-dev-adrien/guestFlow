// specs/pricing-components.md §3 rule 121 (stabilisation loop t9, B9-2, 2026-11-16) — a direct stay's OWN money received beyond what its paid
// buckets now cover (a solde line offered or discounted after the solde was paid) pays a line sold unpaid first, exactly as a note's money
// does (rule 104), on every path: the sale API, the fiche, the line API, a refund deleted (rule 119). Before, the sale held the new line in
// full in its bucket while the trop-perçu formula already netted it: the stay asked the line AND owed the money back (beer 30 € in the paid
// solde offered, jam 15 € sold → « 15 € à percevoir » and « 15 € à rembourser »). Scenario: beer ×5 (30 €) in the solde of 330 €, paid.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./stayIdentityFixtures');

const plank = F.option('Planche crédit', 20);
const jam = F.option('Confiture crédit', 15);
const addUnpaid = (via, id, article, now) => (via === 'sale'
  ? F.sell(id, article, 1, now)
  : F.fiche(id, (options) => [...options, { optionId: article, quantity: 1 }], now).final);

for (const via of ['sale', 'fiche']) {
  test(`B9-2 (a) ${via}: beer discounted 6 €, then jam 15 € sold unpaid → asks 9 €, owes nothing`, () => {
    const id = F.paidStay('direct');
    assert.equal(F.change(id, F.beer, { discount: { amount: 6 } }, F.at(id, -3, '10:00')).final.status, 200);
    assert.equal(F.identity(id).owed, 600);
    assert.equal(addUnpaid(via, id, jam, F.at(id, -3, '11:00')).status, 200);
    const money = F.identity(id);
    assert.deepEqual([money.asked, money.owed, money.gap], [900, 0, 0]);
  });

  test(`B9-2 (b) ${via}: beer offered, then jam 15 € sold unpaid → asks nothing, owes 15 €`, () => {
    const id = F.paidStay('direct');
    assert.equal(F.change(id, F.beer, { offered: true }, F.at(id, -3, '10:00')).final.status, 200);
    assert.equal(addUnpaid(via, id, jam, F.at(id, -3, '11:00')).status, 200);
    const money = F.identity(id);
    assert.deepEqual([money.asked, money.owed, money.gap], [0, 1500, 0]);
  });

  test(`B9-2 (d) ${via}: beer offered before the arrival, jam sold unpaid in the stay → nothing at departure, owes 15 €`, () => {
    const id = F.paidStay('direct');
    assert.equal(F.change(id, F.beer, { offered: true }, F.at(id, -3, '10:00')).final.status, 200);
    F.pay(id, { checkInDone: true });
    assert.equal(addUnpaid(via, id, jam, F.at(id, 1, '11:00')).status, 200);
    const money = F.identity(id);
    assert.deepEqual([money.asked, money.owed, money.gap], [0, 1500, 0]);
    assert.equal(F.cents(F.row(id).endOfStayComplementAmount), 0);
  });
}

test('B9-2 (c): plank + jam sold unpaid (35 € asked), then the beer offered in the fiche → asks 5 €, nothing overpaid (as fiche-added lines)', () => {
  for (const via of ['sale', 'fiche']) {
    const id = F.paidStay('direct');
    assert.equal(addUnpaid(via, id, plank, F.at(id, -3, '10:00')).status, 200);
    assert.equal(addUnpaid(via, id, jam, F.at(id, -3, '11:00')).status, 200);
    const offered = F.fiche(id, F.offerInFiche(F.beer), F.at(id, -3, '12:00'));
    assert.equal(offered.first.status, 200, `${via}: ${JSON.stringify(offered.first.body)}`);
    const money = F.identity(id);
    assert.deepEqual([money.asked, money.owed, money.gap], [500, 0, 0], via);
  }
});

test('B9-2 (c) once the 35 € collected: the beer offered answers 409 on « options », and the stored row refunds it on 70600010', () => {
  for (const path of ['fiche', 'line']) {
    const id = F.paidStay('direct');
    assert.equal(F.sell(id, plank, 1, F.at(id, -3, '10:00')).status, 200);
    assert.equal(F.sell(id, jam, 1, F.at(id, -3, '11:00')).status, 200);
    F.pay(id, { complementPaid: true, complementPaidDate: F.todayIso() });
    const gesture = path === 'fiche'
      ? F.fiche(id, F.offerInFiche(F.beer), F.at(id, -3, '12:00'))
      : F.change(id, F.beer, { offered: true }, F.at(id, -3, '12:00'));
    assert.equal(gesture.first.status, 409);
    assert.deepEqual(gesture.first.body.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 30]], path);
    assert.equal(gesture.final.status, 200);
    const prefill = F.overpaymentRow(id).refundPrefill;
    assert.deepEqual(prefill.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 30]], path);
    assert.deepEqual(F.refundAsProposed(id).map((r) => r.statusCode), [201]);
    assert.equal(F.identity(id).gap, 0);
  }
});

test('B9-2 (e): the solde trop-perçu refunded, a plank sold unpaid, the refund deleted → the plank is paid by the money back, 10 € owed', () => {
  const id = F.paidStay('direct');
  assert.equal(F.change(id, F.beer, { offered: true }, F.at(id, -3, '10:00')).final.status, 200);
  assert.deepEqual(F.refundAsProposed(id).map((r) => r.statusCode), [201]);
  assert.equal(F.sell(id, plank, 1, F.at(id, -3, '11:00')).status, 200);
  assert.deepEqual([F.identity(id).asked, F.identity(id).owed], [2000, 0], 'a refunded credit pays nothing');
  const [refundId] = F.refundIds(id);
  assert.equal(F.deleteRefund(id, refundId).statusCode, 200);
  const money = F.identity(id);
  assert.deepEqual([money.asked, money.owed, money.gap], [0, 1000, 0]);
});
