// specs/deposit-blocks-the-dates.md §3.1 — the quote says what the payment buys: on a direct-channel
// quote the acompte box carries « le règlement bloque vos dates », and a quote with no acompte asks
// for a « Paiement intégral » instead of a solde that never existed. PDFKit encodes text as glyph
// indexes, so the rendered bytes can't be grep'd: the decision is proven on the pure resolver the
// renderer reads, and the copy on the label maps.

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../utils/devisPdf');
const { labels, FR, EN } = require('../utils/devisPdfLabels');

const { resolvePaymentBlock } = __test;
const NEW_KEYS = ['depositSecuresDates', 'fullPaymentLabel', 'fullPaymentSecuresDates'];

test('a direct quote with an acompte: the mention is printed, the block keeps its two rows', () => {
  const b = resolvePaymentBlock({ platform: 'direct', depositAmount: 129, balanceAmount: 307 });
  assert.equal(b.securesDates, true);
  assert.equal(b.isFullPayment, false, 'there is an acompte — the second row is still a solde');
});

test('a direct quote with no acompte asks for one full payment', () => {
  const b = resolvePaymentBlock({ platform: 'direct', depositAmount: 0, balanceAmount: 436 });
  assert.equal(b.isFullPayment, true);
});

test('own channels are direct — Lodgify quotes carry the mention too', () => {
  assert.equal(resolvePaymentBlock({ platform: 'Lodgify', depositAmount: 129, balanceAmount: 307 }).securesDates, true);
  assert.equal(resolvePaymentBlock({ platform: null, depositAmount: 129, balanceAmount: 307 }).securesDates, true,
    'no platform stored means direct');
});

test('a platform quote is left alone: no mention, no renaming', () => {
  for (const platform of ['Airbnb', 'Booking', 'Abracadaroom']) {
    const b = resolvePaymentBlock({ platform, depositAmount: 0, balanceAmount: 436 });
    assert.equal(b.securesDates, false, `${platform}: the platform holds the dates, not us`);
    assert.equal(b.isFullPayment, false, `${platform}: its solde stays a solde`);
  }
});

test('nothing left to collect → no full-payment row to name', () => {
  assert.equal(resolvePaymentBlock({ platform: 'direct', depositAmount: 0, balanceAmount: 0 }).isFullPayment, false);
});

test('the new copy exists in both languages and never leaks the other one', () => {
  for (const key of NEW_KEYS) {
    assert.ok(key in FR && key in EN, `${key} must exist in both maps`);
    for (const lang of ['fr', 'en']) {
      assert.equal(typeof labels(lang)[key], 'string');
      assert.ok(labels(lang)[key].length > 0, `labels(${lang}).${key} must not be empty`);
    }
    assert.notEqual(labels('fr')[key], labels('en')[key], `${key} must actually be translated`);
  }
  assert.match(labels('fr').depositSecuresDates, /bloque vos dates/);
  assert.match(labels('en').depositSecuresDates, /secures your dates/);
  assert.equal(labels('fr').fullPaymentLabel, 'Paiement intégral :');
  assert.equal(labels('en').fullPaymentLabel, 'Full payment:');
});

test('the mention says the same thing as the deposit-request email — one promise, one wording', () => {
  const { DEFAULT_TEMPLATES } = require('../utils/defaultEmailTemplatesRegistry');
  const depositRequest = DEFAULT_TEMPLATES.find((t) => t.stableKey === 'deposit_request');
  assert.match(depositRequest.body, /bloque vos dates/);
  assert.match(labels('fr').depositSecuresDates, /restent disponibles et peuvent être réservées par un autre client/);
  assert.match(depositRequest.body, /restent disponibles et peuvent être réservées par un autre client/);
});
