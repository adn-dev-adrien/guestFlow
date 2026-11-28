// specs/guest-app/guest-app-local-amenities.md rule 7 — « Itinéraire » with no chooser: the server builds the Google Maps web link and the
// two app schemes tried on Apple devices, by coordinates else by address; the booklet's `place` block carries the same links.
const test = require('node:test');
const assert = require('node:assert/strict');

const { directionsLinks } = require('../directions');
const { resolvePages } = require('../booklet');

const SPEC = 'specs/guest-app/guest-app-local-amenities.md';

test(`${SPEC} rule 7: the address stands in when a booklet place has no coordinates`, () => {
  assert.deepEqual(directionsLinks({ address: '07270 Lamastre' }), {
    google: 'https://www.google.com/maps/dir/?api=1&destination=07270%20Lamastre&travelmode=driving',
    googleApp: 'comgooglemaps://?daddr=07270%20Lamastre&directionsmode=driving',
    appleApp: 'maps://?daddr=07270%20Lamastre&dirflg=d',
  });
});

test(`${SPEC} rule 7: a booklet place block carries the directions links, by coordinates else by address`, () => {
  const block = (data) => ({ slug: 'p', title: { fr: 'P' }, blocks: [{ id: 1, type: 'place', data: { name: { fr: 'Déchetterie' }, ...data } }] });
  const [page] = resolvePages([block({ address: 'Lamastre', lat: 45.1, lng: 4.6 })], { lang: 'fr', facts: {}, mediaOf: () => null, isAvailable: () => true });
  assert.deepEqual(page.blocks[0].links, directionsLinks({ lat: 45.1, lng: 4.6 }));
  assert.equal('mapsUrl' in page.blocks[0], false);
  const [byAddress] = resolvePages([block({ address: 'Lamastre' })], { lang: 'fr', facts: {}, mediaOf: () => null, isAvailable: () => true });
  assert.equal(byAddress.blocks[0].links.google, directionsLinks({ address: 'Lamastre' }).google);
});
