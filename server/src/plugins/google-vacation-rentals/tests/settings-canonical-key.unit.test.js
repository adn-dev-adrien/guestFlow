// specs/google-vacation-rentals-feed.md rule 20, reading of 2026-11-10 (audit R43-DB-L1) — the key is the logement's id
// as the page writes it: `{"01": {enabled, hotelCode}}` passed as logement 1, Envoi was accepted, and `properties()`,
// which reads `stored[String(p.id)]`, enabled nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { declared } = require('../settings');
const { memoryStore, DEFAULTS } = require('./memoryStore');

const validator = (store, key, ids) => declared(store, { listProperties: () => ids.map((id) => ({ id, name: `L${id}` })) })
  .find((d) => d.key === key).validate;
const entry = (enabled = true, hotelCode = 'abc') => ({ enabled, hotelCode });

test('rule 20 — « 01 » and « 001 » are not logement 1: « Logement inconnu. »', () => {
  const properties = validator(memoryStore({}, DEFAULTS), 'properties', [1, 2]);
  assert.equal(properties(JSON.stringify({ '01': entry() }), {}), 'Logement inconnu.');
  assert.equal(properties(JSON.stringify({ '002': entry(false) }), {}), 'Logement inconnu.');
  assert.equal(properties(JSON.stringify({ 1: entry() }), {}), null);
});

test('rule 20 — Envoi never counts an entry keyed « 01 »', () => {
  const mode = validator(memoryStore({ partnerId: '123' }, DEFAULTS), 'mode', [1]);
  assert.equal(mode('envoi', { mode: 'envoi', properties: JSON.stringify({ '01': entry() }) }), 'Envoi impossible : aucun logement activé.');
});
