// specs/hosting-h2-account-security.md rule 66 (audit r4, R4-2) — the support journal the customer reads
// labels a request by the first segment of its path; `constructor` and `__proto__` name nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const { requestLabel, readTarget } = require('../utils/supportLogLabels');

test('rule 66: a prototype key as the first path segment gets the generic label', () => {
  for (const section of ['constructor', '__proto__', 'hasOwnProperty', 'toString']) {
    assert.equal(requestLabel('GET', `/api/${section}`), 'Consultation', section);
    assert.equal(requestLabel('POST', `/api/${section}/12/x`), 'Modification', section);
    assert.equal(requestLabel('GET', `/api/${section}/12`), 'Consultation', section);
    assert.equal(readTarget('GET', `/api/${section}/12`, 200), null, section);
    assert.equal(readTarget('GET', `/api/${section}`, 200), null, section);
  }
});

test('rule 66: the real sections keep their labels', () => {
  assert.match(requestLabel('GET', '/api/reservations/12'), /^Réservation 12 /);
  assert.match(requestLabel('GET', '/api/reservations'), /^Consultation : /);
});
