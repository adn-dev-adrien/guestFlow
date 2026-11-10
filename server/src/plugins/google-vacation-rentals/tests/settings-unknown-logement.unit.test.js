// specs/google-vacation-rentals-feed.md rule 20 (audit R42-EXT-L2, 2026-11-10) — the `properties` setting names logements
// of the core, or keys already stored; Envoi counts only the enabled entries of real logements.
const test = require('node:test');
const assert = require('node:assert/strict');
const { declared } = require('../settings');
const { memoryStore, DEFAULTS } = require('./memoryStore');

const validator = (store, key, ids) => declared(store, { listProperties: () => ids.map((id) => ({ id, name: `L${id}` })) })
  .find((d) => d.key === key).validate;
const entry = (enabled = true, hotelCode = 'code-a') => ({ enabled, hotelCode });

test('rule 20 — a key that names no logement is « Logement inconnu. »; a real one passes', () => {
  const properties = validator(memoryStore({}, DEFAULTS), 'properties', [1]);
  assert.equal(properties(JSON.stringify({ 2: entry() }), {}), 'Logement inconnu.');
  assert.equal(properties(JSON.stringify({ 1: entry() }), {}), null);
});

test('rule 20 — a key already stored stays accepted (a deleted logement never blocks a save)', () => {
  const store = memoryStore({ properties: JSON.stringify({ 7: entry(false, 'gone-code') }) }, DEFAULTS);
  const properties = validator(store, 'properties', [1]);
  assert.equal(properties(JSON.stringify({ 1: entry(), 7: entry(false, 'gone-code') }), {}), null);
  assert.equal(properties(JSON.stringify({ 1: entry(), 8: entry(false) }), {}), 'Logement inconnu.');
});

test('rule 20 — Envoi needs an enabled entry of a real logement, not of a stored deleted one', () => {
  const store = memoryStore({ partnerId: 'solio-123', properties: JSON.stringify({ 7: entry(true, 'gone-code') }) }, DEFAULTS);
  const mode = validator(store, 'mode', [1]);
  assert.equal(mode('envoi', { mode: 'envoi' }), 'Envoi impossible : aucun logement activé.');
  assert.equal(mode('envoi', { mode: 'envoi', properties: JSON.stringify({ 1: entry() }) }), null);
});
