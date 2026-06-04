const test = require('node:test');
const assert = require('node:assert/strict');

const { formatPlatformName } = require('../utils/platformNameFormat');

// specs/normalize-platform-names.md §3.1 + §7.1.

test('preserves the `direct` enum value as lowercase regardless of input casing', () => {
  for (const input of ['direct', 'Direct', 'DIRECT', '  direct  ']) {
    assert.equal(formatPlatformName(input), 'direct');
  }
});

test('strips diacritics before capitalization', () => {
  assert.equal(formatPlatformName('Gîtes de France'), 'GitesDeFrance');
  assert.equal(formatPlatformName('Hôtel'), 'Hotel');
  assert.equal(formatPlatformName('Aéroport'), 'Aeroport');
});

test('splits on whitespace and capitalizes each segment (UpperCamelCase)', () => {
  assert.equal(formatPlatformName('gites de france'), 'GitesDeFrance');
  assert.equal(formatPlatformName('  Stripe  via  Greengo  '), 'StripeViaGreengo');
});

test('single-word inputs are first-letter capitalized', () => {
  assert.equal(formatPlatformName('gitedefrance'), 'Gitedefrance');
  assert.equal(formatPlatformName('Gitedefrance'), 'Gitedefrance');
  assert.equal(formatPlatformName('airbnb'), 'Airbnb');
  assert.equal(formatPlatformName('AIRBNB'), 'Airbnb');
  assert.equal(formatPlatformName('lodgify'), 'Lodgify');
  assert.equal(formatPlatformName('Lodgify'), 'Lodgify');
});

test('splits on punctuation (hyphen, underscore, parentheses, dots)', () => {
  assert.equal(formatPlatformName('Stripe (Greengo)'), 'StripeGreengo');
  assert.equal(formatPlatformName('Booking.com'), 'BookingCom');
  assert.equal(formatPlatformName('air-bnb'), 'AirBnb');
  assert.equal(formatPlatformName('vrbo_us'), 'VrboUs');
});

test('preserves typos verbatim (formatter is not a spell-checker)', () => {
  // Prod data quality: `logify` is a typo of `lodgify` in a historical reservation.
  assert.equal(formatPlatformName('logify'), 'Logify');
});

test('null and undefined return null (no-write semantics)', () => {
  assert.equal(formatPlatformName(null), null);
  assert.equal(formatPlatformName(undefined), null);
});

test("empty / whitespace / punctuation-only inputs return ''", () => {
  assert.equal(formatPlatformName(''), '');
  assert.equal(formatPlatformName('   '), '');
  assert.equal(formatPlatformName('!@#$'), '');
  assert.equal(formatPlatformName('   ---   '), '');
});

test('idempotent: f(f(x)) === f(x) for every canonical form', () => {
  const inputs = [
    'gitedefrance', 'Gitedefrance', 'Gîtes de France', 'GitesDeFrance',
    'lodgify', 'Lodgify',
    'airbnb', 'Airbnb',
    'direct', 'Direct',
    'Stripe (Greengo)', 'StripeGreengo',
    'Booking.com', 'BookingCom',
  ];
  for (const x of inputs) {
    const once = formatPlatformName(x);
    const twice = formatPlatformName(once);
    assert.equal(twice, once, `formatter not idempotent on input "${x}" (once=${once} / twice=${twice})`);
  }
});

test('digits inside platform names are preserved', () => {
  assert.equal(formatPlatformName('Stripe2'), 'Stripe2');
  assert.equal(formatPlatformName('Vrbo 2023'), 'Vrbo2023');
});

test('non-string inputs are coerced via String(...) before processing', () => {
  // The pricing/reservations layers occasionally read numeric or boolean values from the DB
  // due to JSON pass-through. Defensive coercion keeps the formatter from crashing.
  assert.equal(formatPlatformName(42), '42'); // first-letter capitalized of '42' — pass-through digits
  assert.equal(formatPlatformName(true), 'True');
});
