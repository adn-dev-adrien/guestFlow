// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 6 — the French public holidays of a year (the SDK's own calendar, `sdk.calendar.frenchPublicHolidays`), and the day before one,
// read by the hourly plugin's period of a slice. (Ported from the module the branch first added: no case lost.)
const test = require('node:test');
const assert = require('node:assert/strict');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const sdk = require('../plugins/sdk');

const { isPublicHoliday, isEveOfPublicHoliday } = optionalPlugin(() => require('../plugins/hourly-resources/hourlyPricing'));
const NEEDS_PLUGIN = { skip: skipWithout(['hourly-resources']) };
const daysOf = (year) => sdk.calendar.frenchPublicHolidays(year).map((holiday) => holiday.date);

test('2026 — eleven days, Easter Monday on 6 April, Ascension on 14 May, Whit Monday on 25 May', () => {
  assert.deepEqual(daysOf(2026), [
    '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25', '2026-07-14', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25',
  ]);
});

test('2027 — Easter Monday on 29 March, Ascension on 6 May, Whit Monday on 17 May', () => {
  const days = daysOf(2027);
  assert.equal(days.length, 11);
  ['2027-03-29', '2027-05-06', '2027-05-17'].forEach((day) => assert.ok(days.includes(day), day));
});

test('isPublicHoliday and isEveOfPublicHoliday read an ISO day and refuse anything else', NEEDS_PLUGIN, () => {
  assert.equal(isPublicHoliday('2026-04-06'), true);
  assert.equal(isPublicHoliday('2026-04-07'), false);
  assert.equal(isEveOfPublicHoliday('2026-05-13'), true, 'the eve of Ascension');
  assert.equal(isEveOfPublicHoliday('2026-12-31'), true, 'the eve of New Year crosses the year');
  assert.equal(isEveOfPublicHoliday('2026-05-12'), false);
  [null, '', 'demain', '2026-4-6'].forEach((bad) => {
    assert.equal(isPublicHoliday(bad), false);
    assert.equal(isEveOfPublicHoliday(bad), false);
  });
});
