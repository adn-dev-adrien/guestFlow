// specs/clients-upcoming-past-directory.md rule 14 — the line under a client's name, at every threshold.

const test = require('node:test');
const assert = require('node:assert/strict');
const { clientWhenLabel } = require('../utils/clientWhenLabel');

const TODAY = '2026-10-28';
const shift = (days) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const upcoming = (startOffset, endOffset) => clientWhenLabel(
  'upcoming', { startDate: shift(startOffset), endDate: shift(endOffset) }, null, null, TODAY,
);
const past = (endOffset) => clientWhenLabel(
  'past', { startDate: shift(endOffset - 3), endDate: shift(endOffset) }, null, null, TODAY,
);

test('rule 14 — a guest in the house reads « En séjour » with the departure day', () => {
  assert.equal(upcoming(-2, 11), 'En séjour · départ le 08/11');
  assert.equal(upcoming(-3, 0), 'En séjour · départ le 28/10', 'the departure day is still a stay');
});

test('rule 14 — today and tomorrow have their own words', () => {
  assert.equal(upcoming(0, 3), "Arrive aujourd'hui");
  assert.equal(upcoming(1, 3), 'Arrive demain');
});

test('rule 14 — « Arrive dans N j » up to 60 days, then the date', () => {
  assert.equal(upcoming(9, 12), 'Arrive dans 9 j');
  assert.equal(upcoming(60, 63), 'Arrive dans 60 j');
  assert.equal(upcoming(61, 63), 'Arrive le 28/12/2026');
});

test('rule 14 — a stay that ended under 7 days ago says the day', () => {
  assert.equal(past(-1), 'Parti le 27/10');
  assert.equal(past(-6), 'Parti le 22/10');
});

test('rule 14 — weeks under 2 months, months under 2 years, years beyond', () => {
  assert.equal(past(-7), 'Parti il y a 1 sem.');
  assert.equal(past(-21), 'Parti il y a 3 sem.');
  assert.equal(past(-60), 'Parti il y a 8 sem.');
  assert.equal(past(-61), 'Parti il y a 2 mois');
  assert.equal(past(-125), 'Parti il y a 4 mois');
  assert.equal(past(-729), 'Parti il y a 23 mois');
  assert.equal(past(-730), 'Parti il y a 1 an');
  assert.equal(past(-1100), 'Parti il y a 3 ans');
});

test('rule 14 — no stay: the latest devis with its number and status, else the creation date', () => {
  assert.equal(
    clientWhenLabel('none', null, { id: 9, number: 'D-2026-014', status: 'sent' }, '2026-10-01 10:00:00', TODAY),
    'Devis D-2026-014 · envoyé',
  );
  assert.equal(
    clientWhenLabel('none', null, { id: 9, number: null, status: null }, null, TODAY),
    'Devis #9',
  );
  assert.equal(clientWhenLabel('none', null, null, '2026-10-12 08:30:00', TODAY), 'Créé le 12/10/2026');
  assert.equal(clientWhenLabel('none', null, null, null, TODAY), '');
});
