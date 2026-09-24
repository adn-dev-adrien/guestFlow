/**
 * specs/site-english-version.md §3 rules 1, 8, 12 — the `lang` parameter on the public envelope.
 *
 * Two promises are under test. A language token must never cost a booking: no value of `lang` may
 * produce an error, and a request that sends none must get byte-identical bytes to before this
 * existed. And `code` must never move — it is what a consumer branches on; only `message` follows
 * the visitor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { ok, fail, failT, langOf, langStated } = require('../controllers/public/publicHttp');

/** Minimal Express double: records what was sent. */
function makeRes() {
  const sent = {};
  return {
    sent,
    status(code) { sent.status = code; return this; },
    json(body) { sent.body = body; return this; },
  };
}

const reqWith = (query = {}, body = {}) => ({ query, body });

test('langOf reads the query first, then the body, then falls back to French', () => {
  assert.equal(langOf(reqWith({ lang: 'en' })), 'en');
  assert.equal(langOf(reqWith({}, { lang: 'en' })), 'en');
  assert.equal(langOf(reqWith({ lang: 'en' }, { lang: 'fr' })), 'en', 'the query wins');
  assert.equal(langOf(reqWith()), 'fr');
  assert.equal(langOf({}), 'fr');
  assert.equal(langOf(undefined), 'fr');
});

test('a malformed language is read as French and never throws', () => {
  for (const lang of ['de', 'zz-ZZ', '', '   ', 42, [], {}, null]) {
    assert.doesNotThrow(() => langOf(reqWith({ lang })));
    assert.equal(langOf(reqWith({ lang })), 'fr');
  }
});

test('a regional English tag still reads as English', () => {
  for (const lang of ['en-GB', 'en_GB', 'EN', 'en-US']) {
    assert.equal(langOf(reqWith({ lang })), 'en');
  }
});

test('langStated tells "nothing said" apart from "said fr" — rule 12 turns on it', () => {
  assert.equal(langStated(reqWith({ lang: 'fr' })), true);
  assert.equal(langStated(reqWith({}, { lang: 'en' })), true);
  assert.equal(langStated(reqWith()), false);
  assert.equal(langStated(reqWith({ lang: '' })), false);
  assert.equal(langStated(reqWith({ lang: '   ' })), false);
});

test('the error code never moves; only the message follows the language', () => {
  const fr = makeRes();
  const en = makeRes();
  failT(fr, reqWith(), 409, 'DATES_UNAVAILABLE', 'datesUnavailable');
  failT(en, reqWith({ lang: 'en' }), 409, 'DATES_UNAVAILABLE', 'datesUnavailable');

  assert.equal(fr.sent.status, en.sent.status);
  assert.equal(fr.sent.body.error.code, en.sent.body.error.code);
  assert.equal(fr.sent.body.error.message, 'Ces dates ne sont plus disponibles.');
  assert.equal(en.sent.body.error.message, 'These dates are no longer available.');
});

test('a request that sends no language gets exactly what it used to get', () => {
  const before = makeRes();
  const after = makeRes();
  fail(before, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
  failT(after, reqWith(), 404, 'PROPERTY_NOT_FOUND', 'propertyNotFound');
  assert.deepEqual(after.sent, before.sent);
});

test('the parameterised min-nights refusal is built in the right language', () => {
  const fr = makeRes();
  const en = makeRes();
  failT(fr, reqWith(), 409, 'MIN_NIGHTS', 'minNights', undefined, 3);
  failT(en, reqWith({ lang: 'en' }), 409, 'MIN_NIGHTS', 'minNights', undefined, 3);
  assert.equal(fr.sent.body.error.message, 'Séjour trop court : minimum 3 nuits.');
  assert.equal(en.sent.body.error.message, 'Stay too short: 3 nights minimum.');
});

test('a single night is not pluralised in either language', () => {
  const fr = makeRes();
  const en = makeRes();
  failT(fr, reqWith(), 409, 'MIN_NIGHTS', 'minNights', undefined, 1);
  failT(en, reqWith({ lang: 'en' }), 409, 'MIN_NIGHTS', 'minNights', undefined, 1);
  assert.equal(fr.sent.body.error.message, 'Séjour trop court : minimum 1 nuit.');
  assert.equal(en.sent.body.error.message, 'Stay too short: 1 night minimum.');
});

test('details survive translation, and carry the engine’s own wording', () => {
  const res = makeRes();
  failT(res, reqWith({ lang: 'en' }), 422, 'VALIDATION_FAILED', 'quoteRefused',
    [{ field: 'quote', issue: 'Logement non trouvé' }]);
  assert.equal(res.sent.body.error.message, 'This request cannot be priced.');
  // The French diagnostic is kept — for us, not for the visitor.
  assert.equal(res.sent.body.error.details[0].issue, 'Logement non trouvé');
});

test('an empty details array is still omitted, in both languages', () => {
  const res = makeRes();
  failT(res, reqWith({ lang: 'en' }), 422, 'VALIDATION_FAILED', 'devisInvalid', []);
  assert.equal('details' in res.sent.body.error, false);
});

test('ok() is untouched by any of this', () => {
  const res = makeRes();
  ok(res, { hello: 'world' });
  assert.deepEqual(res.sent.body, { data: { hello: 'world' } });
  assert.equal(res.sent.status, 200);
});
