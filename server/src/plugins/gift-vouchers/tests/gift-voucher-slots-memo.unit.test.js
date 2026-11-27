// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 14 (cost) — the slot list of « Mon bain » asks the engine for each distinct figure once: 62 days of 30-minute starts
// cost a few dozen quotes, not thousands, and each start still carries the figure a single quote gives.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');
const standaloneSale = require('../../../utils/standaloneSale');

const s = f.setup();
s.db.prepare('UPDATE resources SET slotDuration = 30, bookingHorizonMonths = 6 WHERE id = ?').run(s.ids.bath);
s.campaign('soir', 'evening');
s.settingsStore.set('leftoverDrinkArticleRef', `option:${s.ids.drink}`);

test('62 days of starts are priced with a handful of engine quotes, each start matching the quote of that start alone', () => {
  const v = s.sell('soir', 'weekend');
  const original = standaloneSale.quote;
  let quotes = 0;
  standaloneSale.quote = (...args) => { quotes += 1; return original(...args); };
  let listed;
  try {
    listed = s.api.useService.slots({ code: v.code, from: '2026-11-16', to: '2027-01-16', visitor: f.VISITOR }); // date-literal-ok: the suite runs on its own clock, never the real today
  } finally {
    standaloneSale.quote = original;
  }
  assert.equal(listed.ok, true);
  const starts = listed.data.days.reduce((sum, day) => sum + day.slots.length, 0);
  assert.ok(starts > 500, `${starts} starts listed`);
  assert.ok(quotes < 150, `${quotes} engine quotes for ${starts} starts`);
  const check = (date, start) => {
    const day = listed.data.days.find((d) => d.date === date);
    const slot = day.slots.find((x) => x.start === start);
    const alone = s.quoteOf(v, date, start);
    assert.equal(slot.dueCents, alone.data.dueCents, `${date} ${start}`);
  };
  check('2026-11-17', '14:00'); // date-literal-ok: a Tuesday of the suite's own clock
  check('2026-11-21', '10:00'); // date-literal-ok: a Saturday
  check('2026-12-25', '19:30'); // date-literal-ok: a public holiday
});
