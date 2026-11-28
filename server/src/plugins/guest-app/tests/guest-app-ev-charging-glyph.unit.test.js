// specs/guest-app/guest-app-local-amenities.md rule 10 — a fuel place that sells only electric charging is drawn as a charging
// station: the server says so with `glyph: 'charging'`; any place selling petrol or diesel keeps the pump.
const test = require('node:test');
const assert = require('node:assert/strict');

const places = require('../places');

const SPEC = 'specs/guest-app/guest-app-local-amenities.md';
const ESTATE = { lat: 45.16369, lng: 4.63184 };
const NOW = new Date('2099-07-07T10:00:00Z');

const stored = (energies, category = 'carburant') => ({
  id: 1, ...places.validatePlace({ category, nameFr: 'Borne du bourg', commune: 'Satillieu', position: '45.1502, 4.6151', driveMinutes: 5, ...(category === 'carburant' ? { energies } : {}) }).place, verifiedOn: '2099-07-01',
});
const viewOf = (place) => places.guestPayload([place], { estate: ESTATE, now: NOW }).places[0];

test(`${SPEC} rule 10: a place whose only energy is charging carries the charging glyph`, () => {
  assert.equal(viewOf(stored(['recharge'])).glyph, 'charging');
});

test(`${SPEC} rule 10: any place selling petrol or diesel keeps the pump, charging or not`, () => {
  for (const energies of [['essence'], ['gazole'], ['essence', 'gazole'], ['gazole', 'recharge'], ['essence', 'gazole', 'recharge']]) {
    assert.equal('glyph' in viewOf(stored(energies)), false, energies.join('+'));
  }
});

test(`${SPEC} rule 10: other categories carry no glyph`, () => {
  assert.equal('glyph' in viewOf(stored(null, 'boulangerie')), false);
});
