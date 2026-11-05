require('./isolatedDb');
// specs/public-request-abuse-and-grouping.md rule 22 and specs/site-traffic-analytics.md rule 15 (readings of 2026-11-05,
// audit R23 public finding 6): one cleaner for the visitor's free text. Control and bidi characters leave the message and
// the attribution before the length check and the fingerprint; line breaks and tabs stay in a message, joiners everywhere.
const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanFreeText, validateAttribution } = require('../publicInputValidation');
const db = require('../../../database');
const settings = require('../settings');

settings.termsSettings = () => ({ requireTermsAcceptance: false });
const bookingCtl = require('../controllers/publicBookingRequestController');

const pad = (n) => String(n).padStart(2, '0');
const localDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const propertyId = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)")
  .run(propertyId, JSON.stringify([{ startDate: localDay(0), endDate: localDay(400) }]));

let sent = 0;
function send(fields, { email, offset } = {}) {
  sent += 1;
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const day = offset ?? 30;
  bookingCtl.create({
    body: {
      propertyId,
      startDate: localDay(day),
      endDate: localDay(day + 3),
      adults: 2,
      guest: { firstName: 'Zoé', lastName: 'Martin', email: email || `text${sent}@example.test`, phone: '0612345678' },
      ...fields,
    },
    headers: {},
    query: {},
  }, res);
  return res;
}
const rowOf = (res) => db.prepare('SELECT notes, attribution, attributionLabel FROM reservations WHERE id = ?').get(res.body.data.requestId);

test('cleanFreeText — control and format characters go, line breaks, tabs, joiners and visible text stay', () => {
  assert.equal(cleanFreeText('Bon\u0000jour \u0007\u001b[31m'), 'Bonjour [31m');
  assert.equal(cleanFreeText('a\u202Eb\uFEFFc\u200Bd\u00ADe'), 'abcde');
  assert.equal(cleanFreeText('un\r\ndeux\rtrois\nquatre\tcinq'), 'un\ndeux\ntrois\nquatre\tcinq');
  assert.equal(cleanFreeText('\u0085x\u009F'), 'x');
  assert.equal(cleanFreeText('سارا\u200Cی 👨\u200D👩\u200D👧'), 'سارا\u200Cی 👨\u200D👩\u200D👧');
  assert.equal(cleanFreeText('<b>é</b> 😀'), '<b>é</b> 😀');
  for (const notText of [null, undefined, 1, {}, []]) assert.equal(cleanFreeText(notText), '');
});

test('rule 22 — the message is stored clean', () => {
  const res = send({ message: '\uFEFFBonjour\u0000 \u0007\u001b[31mRED\u001b[0m \u202Eabc\u202C\r\nLigne 2\t!\u0000' });
  assert.equal(res.statusCode, 201);
  assert.equal(rowOf(res).notes, 'Bonjour [31mRED[0m abc\nLigne 2\t!');
});

test('rule 22 — the length is judged on the cleaned message', () => {
  assert.equal(send({ message: `${'x'.repeat(2000)}\u0000\u200B\u202E` }).statusCode, 201);
  const refused = send({ message: 'x'.repeat(2001) });
  assert.equal(refused.statusCode, 422);
  assert.equal(refused.body.error.details[0].field, 'message');
});

test('rule 22 — a message of invisible bytes is no message', () => {
  const res = send({ message: '\u0000\u200B\u202E \r\n' });
  assert.equal(res.statusCode, 201);
  assert.equal(rowOf(res).notes, '');
});

test('rule 13 — invisible bytes do not make another request: the fingerprint reads the cleaned message', () => {
  const email = 'double@example.test';
  const first = send({ message: 'Arrivée tard' }, { email, offset: 60 });
  const notes = rowOf(first).notes;
  const second = send({ message: 'Arrivée\u200B tard\u0000' }, { email, offset: 60 });
  assert.equal(second.statusCode, 201);
  assert.equal(second.body.data.updated, false, 'a double click changes nothing');
  assert.equal(rowOf(first).notes, notes);
});

test('rule 15 — the attribution keeps one clean line and never refuses', () => {
  assert.deepEqual(validateAttribution({
    utmSource: 'x\u0000y\u001b[31m',
    utmMedium: '\u202Ecpc',
    utmCampaign: 'été\r\n2027',
    utmContent: 'a\tb',
    utmTerm: '\u200B\u0000',
    landingPath: '/a\u0000\r\nb',
  }), { utmSource: 'xy[31m', utmMedium: 'cpc', utmCampaign: 'été 2027', utmContent: 'a b', landingPath: '/a b' });
  assert.equal(validateAttribution({ utmSource: '\u0000' }), null);
  assert.equal(validateAttribution({ landingPath: '\u200B/x' }).landingPath, '/x');
  assert.equal(validateAttribution({ utmSource: `${'\u0000'.repeat(300)}x` }).utmSource, 'x');
});

test('rule 15 — the referrer and the first visit are judged as sent: a bad one is dropped', () => {
  assert.equal(validateAttribution({ referrer: 'exa\u0000mple.com' }), null);
  assert.equal(validateAttribution({ referrer: 'example.com' }).referrer, 'example.com');
  assert.equal(validateAttribution({ firstSeenAt: '\u00002027-01-01' }), null);
});

test('rule 15 — the stored attribution and its label are the clean ones', () => {
  const res = send({ attribution: { utmSource: 'x\u0000y', utmCampaign: 'été\u202E\u0000 2027', landingPath: '/a\u0000\r\nb' } });
  assert.equal(res.statusCode, 201);
  const row = rowOf(res);
  assert.doesNotMatch(row.attribution, /\\u0000|\\u202e/i);
  assert.deepEqual(JSON.parse(row.attribution), { utmSource: 'xy', utmCampaign: 'été 2027', landingPath: '/a b' });
  assert.equal(row.attributionLabel, 'été 2027');
});
