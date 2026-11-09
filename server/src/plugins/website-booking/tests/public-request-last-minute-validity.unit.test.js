require('./isolatedDb');
// specs/devis-pdf-and-tourist-tax-fixes.md §3.2 rule 6 reading R30-RES-M1 (2026-11-08) — the site accepts an
// arrival from today on (public-api rule 11): the draft devis a request for tomorrow or today creates stands,
// and is due, on its issue day, never « born expired » before the operator even opens it.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
const bookingCtl = require('../controllers/publicBookingRequestController');
const devisModel = require('../../../models/devisModel');
const { todayIso } = require('../../../utils/localDate');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

const TODAY = todayIso();
const inDays = (n) => addDaysToIsoDate(TODAY, n);
const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)`)
  .run(pid, JSON.stringify([{ startDate: inDays(-10), endDate: inDays(60) }]));

function request(startIn, email) {
  const r = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  bookingCtl.create({
    body: {
      propertyId: pid, startDate: inDays(startIn), endDate: inDays(startIn + 2), adults: 2,
      guest: { firstName: 'Lea', lastName: 'Martin', email, phone: '06 12 34 56 78' },
    },
    headers: {}, query: {},
  }, r);
  return r;
}

for (const [startIn, email] of [[1, 'lea1@example.fr'], [0, 'lea0@example.fr']]) {
  test(`a site request arriving at +${startIn} day(s) leaves a devis valid and due today`, () => {
    const r = request(startIn, email);
    assert.equal(r.statusCode, 201, JSON.stringify(r.body));
    const id = r.body.data.requestId;
    const row = db.prepare('SELECT validUntil, balanceDueDate, depositDueDate FROM reservations WHERE id = ?').get(id);
    assert.equal(row.validUntil, TODAY);
    for (const due of [row.balanceDueDate, row.depositDueDate].filter(Boolean)) assert.ok(due >= TODAY, `due ${due}`);
    const read = devisModel.findById(id);
    assert.equal(read.expired, false);
    assert.equal(read.extendable, false);
  });
}
