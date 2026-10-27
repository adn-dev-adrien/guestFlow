require('./isolatedDb');
// specs/terms-acceptance-record.md rule 30 (fixed at the 2026-10-27 spec review) — the CGV refusals of a
// booking request (503 TERMS_NOT_CONFIGURED, 422 TERMS_NOT_ACCEPTED, 409 TERMS_OUTDATED) speak the
// visitor's language like every other public error: an English page used to read them in French.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: true });
const termsModel = require('../../../models/termsModel');
let current = null;
termsModel.getCurrent = () => current;
const bookingCtl = require('../controllers/publicBookingRequestController');

function send(lang, extra = {}) {
  const r = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  bookingCtl.create({
    body: {
      propertyId: 1, startDate: '2027-08-10', endDate: '2027-08-12', adults: 2, lang,
      guest: { firstName: 'Mary', lastName: 'Smith', email: 'mary@example.com', phone: '+447700900123' }, ...extra,
    },
    query: {}, headers: {}, visitor: { ip: '81.250.12.4' },
  }, r);
  return r;
}

test('rule 30: nothing published → 503 in English and in French', () => {
  current = null;
  const en = send('en');
  assert.equal(en.statusCode, 503);
  assert.equal(en.body.error.code, 'TERMS_NOT_CONFIGURED');
  assert.equal(en.body.error.message, 'Online booking is temporarily unavailable.');
  assert.equal(send('fr').body.error.message, 'Les réservations en ligne sont momentanément indisponibles.');
});

test('rule 30: not accepted → 422 in English', () => {
  current = { id: 3, version: 2 };
  const en = send('en');
  assert.equal(en.statusCode, 422);
  assert.equal(en.body.error.code, 'TERMS_NOT_ACCEPTED');
  assert.equal(en.body.error.message, 'You must accept the terms and conditions of rental.');
});

test('rule 30: an outdated version → 409 in English, the current version still in details', () => {
  current = { id: 3, version: 2 };
  const en = send('en', { termsVersion: 1 });
  assert.equal(en.statusCode, 409);
  assert.equal(en.body.error.code, 'TERMS_OUTDATED');
  assert.equal(en.body.error.message, 'The terms and conditions have been updated. Please read and accept them again.');
  assert.equal(en.body.error.details[0].currentVersion, 2);
  assert.match(send('fr', { termsVersion: 1 }).body.error.message, /^Les conditions générales ont été mises à jour/);
});
