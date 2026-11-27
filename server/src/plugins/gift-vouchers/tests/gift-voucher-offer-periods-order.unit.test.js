// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 11 (G16) — the offer lists a campaign's periods cheapest first, so the first is the one the page opens on and the one the
// top-level contents and extra-time prices are for, also on a grid where the week-end is the cheaper.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');

const s = f.setup();
s.campaign('une-heure', 'day');
const viewOf = async () => (await s.api.offerService.offer()).campaigns.find((c) => c.slug === 'une-heure');

test('the production grid lists the week first, the week-end after', async () => {
  const view = await viewOf();
  assert.deepEqual(view.periods.map((p) => p.period), ['week', 'weekend']);
});

test('a grid where the week-end is cheaper lists the week-end first, and the top-level figures are its', async () => {
  s.db.prepare('UPDATE resources SET hourlyExternalWeekendDayRate = 40, hourlyExternalWeekendNextDayRate = 40 WHERE id = ?').run(s.ids.bath);
  const view = await viewOf();
  assert.deepEqual(view.periods.map((p) => p.period), ['weekend', 'week']);
  assert.equal(view.totalCents, view.periods[0].priceCents);
  assert.match(view.contents[0].detail, /week-end/);
});
