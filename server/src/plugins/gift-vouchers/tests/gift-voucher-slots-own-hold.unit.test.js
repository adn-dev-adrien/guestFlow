// specs/gift-vouchers/gift-voucher-campaigns.md rule 15 (L8, G18) — the slot list excludes the voucher's own hold exactly as the recap does: a recipient back from the bank page still sees, and
// may choose again, the slot the recap accepts; another voucher's list still hides it.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');

const s = f.setup();
s.db.prepare('UPDATE resources SET slotDuration = 60 WHERE id = ?').run(s.ids.bath);
s.campaign('jour', 'day', ['week']);

test('the voucher\'s own held slot stays in its list and is refused to another voucher\'s', async () => {
  const mine = s.sell('jour', 'week');
  const other = s.sell('jour', 'week');
  const request = { extraMinutes: 60 };
  assert.ok(Object.keys(s.slotsOf(mine, f.TUESDAY, 60)).includes('10:00'), 'free before the hold');
  const confirmed = await s.confirm(mine, f.TUESDAY, '10:00', request);
  assert.ok(confirmed.ok && confirmed.data.payUrl, JSON.stringify(confirmed));
  assert.ok(s.quoteOf(mine, f.TUESDAY, '10:00', request).ok, 'the recap accepts its own slot');
  assert.ok(Object.keys(s.slotsOf(mine, f.TUESDAY, 60)).includes('10:00'), 'the list shows the slot the recap accepts');
  assert.ok(!Object.keys(s.slotsOf(other, f.TUESDAY, 60)).includes('10:00'), 'another voucher\'s list does not');
  assert.equal(s.quoteOf(other, f.TUESDAY, '10:00', request).ok, false);
});
