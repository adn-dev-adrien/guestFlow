// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 2, 29 — `bookOutside` answers a refusal with its own code and sentence: a band that lost its price while the recipient paid is
// « BAND_NOT_SOLD » with the sentence naming the band, never « SLOT_TAKEN »; a taken slot still is « SLOT_TAKEN ».
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');

const s = f.setup();
const book = (date, start, end) => s.offerOfBath.offer.bookOutside({
  resourceId: s.ids.bath, date, start, end, customer: { name: 'Léa' }, fulfilments: [], lines: [], tenders: [], channel: 'mon-bain', actor: 'public', now: s.clock.at,
});

test('a band with no price at the moment of the booking is refused with its own code and sentence', () => {
  s.db.prepare('UPDATE resources SET hourlyExternalWeekendDayRate = 0 WHERE id = ?').run(s.ids.bath);
  const refused = book(f.SATURDAY, '10:00', '11:00');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'BAND_NOT_SOLD');
  assert.match(refused.message, /n’a pas de tarif extérieur pour la journée le week-end\.$/);
  s.db.prepare('UPDATE resources SET hourlyExternalWeekendDayRate = 70 WHERE id = ?').run(s.ids.bath);
});

test('a slot taken meanwhile is still « slot taken »', () => {
  assert.equal(s.offerOfBath.bookings.createBooking({
    resourceId: s.ids.bath, date: f.TUESDAY, startTime: '10:00', endTime: '11:00', clientName: 'X', clientPhone: null, notes: '',
  }).ok, true);
  const refused = book(f.TUESDAY, '10:00', '11:00');
  assert.equal(refused.code, 'SLOT_TAKEN');
});
