// specs/pricing-components.md §3 rule 72 — the two excess keys of SCHEDULE (`overCollectedTtc`, `complementCollectedExcess`) are computed by REFUNDS'
// `scheduleExcess`: the arithmetic SCHEDULE wrote inline, moved unchanged, on a grid of amounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleExcess } = require('../utils/pricing/refunds/overpayment');
const { roundMoney } = require('../utils/pricing/money');

// The inline arithmetic of schedule.js before PR C, verbatim.
function inline({ paidOnSchedule, scheduleTotal, complementPaid, complementOverridden, platformSale, complementAmount, rawComplement, splitUnreceived }) {
  const scheduleOverCollectedTtc = roundMoney(Math.max(0, paidOnSchedule - scheduleTotal));
  let complementCollectedExcess = complementPaid && !complementOverridden && !platformSale
    ? roundMoney(Math.max(0, roundMoney(complementAmount) - rawComplement))
    : 0;
  let cut = null;
  if (splitUnreceived != null && complementCollectedExcess > 0) {
    cut = roundMoney(Math.min(complementCollectedExcess, splitUnreceived));
    complementCollectedExcess = roundMoney(complementCollectedExcess - cut);
  }
  return { scheduleOverCollectedTtc, complementCollectedExcess, complementCut: cut, overCollectedTtc: roundMoney(scheduleOverCollectedTtc + complementCollectedExcess) };
}

const AMOUNTS = [0, 0.1, 19.99, 100.005, 250.5, 480, 1234.56];

test('rule 72 — scheduleExcess equals the inline arithmetic on every combination of paid, total, complement and split', () => {
  let cases = 0;
  for (const paidOnSchedule of AMOUNTS) for (const scheduleTotal of AMOUNTS) for (const complementAmount of AMOUNTS) for (const rawComplement of AMOUNTS) {
    for (const [complementPaid, complementOverridden, platformSale] of [[true, false, false], [true, true, false], [true, false, true], [false, false, false]]) {
      for (const splitUnreceived of [null, 0, 12.5, 1000]) {
        const args = { paidOnSchedule, scheduleTotal, complementPaid, complementOverridden, platformSale, complementAmount, rawComplement };
        const got = scheduleExcess({ ...args, unreceivedComplement: splitUnreceived == null ? null : () => splitUnreceived });
        assert.deepEqual(got, inline({ ...args, splitUnreceived }), JSON.stringify({ ...args, splitUnreceived }));
        cases += 1;
      }
    }
  }
  assert.ok(cases > 10000);
});

test('rule 72 — the split is read only when a collected complement holds an excess', () => {
  let reads = 0;
  const unreceivedComplement = () => { reads += 1; return 5; };
  scheduleExcess({ paidOnSchedule: 0, scheduleTotal: 0, complementPaid: true, complementOverridden: false, platformSale: false, complementAmount: 50, rawComplement: 50, unreceivedComplement });
  assert.equal(reads, 0, 'no excess: the split is not read');
  scheduleExcess({ paidOnSchedule: 0, scheduleTotal: 0, complementPaid: true, complementOverridden: false, platformSale: false, complementAmount: 60, rawComplement: 50, unreceivedComplement });
  assert.equal(reads, 1);
});
