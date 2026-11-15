// specs/pricing-components.md §3 rules 20, 37, 95 (loop t1 S-3) — before the stay has started a line is moved to the arrival only: a move to the
// departure is refused and writes no extras baseline, so a later sale before the arrival still goes to the arrival complement.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stay, row, beer } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

test('S-3 — a move to the departure before the arrival is refused 409 MOMENT_NOT_AVAILABLE; no baseline is laid and the next sale goes to the arrival', () => {
  const id = stay(20);
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], {});
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  const line = sold.saleDetail.lines.find((l) => l.label === 'Bière ronde');
  assert.deepEqual(line.moments, ['arrival'], 'the server offers the arrival only before the stay starts');
  const moved = extraSale.changeLine(id, line.ref, { collectAt: 'departure' });
  assert.deepEqual([moved.status, moved.body.code], [409, 'MOMENT_NOT_AVAILABLE']);
  assert.equal(row(id).arrivalExtrasBaseline, null);
  const quoted = extraSale.quote(id, [{ articleRef: `option:${beer}`, quantity: 1 }]);
  assert.deepEqual([quoted.buckets.arrival, quoted.buckets.departure], [600, 0]);
});

test('S-3 — on a started stay both moments stay offered', () => {
  const id = stay(-1);
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], {});
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.deepEqual(sold.saleDetail.lines.find((l) => l.label === 'Bière ronde').moments, ['arrival', 'departure']);
});
