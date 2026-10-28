// specs/email-language-fr-en.md rule 10 (2026-10-27 spec review): one amount format across every guest
// e-mail — « 1 234,56 € » with a narrow no-break space, « €1,234.56 » in English, no « ,00 » on a
// whole amount, so the caution no longer reads « 500,00 € » beside a « 45 € » of the stay texts.

const test = require('node:test');
const assert = require('node:assert/strict');

const { emailAmount, NARROW_NBSP } = require('../utils/emailMoney');
const { buildContext } = require('../utils/emailContextBuilder');

// « 1 234,56_€ »: the thousands take the narrow no-break space, « _ » is the plain space before « € ».
const fr = (s) => s.replace(/ /g, NARROW_NBSP).replace(/_/g, ' ');

test('French amounts group the thousands with a narrow no-break space', () => {
  assert.equal(emailAmount(1234.56, 'fr'), fr('1 234,56_€'));
  assert.equal(emailAmount(1234567, 'fr'), fr('1 234 567_€'));
  assert.equal(emailAmount(45.5, 'fr'), fr('45,50_€'));
  assert.equal(emailAmount(500, 'fr'), fr('500_€'));
  assert.equal(emailAmount(0.05, 'fr'), fr('0,05_€'));
  assert.equal(emailAmount(-12.3, 'fr'), fr('-12,30_€'));
});

test('English amounts read « €1,234.56 », a whole amount « €500 »', () => {
  assert.equal(emailAmount(1234.56, 'en'), '€1,234.56');
  assert.equal(emailAmount(500, 'en'), '€500');
  assert.equal(emailAmount(963.39, 'en'), '€963.39');
});

test('the context amounts share the format: stay amount, caution and complement', () => {
  const { vars } = buildContext({
    reservation: { id: 1, startDate: '2027-07-10', endDate: '2027-07-12', finalPrice: 1234.56, cautionAmount: 500, platform: 'direct' },
    client: { firstName: 'Ada', email: 'a@x.fr' },
    property: { name: 'La Granja', nameArticle: 'à', defaultCautionAmount: 500 },
    options: [], resources: [], customOptions: [], settings: {}, lang: 'fr',
  });
  assert.equal(vars.finalPrice, fr('1 234,56_€'));
  assert.equal(vars.cautionAmount, fr('500_€'));
});
