// specs/hosting-h2-account-security.md rule 23 — the support journal the customer reads folds the
// reads of one minute (the pages opened and the API calls behind them) into one line
// « Consultation : Planning, Linge », each name once; writes, refusals and the sign-in keep their line.

const test = require('node:test');
const assert = require('node:assert/strict');
const { journal, readTarget } = require('../utils/supportLogLabels');

// Stored newest first, as `supportAccessModel.logs` returns them.
const rows = [
  { at: '2026-10-18T10:03:20.000Z', method: 'GET', path: '/api/clients', summary: '200' },
  { at: '2026-10-18T10:03:05.000Z', method: 'POST', path: '/api/clients', summary: '201' },
  { at: '2026-10-18T10:02:40.000Z', method: 'GET', path: '/api/laundry/plan', summary: '200' },
  { at: '2026-10-18T10:02:30.000Z', method: 'GET', path: '/api/laundry', summary: '200' },
  { at: '2026-10-18T10:02:10.000Z', method: 'PAGE', path: '/planning', summary: null },
  { at: '2026-10-18T10:02:09.000Z', method: 'GET', path: '/api/planning', summary: '200' },
  { at: '2026-10-18T10:02:01.000Z', method: 'GET', path: '/api/reservations/12', summary: '403' },
  { at: '2026-10-18T10:01:50.000Z', method: 'GET', path: '/api/planning', summary: '200' },
  { at: '2026-10-18T10:01:40.000Z', method: 'PAGE', path: '/planning', summary: null },
  { at: '2026-10-18T10:01:30.000Z', method: 'LOGIN', path: '/api/auth/support', summary: null },
];

test('rule 23 — consecutive reads of one minute fold into one line, each name once', () => {
  assert.deepEqual(journal(rows).map((l) => [l.at.slice(11, 19), l.label, l.outcomeLabel]), [
    ['10:03:20', 'Consultation : Clients', ''],
    ['10:03:05', 'Client créé', 'Effectué'],
    ['10:02:40', 'Consultation : Planning, Linge', ''],
    ['10:02:01', 'Réservation 12 consultée', 'Refusé'],
    ['10:01:50', 'Consultation : Planning', ''],
    ['10:01:30', 'Connexion du support', ''],
  ]);
});

test('rule 23 — a read that names nothing folds silently; a minute of such reads still reads « Consultation »', () => {
  assert.equal(readTarget('GET', '/api/unknown-thing', '200'), null);
  assert.equal(readTarget('GET', '/api/reservations/12', '200'), 'Réservation 12');
  assert.equal(readTarget('GET', '/api/reservations/12', '404'), undefined, 'a refused read keeps its own line');
  assert.equal(readTarget('PUT', '/api/reservations/12', '200'), undefined);
  assert.deepEqual(journal([
    { at: '2026-10-18T10:05:02.000Z', method: 'GET', path: '/api/unknown-thing', summary: '200' },
    { at: '2026-10-18T10:05:01.000Z', method: 'PAGE', path: '/nowhere', summary: null },
  ]).map((l) => l.label), ['Consultation']);
});
