// specs/email-client-language-and-fiche-polish.md rule 4 and rule 7 (2026-10-27 spec review): the
// options listed in a guest e-mail (`reservedOptionsLabel`) read in the guest's language — the
// catalogue's English title when there is one, else the French title.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStayContent } = require('../utils/stayContentContext');

const LINES = [
  { optionId: 9, title: 'Planche du terroir', titleEn: 'Local platter', quantity: 1 },
  { optionId: 10, title: 'Bois de chauffage', titleEn: null, quantity: 1 },
];

function label(lang) {
  const { vars } = buildStayContent({
    reservation: { id: 1, startDate: '2027-07-10', endDate: '2027-07-12', adults: 2, platform: 'direct' },
    client: { id: 1, email: 'c@x.fr' },
    property: { name: 'La Granja', nameArticle: 'à' },
    options: LINES,
    facts: {},
    lang,
  });
  return vars.reservedOptionsLabel;
}

test('an English e-mail lists a booked option under its English title, falling back to French', () => {
  assert.equal(label('en'), 'Local platter, Bois de chauffage');
});

test('a French e-mail keeps the French titles', () => {
  assert.equal(label('fr'), 'Planche du terroir, Bois de chauffage');
});
