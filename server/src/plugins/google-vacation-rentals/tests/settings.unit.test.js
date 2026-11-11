// specs/google-vacation-rentals-feed.md rules 2, 3, 15, 16 — the plugin's settings and their refusals.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  declared, createSettings, parsePropertiesSetting, slugify,
} = require('../settings');
const { memoryStore, DEFAULTS } = require('./memoryStore');
const validator = (store, key) => declared(store).find((d) => d.key === key).validate;

test('defaults: simulation, 365 days, 14 nights, 4 h (rules 8, 13, 15; Q1)', () => {
  const keys = Object.fromEntries(declared(memoryStore()).map((d) => [d.key, d.default]));
  assert.deepEqual(keys, { partnerId: undefined, ...DEFAULTS });
  const settings = createSettings({ store: memoryStore({}, DEFAULTS), listProperties: () => [] });
  assert.equal(settings.mode(), 'simulation');
  assert.equal(settings.horizonDays(), 365);
  assert.equal(settings.maxLos(), 14);
  assert.equal(settings.fullResendHour(), 4);
});

test('rule 16 — Envoi is refused without a partner id, or without an enabled property', () => {
  const store = memoryStore({}, DEFAULTS);
  const mode = validator(store, 'mode');
  assert.equal(mode('envoi', { mode: 'envoi' }), 'Envoi impossible : identifiant partenaire manquant.');
  assert.equal(mode('envoi', { mode: 'envoi', partnerId: 'solio-123' }), 'Envoi impossible : aucun logement activé.');
  const enabled = JSON.stringify({ 1: { enabled: true, hotelCode: 'solio-la-granja' } });
  assert.equal(mode('envoi', { mode: 'envoi', partnerId: 'solio-123', properties: enabled }), null, 'sent together, accepted');
  store.set('partnerId', 'solio-123');
  store.set('properties', enabled);
  assert.equal(mode('envoi', { mode: 'envoi' }), null, 'already stored, accepted');
  assert.equal(mode('simulation', {}), null);
  assert.equal(mode('live', {}), 'Mode inconnu.');
});

test('rule 16 — in Envoi, the partner id cannot be emptied nor every property switched off', () => {
  const store = memoryStore({ mode: 'envoi', partnerId: 'solio-123' }, DEFAULTS);
  assert.equal(validator(store, 'partnerId')('', { partnerId: '' }), 'Identifiant partenaire requis en mode Envoi.');
  assert.equal(validator(store, 'partnerId')('', { partnerId: '', mode: 'simulation' }), null, 'back to simulation in the same write');
  assert.equal(validator(store, 'properties')('{"1":{"enabled":false}}', {}), 'Au moins un logement en mode Envoi.');
  assert.match(validator(store, 'partnerId')('a b', {}), /lettres, chiffres/);
});

test('rule 3 — HotelCode format, page slug format, one code per listing', () => {
  const check = validator(memoryStore({}, DEFAULTS), 'properties');
  assert.equal(check(JSON.stringify({ 1: { enabled: true, hotelCode: 'solio-la-granja', slug: 'la-granja' } }), {}), null);
  assert.match(check(JSON.stringify({ 1: { enabled: true, hotelCode: 'Solio La Granja' } }), {}), /Code Google/);
  assert.match(check(JSON.stringify({ 1: { enabled: true, hotelCode: 'ab' } }), {}), /3 à 40/);
  assert.match(check(JSON.stringify({ 1: { slug: 'La Granja' } }), {}), /Page du site/);
  assert.equal(check(JSON.stringify({ 1: { slug: 'hebergements/la-granja' } }), {}), null, 'a nested page is allowed');
  assert.match(check(JSON.stringify({ 1: { enabled: true, hotelCode: 'same' }, 2: { enabled: true, hotelCode: 'same' } }), {}), /même code/);
  assert.match(check('not json', {}), /illisible/);
  assert.equal(parsePropertiesSetting('[1]'), null);
});

test('integers are bounded', () => {
  const store = memoryStore({}, DEFAULTS);
  assert.equal(validator(store, 'maxLos')('14'), null);
  assert.match(validator(store, 'maxLos')('0'), /1 et 30/);
  assert.match(validator(store, 'horizonDays')('900'), /30 et 500/);
  assert.match(validator(store, 'fullResendHour')('24'), /0 et 23/);
});

test('rule 3 — an unset code or slug reads as the slug of the property name', () => {
  assert.equal(slugify('La Granja'), 'la-granja');
  assert.equal(slugify('L’Estiva — tente'), 'l-estiva-tente');
  const settings = createSettings({
    store: memoryStore({ properties: JSON.stringify({ 2: { enabled: true, hotelCode: 'solio-estiva' } }) }, DEFAULTS),
    listProperties: () => [{ id: 1, name: 'La Granja' }, { id: 2, name: "L'Estiva" }],
  });
  assert.deepEqual(settings.properties(), [
    { id: 1, name: 'La Granja', enabled: false, hotelCode: 'la-granja', slug: 'la-granja' },
    { id: 2, name: "L'Estiva", enabled: true, hotelCode: 'solio-estiva', slug: 'l-estiva' },
  ]);
  assert.deepEqual(settings.enabledProperties().map((p) => p.id), [2]);
});
