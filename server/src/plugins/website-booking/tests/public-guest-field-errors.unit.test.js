require('./isolatedDb');
// specs/wordpress-plugin.md rule 28 (UI/UX review 2026-10-18, decision 3) — every refused contact
// field carries its own sentence in the visitor's language, so the site prints it under that field
// instead of one generic line under the button. `field` and `issue` never move: additions only.
const test = require('node:test');
const assert = require('node:assert/strict');

// The public boundary refuses a stay starting before today (specs/public-api.md rule 8) and these
// fixtures' dates are fixed: today is pinned before all of them.
require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2026-01-01';
const Module = require('module');
const { validateGuest, withFieldMessages } = require('../publicInputValidation');
const { labels } = require('../../../utils/publicLabels');

test('an empty field reads « Champ requis. », a malformed address « Adresse e-mail incomplète. »', () => {
  const bad = validateGuest({ firstName: 'Aleksandra', lastName: '', email: 'jo@', phone: '' });
  assert.equal(bad.ok, false);
  const out = withFieldMessages(bad.errors, labels('fr').fieldErrors);
  assert.deepEqual(out, [
    { field: 'guest.lastName', issue: 'required', reason: 'required', message: 'Champ requis.' },
    { field: 'guest.email', issue: 'must be a valid email', reason: 'emailInvalid', message: 'Adresse e-mail incomplète.' },
    { field: 'guest.phone', issue: 'required', reason: 'required', message: 'Champ requis.' },
  ]);
});

test('an empty e-mail is a missing field, not a malformed one — and its issue keeps its old wording', () => {
  const bad = validateGuest({ firstName: 'A', lastName: 'B', email: '   ', phone: '0612345678' });
  assert.deepEqual(bad.errors, [{ field: 'guest.email', issue: 'must be a valid email', reason: 'required' }]);
});

test('the sentences exist in English too, and the summary message is impersonal in both', () => {
  assert.deepEqual(labels('en').fieldErrors, { required: 'Required.', emailInvalid: 'Incomplete email address.', phoneInvalid: 'Invalid phone number.', tooLong: 'Text too long.' });
  assert.equal(labels('fr').errors.clientInvalid, 'Coordonnées incomplètes ou invalides.');
  assert.equal(labels('en').errors.clientInvalid, 'Contact details incomplete or invalid.');
});

test('an error without a reason passes through untouched', () => {
  const e = [{ field: 'startDate', issue: 'must be an ISO date (YYYY-MM-DD)' }];
  assert.deepEqual(withFieldMessages(e, labels('fr').fieldErrors), e);
});

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function controller() {
  const mod = '../controllers/publicBookingRequestController';
  return withMocks({
    '../../database': { transaction: (fn) => fn, prepare: () => ({ get: () => ({}), run: () => ({}) }) },
    '../../models/clientsModel': {},
    '../../models/devisModel': {},
    './publicCatalogController': { computeBlockedDates: () => [], rangeHasBlockedNight: () => false },
    './publicQuoteController': { buildEngineQuote: () => ({}), checkOptionApplicability: () => null, checkResourceApplicability: () => null },
    '../settings': { termsSettings: () => ({ requireTermsAcceptance: false }), recordPluginVersion: () => {} },
    '../../models/termsModel': { getCurrent: () => null },
  }, () => {
    delete require.cache[require.resolve(mod)];
    return require(mod);
  });
}

function call(body, query = {}) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
  controller().create({ body, query }, res);
  return res;
}

const stay = { propertyId: 1, startDate: '2026-09-10', endDate: '2026-09-13', adults: 2 };

test('POST /booking-requests: 422 with one message per refused field, in the page language', () => {
  const fr = call({ ...stay, guest: { firstName: 'Jo', lastName: 'Martin', email: 'jo@', phone: '0612345678' } });
  assert.equal(fr.statusCode, 422);
  assert.equal(fr.body.error.code, 'VALIDATION_FAILED');
  assert.equal(fr.body.error.message, 'Coordonnées incomplètes ou invalides.');
  assert.deepEqual(fr.body.error.details, [
    { field: 'guest.email', issue: 'must be a valid email', reason: 'emailInvalid', message: 'Adresse e-mail incomplète.' },
  ]);

  const en = call({ ...stay, guest: { firstName: '', lastName: 'Martin', email: 'jo@example.com', phone: '0612345678' } }, { lang: 'en' });
  assert.equal(en.body.error.message, 'Contact details incomplete or invalid.');
  assert.deepEqual(en.body.error.details, [
    { field: 'guest.firstName', issue: 'required', reason: 'required', message: 'Required.' },
  ]);
});

// specs/public-api.md rule 20 (audit 2026-10-28, injection finding 2) — a name or phone of 40 000 characters used to be stored and
// flow into every e-mail, PDF and CSV: refused at the boundary, field by field.
test('a first name, last name, phone or e-mail past its cap is refused with its own field error', () => {
  const ok = validateGuest({ firstName: 'a'.repeat(100), lastName: 'b'.repeat(100), email: 'a@b.fr', phone: `+33612345678${' '.repeat(28)}` });
  assert.equal(ok.ok, true, 'the caps themselves are accepted');
  const bad = validateGuest({ firstName: 'a'.repeat(101), lastName: 'b'.repeat(40009), email: 'a@b.fr', phone: `+33612345678${' '.repeat(29)}1` });
  assert.deepEqual(bad.errors.map((e) => [e.field, e.reason]), [
    ['guest.firstName', 'tooLong'], ['guest.lastName', 'tooLong'], ['guest.phone', 'tooLong'],
  ]);
  const out = withFieldMessages(bad.errors, labels('fr').fieldErrors);
  assert.equal(out[0].message, 'Texte trop long.');
  assert.equal(validateGuest({ firstName: 'A', lastName: 'B', email: `${'a'.repeat(250)}@b.fr`, phone: '0612345678' }).errors[0].reason, 'tooLong');
});
