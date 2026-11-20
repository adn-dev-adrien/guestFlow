// specs/pricing-components.md §3 rule 47 (reading of L6) — `makeArticle` reads the family only within the kind's own price types.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeArticle } = require('../utils/pricing/articles/makeArticle');

test('rule 47 — a price type of the other kind reads as fixed', () => {
  assert.equal(makeArticle({ id: 1, name: 'Vélo', priceType: 'percent_of_stay' }, { kind: 'resource' }).family, 'fixed');
  assert.equal(makeArticle({ id: 1, name: 'Vélo', priceType: 'per_participant_progressive' }, { kind: 'resource' }).family, 'fixed');
  assert.equal(makeArticle({ id: 2, title: 'Atelier', priceType: 'per_hour' }, { kind: 'option' }).family, 'fixed');
});

test('rule 47 — the kind\'s own price types keep their family', () => {
  assert.equal(makeArticle({ id: 1, name: 'Vélo', priceType: 'per_hour' }, { kind: 'resource' }).family, 'hourly');
  assert.equal(makeArticle({ id: 1, name: 'Vélo', priceType: 'per_night' }, { kind: 'resource' }).family, 'perNight');
  assert.equal(makeArticle({ id: 2, title: 'Assurance', priceType: 'percent_of_stay' }, { kind: 'option' }).family, 'percentOfStay');
  assert.equal(makeArticle({ id: 2, title: 'Atelier', priceType: 'per_participant_progressive' }, { kind: 'option' }).family, 'perParticipantProgressive');
  assert.equal(makeArticle({ id: 2, title: 'Petit-déj', priceType: 'per_person', showsPlanningCard: 1 }, { kind: 'option' }).family, 'perUnit');
  assert.equal(makeArticle({ id: 2, title: 'X', priceType: 'per_week' }, { kind: 'option' }).family, 'fixed');
});
