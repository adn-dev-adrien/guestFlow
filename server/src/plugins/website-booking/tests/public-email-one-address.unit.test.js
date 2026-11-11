require('./isolatedDb');
// specs/public-request-abuse-and-grouping.md edge cases and rules 7, 12 (reading of 2026-11-05, audit R23 public findings
// 4 and 5), specs/public-api.md rule 21: one address reads as one address. An uppercase non-ASCII letter or an invisible
// character no longer makes a second client, a second quote of the same stay, or a way round the cap of 3.
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateGuest } = require('../publicInputValidation');
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
const guest = { firstName: 'Zoé', lastName: 'Martin', email: 'zoe@example.test', phone: '0612345678' };

const propertyId = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)")
  .run(propertyId, JSON.stringify([{ startDate: localDay(0), endDate: localDay(400) }]));

function send(email, offset) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  bookingCtl.create({
    body: { propertyId, startDate: localDay(offset), endDate: localDay(offset + 3), adults: 2, guest: { ...guest, email } },
    headers: {},
    query: {},
  }, res);
  return res;
}
const clientsLike = (like) => db.prepare('SELECT email FROM clients WHERE email LIKE ?').all(like).map((c) => c.email);
const quotesOf = (email) => db.prepare(`
  SELECT COUNT(*) AS n FROM reservations r JOIN clients c ON c.id = r.clientId WHERE c.email = ? AND r.kind = 'devis'
`).get(email).n;

test('rules 7 and 12 — an uppercase non-ASCII address: same client, same stay updated, cap of 3 counted', () => {
  assert.equal(send('ÉMILIE@example.test', 30).statusCode, 201);
  const again = send('ÉMILIE@example.test', 30);
  assert.equal(again.statusCode, 201);
  assert.equal(again.body.data.updated, false, 'a double click changes nothing');
  assert.equal(quotesOf('émilie@example.test'), 1, 'the same stay is the same quote');
  assert.equal(send('Émilie@Example.test', 40).statusCode, 201);
  assert.equal(send('émilie@example.test', 50).statusCode, 201);
  const fourth = send('ÉMILIE@EXAMPLE.TEST', 60);
  assert.equal(fourth.statusCode, 429);
  assert.equal(fourth.body.error.code, 'TOO_MANY_REQUESTS');
  assert.deepEqual(clientsLike('%milie@%'), ['émilie@example.test']);
});

test('rules 7 and 12 — an ASCII address keeps its case and still counts as one', () => {
  assert.equal(send('ANNA@example.test', 30).statusCode, 201);
  assert.equal(send('anna@example.test', 40).statusCode, 201);
  assert.deepEqual(clientsLike('anna@%'), ['ANNA@example.test']);
});

test('rule 21 — every format character leaves the address, joiners included, and the guest lands on the real one', () => {
  for (const mark of ['\u200B', '\u200C', '\u200D', '\u202E', '\u00AD', '\uFEFF', '\u2060', '\u180E']) {
    for (const typed of [`zo${mark}e@example.test`, `zoe@exa${mark}mple.test`, `zoe@example.test${mark}`, `${mark}zoe@example.test`]) {
      const out = validateGuest({ ...guest, email: typed });
      assert.equal(out.ok, true, JSON.stringify(typed));
      assert.equal(out.value.email, 'zoe@example.test');
    }
  }
  const nothing = validateGuest({ ...guest, email: '\u200B\u202E' });
  assert.equal(nothing.errors[0].reason, 'required');
  assert.equal(validateGuest({ ...guest, email: 'zo e@example.test' }).errors[0].reason, 'emailInvalid');
});

test('rule 21 — an address with a zero-width space reaches the client without it, one row only', () => {
  assert.equal(send('camille@example.test', 30).statusCode, 201);
  const hidden = send('camille\u200B@example.test', 30);
  assert.equal(hidden.statusCode, 201);
  assert.equal(hidden.body.data.updated, false);
  assert.equal(quotesOf('camille@example.test'), 1);
  assert.equal(send('cami\u00ADlle@example.test', 40).statusCode, 201);
  assert.deepEqual(clientsLike('cam%'), ['camille@example.test']);
});
