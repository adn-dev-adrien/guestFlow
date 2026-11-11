// specs/google-vacation-rentals-feed.md §4.1 (ariXml.js), §7 « XML: each message matches a golden
// file; escaping of codes ». The golden files are tests/golden/*.xml, built from tests/goldenInputs.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const xml = require('../ariXml');
const { HEADER, RATES, DAYS } = require('./goldenInputs');

const golden = (name) => fs.readFileSync(path.join(__dirname, 'golden', name), 'utf8');

test('property data (Transaction) matches its golden file', () => {
  assert.equal(xml.propertyDataXml({ ...HEADER, name: 'La Granja & co', capacity: 14 }), golden('property-data.xml'));
});

test('rule 4 — length-of-stay totals, tax included, one message per (arrival, length), guests sorted', () => {
  assert.equal(xml.rateAmountXml({ ...HEADER, rates: RATES }), golden('rate-amount.xml'));
});

test('rule 6 — inventory, consecutive equal nights collapsed into one range', () => {
  assert.equal(xml.invCountXml({ ...HEADER, days: DAYS }), golden('inv-count.xml'));
});

test('rule 7 — min/max stay, closed to arrival/departure and master close', () => {
  assert.equal(xml.availXml({ ...HEADER, days: DAYS }), golden('avail.xml'));
});

test('codes and names are escaped, never injected', () => {
  const out = xml.rateAmountXml({ ...HEADER, hotelCode: 'a"<b>&\'', rates: RATES.slice(0, 1) });
  assert.match(out, /HotelCode="a&quot;&lt;b&gt;&amp;&apos;"/);
  assert.doesNotMatch(out, /<b>/);
  assert.equal(xml.esc('x & y'), 'x &amp; y');
});

test('a reused amount (no before-tax figure) is sent with its tax-included amount only', () => {
  const out = xml.losAmountMessage({ checkin: '2027-03-06', nights: 2, amounts: [{ guests: 2, amountCents: 64280, beforeTaxCents: null }] });
  assert.match(out, /<BaseByGuestAmt AmountAfterTax="642.80" CurrencyCode="EUR" NumberOfGuests="2"\/>/);
});

test('rule 14 — Google\'s answer: success, warnings and errors are read, never swallowed', () => {
  assert.deepEqual(xml.parseResponse(200, '<OTA_HotelRateAmountNotifRS><Success/></OTA_HotelRateAmountNotifRS>'), { ok: true, warnings: [], errors: [] });
  const warned = xml.parseResponse(200, '<RS><Success/><Warnings><Warning Type="3" ShortText="Rate in the past"/></Warnings></RS>');
  assert.deepEqual(warned, { ok: true, warnings: ['Rate in the past'], errors: [] });
  const failed = xml.parseResponse(200, '<RS><Errors><Error Type="3" Code="392">Invalid hotel code</Error></Errors></RS>');
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.errors, ['Invalid hotel code']);
  assert.equal(xml.parseResponse(500, 'oops').ok, false);
});

test('the upload paths are Google\'s ARI endpoints', () => {
  assert.deepEqual(xml.PATHS, {
    propertyData: 'property_data',
    rateAmount: 'ota/hotel_rate_amount_notif',
    invCount: 'ota/hotel_inv_count_notif',
    avail: 'ota/hotel_avail_notif',
  });
});
