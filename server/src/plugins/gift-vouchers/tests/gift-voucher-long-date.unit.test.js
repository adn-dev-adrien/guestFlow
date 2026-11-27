// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 20 — the back of a voucher writes its end of validity as the mock does: « 27 mai 2028 ».
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../voucherRules');

test('a date of the back is written in long French form, the first of a month as « 1er »', () => {
  assert.equal(rules.formatLongFrDate('2028-05-27'), '27 mai 2028'); // date-literal-ok: a pure formatting case
  assert.equal(rules.formatLongFrDate('2027-12-01'), '1er décembre 2027'); // date-literal-ok: a pure formatting case
  assert.equal(rules.formatLongFrDate('2027-08-09'), '9 août 2027'); // date-literal-ok: a pure formatting case
});
