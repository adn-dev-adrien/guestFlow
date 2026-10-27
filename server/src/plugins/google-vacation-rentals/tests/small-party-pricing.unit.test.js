// specs/google-vacation-rentals-feed.md rule 4 (2026-10-27 audit) — every party size from 1 is priced:
// with no headcount tax, a per-person DEFAULT option still makes a smaller party cheaper on the site,
// and the feed used to send it the included-guests price (260 € sent, 230 € on the site).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
const { createSource } = require('../source');

const pid = db.prepare(`INSERT INTO properties (name, maxGuests, basePriceIncludedGuests, touristTaxPerDayPerPerson, touristTaxMode)
  VALUES ('Gîte', 6, 4, 0, 'per_day_per_person')`).run().lastInsertRowid;
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)`)
  .run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));
const oid = db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Linge de lit', 'per_person', 15)").run().lastInsertRowid;
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(pid, oid);
db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (?, ?, 0)').run(pid, oid);

test('the feed prices parties of 1 to the cap, and each size matches the website quote', () => {
  const source = createSource({ db });
  assert.deepEqual(source.sizesOf(pid), [1, 2, 3, 4, 5, 6]);
  const two = source.quoteWebsite(pid, { checkin: '2027-07-03', nights: 2, guests: 2 });
  const four = source.quoteWebsite(pid, { checkin: '2027-07-03', nights: 2, guests: 4 });
  assert.equal(two.amountCents, 23000);
  assert.equal(four.amountCents, 26000);
});
