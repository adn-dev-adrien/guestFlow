// specs/email-automation.md rule 19 — an iCal placeholder client is greeted neutrally. Final review
// 2026-10-18, N5: the placeholder « Ical Airbnb » of 22281 read « Bonjour Ical, » / « Hello Ical, »
// in 24 previews.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContext } = require('../utils/emailContextBuilder');
const { renderTemplate } = require('../utils/emailTemplateRenderer');
const { isPlaceholderClient } = require('../utils/placeholderClient');

const reservation = { id: 1, startDate: '2027-07-10', endDate: '2027-07-12', adults: 2, platform: 'airbnb' };
const property = { id: 1, name: 'Gîte' };
const greet = (client, lang = 'fr') => {
  const ctx = buildContext({ reservation, client, property, lang });
  const body = lang === 'en' ? 'Hello {{clientFirstName}},\nSee you soon.' : 'Bonjour {{clientFirstName}},\nÀ bientôt.';
  return renderTemplate({ subject: 'Séjour {{clientFullName}}', body }, ctx);
};

test('rule 19 — « Ical Airbnb » reads « Bonjour, » and « Hello, »', () => {
  assert.equal(greet({ firstName: 'Ical', lastName: 'Airbnb' }).body.split('\n')[0], 'Bonjour,');
  assert.equal(greet({ firstName: 'Ical', lastName: 'Airbnb' }, 'en').body.split('\n')[0], 'Hello,');
  assert.equal(greet({ firstName: 'Ical', lastName: 'Lodgify' }).body.split('\n')[0], 'Bonjour,');
});

test('rule 19 — older placeholders made of platform words read « Bonjour, » too', () => {
  assert.equal(greet({ firstName: 'Reserved', lastName: '' }).body.split('\n')[0], 'Bonjour,');
  assert.equal(greet({ firstName: 'Closed', lastName: 'Not available' }).body.split('\n')[0], 'Bonjour,');
});

test('rule 19 — a guest keeps their first name', () => {
  assert.equal(greet({ firstName: 'Camille', lastName: 'Revue' }).body.split('\n')[0], 'Bonjour Camille,');
  assert.equal(isPlaceholderClient({ firstName: 'Icare', lastName: 'Dupont' }), false);
});

test('rule 19 — only an empty name token before punctuation drops its space', () => {
  const out = renderTemplate(
    { subject: '', body: 'Bonjour {{clientFirstName}} et bienvenue. Code {{gateCode}}.' },
    { vars: { clientFirstName: '', gateCode: '' } },
  );
  assert.equal(out.body, 'Bonjour  et bienvenue. Code .');
});
