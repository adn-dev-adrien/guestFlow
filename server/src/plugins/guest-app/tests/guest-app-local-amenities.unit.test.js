// specs/guest-app/guest-app-local-amenities.md — « Pratique »: the shops, services and waste points around the estate.
// The pure rules (position parsing, the 15 km check, the closed categories, hours and the open state, the GPS links, the
// order), then the routes: the module and its prerequisite, the guest payload for a stay and a visitor, the Studio's CRUD and
// its refusals, the estate setting, the booklet's button target.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addStay, enable, freshDb, openStay, paris, startApi,
} = require('./guestAppFixtures');
const places = require('../places');
const { CATEGORY_KEYS } = require('../placeCategories');
const { MIGRATIONS, TABLES } = require('../migrations');

const SPEC = 'specs/guest-app/guest-app-local-amenities.md';
const PUBLIC = '/public/v1/guest';
const ADMIN = '/api/guest-app';
const ESTATE = { lat: 45.16369, lng: 4.63184 };

const everyDay = (ranges) => Array.from({ length: 7 }, () => ranges.map((r) => [...r]));
// 7 h – 13 h and 15 h – 19 h, in minutes.
const MIDDAY_BREAK = [[420, 780], [900, 1140]];

const bakery = (over = {}) => ({
  category: 'boulangerie', nameFr: 'Maison Roux', commune: 'Satillieu', position: '45.15123, 4.6163', driveMinutes: 4, ...over,
});
const wasteBin = (over = {}) => ({
  category: 'dechets', nameFr: 'Point de collecte du bourg', commune: 'Satillieu', position: '45.1502, 4.6151', driveMinutes: 5, wasteKind: 'point', accepts: ['verre', 'om'], ...over,
});
const fuel = (over = {}) => ({
  category: 'carburant', nameFr: 'Station du village', commune: 'Saint-Romain-d’Ay', position: '45.17, 4.64', driveMinutes: 6, energies: ['gazole', 'essence'], ...over,
});

// --- Pure rules ------------------------------------------------------------------------------------------------

test(`${SPEC} rule 16: a position is pasted as plain coordinates or as a Google Maps link carrying them`, () => {
  assert.deepEqual(places.parsePosition('45.1502, 4.6151'), { lat: 45.1502, lng: 4.6151 });
  assert.deepEqual(places.parsePosition(' 45.1502 4.6151 '), { lat: 45.1502, lng: 4.6151 });
  assert.deepEqual(places.parsePosition('https://www.google.com/maps/place/Boulangerie/@45.15123,4.6163,17z/data=!3m1!4b1'), { lat: 45.15123, lng: 4.6163 });
  assert.deepEqual(places.parsePosition('https://www.google.com/maps?q=45.1502,4.6151'), { lat: 45.1502, lng: 4.6151 });
  assert.deepEqual(places.parsePosition('https://www.google.com/maps/place/X/@45.2,4.7,17z/data=!4m5!3m4!1s0x0!8m2!3d45.1502!4d4.6151'), { lat: 45.1502, lng: 4.6151 }, 'the pin wins over the map centre');
});

test(`${SPEC} rule 16: a position that is none is refused with the pasted-coordinates message`, () => {
  for (const text of ['', 'Satillieu', '45.1502', 'https://maps.app.goo.gl/abcdef', '95.1, 4.6', '45.1, 400', null, 12]) {
    assert.equal(places.parsePosition(text), null, String(text));
    const { fields } = places.validatePlace(bakery({ position: text }));
    assert.equal(fields.position, 'Position non reconnue : collez « 45.1502, 4.6151 » ou un lien Google Maps qui contient les coordonnées.');
  }
});

test(`${SPEC} rule 16: a place more than 15 km from the estate is refused, one inside is kept`, () => {
  const far = places.validatePlace(bakery({ position: '45.75, 4.85' }), { estate: ESTATE });
  assert.match(far.fields.position, /^Ce lieu est à \d+ km du domaine : la carte couvre 15 km autour\.$/);
  const km = Number(/à (\d+) km/.exec(far.fields.position)[1]);
  assert.ok(km > 60 && km < 80, `Lyon is about 66 km away, read ${km}`);
  const near = places.validatePlace(bakery({ position: '45.15123, 4.6163' }), { estate: ESTATE });
  assert.equal(near.fields, undefined);
  assert.equal(near.place.lat, 45.15123);
});

test(`${SPEC} rule 12: the drive time is an integer from 1 to 60 minutes, and the label says it`, () => {
  for (const bad of [undefined, 0, 61, 1.5, '6', null]) {
    assert.equal(places.validatePlace(bakery({ driveMinutes: bad })).fields.driveMinutes, 'Indiquez le temps en voiture depuis le domaine, en minutes (1 à 60).');
  }
  assert.equal(places.validatePlace(bakery({ driveMinutes: 1 })).fields, undefined);
  assert.equal(places.validatePlace(bakery({ driveMinutes: 60 })).fields, undefined);
  const payload = (lang) => places.guestPayload([{ id: 1, ...places.validatePlace(bakery({ driveMinutes: 6 })).place, verifiedOn: '2099-07-07' }], { estate: ESTATE, now: paris('2099-07-07', '12:00'), lang });
  assert.equal(payload('fr').places[0].driveLabel, '6 min en voiture');
  assert.equal(payload('en').places[0].driveLabel, '6 min drive');
  assert.equal('distance' in payload('fr').places[0], false, 'no computed distance is shown');
});

test(`${SPEC} rule 10: the categories are a closed set in the spec's order`, () => {
  assert.deepEqual(CATEGORY_KEYS, ['dechets', 'boulangerie', 'pharmacie', 'boucherie', 'epicerie', 'tabac', 'poste', 'distributeur', 'carburant']);
  assert.equal(places.validatePlace(bakery({ category: 'medecin' })).fields.category, 'Choisissez une catégorie.');
  assert.equal(places.validatePlace(bakery({ category: undefined })).fields.category, 'Choisissez une catégorie.');
});

test(`${SPEC} rule 10: a waste place says what can be dropped and of which kind, a fuel place which energies`, () => {
  assert.equal(places.validatePlace(wasteBin({ accepts: [] })).fields.accepts, 'Cochez au moins ce qu’on peut y déposer.');
  assert.equal(places.validatePlace(wasteBin({ accepts: undefined })).fields.accepts, 'Cochez au moins ce qu’on peut y déposer.');
  assert.ok(places.validatePlace(wasteBin({ accepts: ['verre', 'plastique'] })).fields.accepts);
  assert.ok(places.validatePlace(wasteBin({ wasteKind: 'depot' })).fields.wasteKind);
  assert.deepEqual(places.validatePlace(wasteBin({ accepts: ['verre', 'om'] })).place.accepts, ['om', 'verre'], 'kept in the closed set\'s order');

  assert.equal(places.validatePlace(fuel({ energies: [] })).fields.energies, 'Cochez au moins une énergie : essence, gazole ou recharge.');
  assert.ok(places.validatePlace(fuel({ energies: ['hydrogene'] })).fields.energies);
  assert.deepEqual(places.validatePlace(fuel({ energies: ['gazole', 'recharge'] })).place.energies, ['gazole', 'recharge']);

  // The fields another category uses are dropped, not stored.
  const stray = places.validatePlace(bakery({ accepts: ['verre'], energies: ['gazole'], wasteKind: 'point' })).place;
  assert.deepEqual([stray.accepts, stray.energies, stray.wasteKind], [null, null, null]);
});

test(`${SPEC} rule 16: name, commune, phone and notes are judged by their limits`, () => {
  assert.ok(places.validatePlace(bakery({ nameFr: '  ' })).fields.nameFr);
  assert.ok(places.validatePlace(bakery({ nameFr: 'x'.repeat(81) })).fields.nameFr);
  assert.equal(places.validatePlace(bakery({ nameFr: 'x'.repeat(80), nameEn: undefined })).place.nameEn, null);
  assert.ok(places.validatePlace(bakery({ commune: '' })).fields.commune);
  assert.ok(places.validatePlace(bakery({ noteFr: 'x'.repeat(281) })).fields.noteFr);
  assert.equal(places.validatePlace(bakery({ noteFr: 'x'.repeat(280), noteEn: 'Closed on Mondays' })).fields, undefined);
  assert.equal(places.validatePlace(bakery({ phone: '04 75 12 34 56' })).place.phone, '0475123456');
  assert.equal(places.validatePlace(bakery({ phone: '+33 4 75 12 34 56' })).place.phone, '0475123456');
  assert.equal(places.validatePlace(bakery({ phone: '' })).place.phone, null);
  assert.ok(places.validatePlace(bakery({ phone: '04 75 12' })).fields.phone);
  assert.ok(places.validatePlace({ ...bakery(), colour: 'red' }).fields._);
});

test(`${SPEC} rule 16: the hours of a day are at most two ranges, each opening before it closes, none overlapping`, () => {
  assert.equal(places.validatePlace(bakery({ hours: everyDay(MIDDAY_BREAK) })).fields, undefined);
  assert.ok(places.validatePlace(bakery({ hours: everyDay([[420, 420]]) })).fields.hours, 'open = close');
  assert.ok(places.validatePlace(bakery({ hours: everyDay([[780, 420]]) })).fields.hours, 'open after close');
  assert.ok(places.validatePlace(bakery({ hours: everyDay([[420, 800], [780, 1140]]) })).fields.hours, 'overlap');
  assert.ok(places.validatePlace(bakery({ hours: everyDay([[420, 600], [660, 800], [900, 1100]]) })).fields.hours, 'three ranges');
  assert.ok(places.validatePlace(bakery({ hours: [[], []] })).fields.hours, 'not seven days');
  assert.ok(places.validatePlace(bakery({ hours: everyDay([[-5, 600]]) })).fields.hours);
  assert.ok(places.validatePlace(bakery({ hours: everyDay([[420, 1500]]) })).fields.hours);
  assert.equal(places.validatePlace(bakery({ hours: everyDay([]) })).place.hours, null, 'no range at all is no hours');
  assert.deepEqual(places.validatePlace(bakery({ hours: everyDay([[900, 1140], [420, 780]]) })).place.hours[0], MIDDAY_BREAK, 'ranges kept in time order');
});

test(`${SPEC} rule 13: open now, closed over the midday break, closed until tomorrow — at Paris time`, () => {
  const hours = everyDay(MIDDAY_BREAK);
  // 2099-07-07 is a Tuesday.
  assert.deepEqual(places.openState(hours, paris('2099-07-07', '12:00')), { state: 'open', label: 'Ouvert · ferme à 13 h' });
  assert.deepEqual(places.openState(hours, paris('2099-07-07', '13:30')), { state: 'closed', label: 'Fermé · ouvre à 15 h' });
  assert.deepEqual(places.openState(hours, paris('2099-07-07', '20:00')), { state: 'closed', label: 'Fermé · ouvre demain à 7 h' });
  assert.deepEqual(places.openState(hours, paris('2099-07-07', '06:00')), { state: 'closed', label: 'Fermé · ouvre à 7 h' });
  assert.equal(places.openState(hours, paris('2099-07-07', '13:00')).state, 'closed', 'the closing minute is closed');
  // 05:30 UTC is 07:30 in Paris in July: already open.
  assert.equal(places.openState(hours, new Date('2099-07-07T05:30:00Z')).state, 'open');
  assert.equal(places.openState(hours, new Date('2099-07-07T04:30:00Z')).state, 'closed');
});

test(`${SPEC} rule 13: a closed Sunday opens on the next day with hours, in either language`, () => {
  const hours = everyDay(MIDDAY_BREAK);
  hours[0] = [];
  // 2099-07-04 is a Saturday, 2099-07-05 a Sunday.
  assert.deepEqual(places.openState(hours, paris('2099-07-04', '20:00')), { state: 'closed', label: 'Fermé · ouvre lundi à 7 h' });
  assert.deepEqual(places.openState(hours, paris('2099-07-05', '10:00')), { state: 'closed', label: 'Fermé · ouvre demain à 7 h' });
  assert.deepEqual(places.openState(hours, paris('2099-07-04', '20:00'), 'en'), { state: 'closed', label: 'Closed · opens Monday at 7 am' });
  assert.deepEqual(places.openState(hours, paris('2099-07-07', '12:00'), 'en'), { state: 'open', label: 'Open · closes at 1 pm' });
  const lateNight = everyDay([[600, 1440]]);
  assert.equal(places.openState(lateNight, paris('2099-07-07', '23:00')).label, 'Ouvert · ferme à minuit');
});

test(`${SPEC} rule 13: a place with no hours never claims to be open`, () => {
  assert.deepEqual(places.openState(null, paris('2099-07-07', '12:00')), { state: 'unknown', label: 'Horaires non renseignés' });
  assert.deepEqual(places.openState(null, paris('2099-07-07', '12:00'), 'en'), { state: 'unknown', label: 'Hours not provided' });
});

test(`${SPEC} rule 6: the week's hours read Monday first, today flagged, a day without range « Fermé »`, () => {
  const hours = everyDay(MIDDAY_BREAK);
  hours[0] = [];
  const row = places.guestPayload([{ id: 1, ...places.validatePlace(bakery({ hours })).place, verifiedOn: '2099-07-07' }], { estate: ESTATE, now: paris('2099-07-07', '12:00') }).places[0];
  assert.deepEqual(row.hours.map((d) => d.day), ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']);
  assert.equal(row.hours[0].ranges, '7 h – 13 h · 15 h – 19 h');
  assert.equal(row.hours[6].ranges, 'Fermé');
  assert.deepEqual(row.hours.map((d) => d.today), [false, true, false, false, false, false, false]);
});

test(`${SPEC} rule 7: the three GPS links are built from the stored coordinates`, () => {
  assert.deepEqual(places.gpsLinks({ lat: 45.1502, lng: 4.6151 }), {
    apple: 'https://maps.apple.com/?daddr=45.1502,4.6151&dirflg=d',
    google: 'https://www.google.com/maps/dir/?api=1&destination=45.1502,4.6151',
    waze: 'https://waze.com/ul?ll=45.1502,4.6151&navigate=yes',
  });
});

test(`${SPEC} rule 5: places come by category order, then drive time, then name`, () => {
  const make = (id, over) => ({ id, ...places.validatePlace({ ...bakery(), ...over }).place, verifiedOn: '2099-07-07' });
  const list = [
    make(1, { nameFr: 'Boulangerie B', driveMinutes: 9 }),
    make(2, { category: 'pharmacie', nameFr: 'Pharmacie du bourg', driveMinutes: 2 }),
    make(3, { nameFr: 'Boulangerie A', driveMinutes: 9 }),
    make(4, { nameFr: 'Boulangerie Z', driveMinutes: 3 }),
    make(5, { ...wasteBin(), nameFr: 'Déchets' }),
  ];
  const payload = places.guestPayload(list, { estate: ESTATE, now: paris('2099-07-07', '12:00') });
  assert.deepEqual(payload.places.map((p) => p.id), [5, 4, 3, 1, 2]);
  assert.deepEqual(payload.categories, [
    { key: 'dechets', label: 'Déchets', count: 1 },
    { key: 'boulangerie', label: 'Boulangeries', count: 3 },
    { key: 'pharmacie', label: 'Pharmacie', count: 1 },
  ], 'a category with no place has no chip');
});

test(`${SPEC} rule 6: absent fields are absent, never a placeholder`, () => {
  const row = places.guestPayload([{ id: 1, ...places.validatePlace(bakery()).place, verifiedOn: '2099-07-07' }], { estate: ESTATE, now: paris('2099-07-07', '12:00') }).places[0];
  assert.deepEqual([row.accepts, row.energies, row.wasteKind, row.note, row.phone, row.telUrl, row.hours], [null, null, null, null, null, null, null]);
  assert.equal(row.open.state, 'unknown');
});

test(`${SPEC} rule 6: a phone reads in groups of two and dials as digits; English falls back to French`, () => {
  const stored = { id: 1, ...places.validatePlace(bakery({ phone: '0475123456', nameEn: 'Roux bakery', noteFr: 'Fermé le lundi' })).place, verifiedOn: '2099-07-07' };
  const fr = places.guestPayload([stored], { estate: ESTATE, now: paris('2099-07-07', '12:00') }).places[0];
  assert.equal(fr.phone, '04 75 12 34 56');
  assert.equal(fr.telUrl, 'tel:0475123456');
  assert.equal(fr.name, 'Maison Roux');
  const en = places.guestPayload([stored], { estate: ESTATE, now: paris('2099-07-07', '12:00'), lang: 'en' }).places[0];
  assert.equal(en.name, 'Roux bakery');
  assert.equal(en.note, 'Fermé le lundi', 'no English note: the French one');
  assert.equal(en.categoryLabel, 'Bakery');
});

test(`${SPEC} rule 14: a place not verified for 12 months is to re-verify`, () => {
  assert.equal(places.isStale('2098-07-07', '2099-07-07'), false, 'exactly 12 months');
  assert.equal(places.isStale('2098-07-06', '2099-07-07'), true);
  assert.equal(places.isStale('2099-06-01', '2099-07-07'), false);
});

test(`${SPEC} rule 12: the estate is the setting, else the default 45.16369, 4.63184`, () => {
  assert.deepEqual(places.estateOf(undefined), ESTATE);
  assert.deepEqual(places.estateOf('garbage'), ESTATE);
  assert.deepEqual(places.estateOf('45.2, 4.7'), { lat: 45.2, lng: 4.7 });
  assert.equal(places.estateError('not a position'), places.MESSAGES.position);
  assert.equal(places.estateError('45.2, 4.7'), null);
});

test(`${SPEC} rule 17: the migration creates the table and no place`, () => {
  const db = freshDb();
  assert.ok(MIGRATIONS.some((m) => m.name === 'guest_app_places_v6'));
  assert.ok(TABLES.includes('guest_app_places'), 'erased with the plugin\'s data');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_app_places').get().n, 0);
});

test(`${SPEC} rule 2: the guest app's policy lets the map's tiles in as images, and nothing else`, () => {
  const { guestCsp, studioCsp } = require('../appHosting');
  const directives = Object.fromEntries(guestCsp().split('; ').map((d) => [d.split(' ')[0], d]));
  assert.match(directives['img-src'], /https:\/\/tile\.openstreetmap\.org/);
  assert.equal(directives['script-src'], "script-src 'self'");
  assert.equal(directives['connect-src'], "connect-src 'self'");
  assert.doesNotMatch(studioCsp().replace(/img-src[^;]*/, ''), /openstreetmap/);
});

// --- Through the routes ----------------------------------------------------------------------------------------

function withPlaces(name, fn) {
  test(name, async () => {
    const db = freshDb();
    const ctx = await startApi(db);
    try {
      const codes = { 1: enable(ctx.api, db, 1), 2: enable(ctx.api, db, 2) };
      const studio = {
        create: (body) => ctx.call('POST', `${ADMIN}/places`, body),
        update: (id, body) => ctx.call('PUT', `${ADMIN}/places/${id}`, body),
        remove: (id) => ctx.call('DELETE', `${ADMIN}/places/${id}`),
        list: async () => (await ctx.call('GET', `${ADMIN}/places`)).body,
        add: async (body) => {
          const made = await ctx.call('POST', `${ADMIN}/places`, body);
          assert.equal(made.status, 200, JSON.stringify(made.body));
          return made.body;
        },
      };
      const visitor = (propertyId = 1, lang = 'fr') => ctx.call('GET', `${PUBLIC}/places?lang=${lang}&lodgingCode=${codes[propertyId]}`, undefined, { cookie: null });
      await fn({
        db, ctx, codes, studio, visitor,
      });
    } finally {
      await ctx.close();
    }
  });
}

withPlaces(`${SPEC} rule 1: no published place, no tile and the page answers MODULE_OFF`, async ({ studio, visitor }) => {
  const off = await visitor();
  assert.equal(off.status, 404);
  assert.equal(off.body.error.code, 'MODULE_OFF');

  const hidden = await studio.add(bakery({ published: false }));
  assert.equal((await visitor()).status, 404, 'an unpublished place does not count');
  assert.equal((await studio.update(hidden.id, { published: true })).status, 200);
  assert.equal((await visitor()).status, 200);
  await studio.update(hidden.id, { published: false });
  assert.equal((await visitor()).status, 404, 'unpublished again: off again');
});

withPlaces(`${SPEC} rule 1: the tile « Pratique » comes right after the activities tile, for a stay and for a visitor`, async ({ ctx, db, studio, codes }) => {
  await studio.add(bakery());
  const tilesOf = (body) => body.data.tiles.map((t) => t.key);

  await openStay(ctx.call, db, addStay(db));
  const stay = await ctx.call('GET', `${PUBLIC}/me`);
  assert.equal(stay.body.data.mode, 'stay');
  const keys = tilesOf(stay.body);
  assert.equal(keys[keys.indexOf('soliomap') + 1], 'places');
  assert.equal(stay.body.data.tiles.find((t) => t.key === 'places').label, 'Pratique');
  assert.equal((await ctx.call('GET', `${PUBLIC}/me?lang=en`)).body.data.tiles.find((t) => t.key === 'places').label, 'Essentials');

  const visit = await ctx.call('POST', `${PUBLIC}/sessions`, { lodgingCode: codes[1] }, { cookie: null });
  assert.equal(visit.status, 200);
  const me = await ctx.call('GET', `${PUBLIC}/me`);
  assert.equal(me.body.data.mode, 'visitor');
  assert.ok(tilesOf(me.body).includes('places'), 'open to every mode');
});

withPlaces(`${SPEC} rule 1: a stay session, a visitor and the other lodging read the same list`, async ({ ctx, db, studio, visitor }) => {
  await studio.add(bakery());
  await studio.add(wasteBin());
  await openStay(ctx.call, db, addStay(db));
  const stay = (await ctx.call('GET', `${PUBLIC}/places`)).body.data;
  assert.deepEqual(stay.places.map((p) => p.name), ['Point de collecte du bourg', 'Maison Roux']);
  assert.deepEqual(stay.estate, ESTATE);
  assert.equal(stay.places[0].links.waze, 'https://waze.com/ul?ll=45.1502,4.6151&navigate=yes');
  assert.deepEqual((await visitor(1)).body.data, (await visitor(2)).body.data, 'rule 11: one list for the estate');
  assert.deepEqual((await visitor(1)).body.data.places.map((p) => p.id), stay.places.map((p) => p.id), 'rule 1: nothing in it is private');
});

withPlaces(`${SPEC} rule 1: a module switched off for the lodging answers MODULE_OFF even with published places`, async ({ db, studio, visitor }) => {
  await studio.add(bakery());
  const { defaultModules } = require('../modules');
  const stored = defaultModules().map((m) => (m.key === 'places' ? { ...m, on: false } : m));
  db.prepare('UPDATE guest_app_lodgings SET modulesJson = ? WHERE propertyId = 1').run(JSON.stringify(stored));
  const off = await visitor(1);
  assert.equal(off.status, 404);
  assert.equal(off.body.error.code, 'MODULE_OFF');
  assert.equal((await visitor(2)).status, 200, 'the other lodging keeps it');
});

withPlaces(`${SPEC} rule 13: the guest payload carries the open state computed at Paris time`, async ({ ctx, studio, visitor }) => {
  await studio.add(bakery({ hours: everyDay(MIDDAY_BREAK) }));
  // The suite's clock is Tuesday 2099-07-07 at 12:00 Paris.
  assert.equal((await visitor()).body.data.places[0].open.label, 'Ouvert · ferme à 13 h');
  ctx.clock.now = paris('2099-07-07', '13:30');
  assert.equal((await visitor()).body.data.places[0].open.label, 'Fermé · ouvre à 15 h');
  assert.equal((await visitor(1, 'en')).body.data.places[0].open.label, 'Closed · opens at 3 pm');
});

withPlaces(`${SPEC} rule 16: the Studio shows the refusals the server judged, one message per field`, async ({ studio }) => {
  const refused = await studio.create(bakery({ position: 'Satillieu', driveMinutes: 99, nameFr: '' }));
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'INVALID_PLACE');
  assert.deepEqual(Object.keys(refused.body.fields).sort(), ['driveMinutes', 'nameFr', 'position']);
  assert.equal(refused.body.fields.position, places.MESSAGES.position);
  assert.equal((await studio.create(wasteBin({ accepts: [] }))).body.fields.accepts, 'Cochez au moins ce qu’on peut y déposer.');
  assert.equal((await studio.create(fuel({ energies: [] }))).body.fields.energies, 'Cochez au moins une énergie : essence, gazole ou recharge.');
  assert.match((await studio.create(bakery({ position: '45.75, 4.85' }))).body.fields.position, /^Ce lieu est à \d+ km du domaine/);
  assert.equal((await studio.list()).groups.every((g) => g.count === 0), true, 'a refused place is not stored');
});

withPlaces(`${SPEC} rule 16: a position pasted as a Google Maps link is stored as coordinates`, async ({ studio }) => {
  const made = await studio.add(bakery({ position: 'https://www.google.com/maps/place/Maison+Roux/@45.15123,4.6163,17z' }));
  assert.deepEqual([made.lat, made.lng, made.position], [45.15123, 4.6163, '45.15123, 4.6163']);
});

withPlaces(`${SPEC} rule 14: every save in the Studio sets « Vérifié le » to today, the publish switch does not`, async ({ ctx, db, studio }) => {
  const made = await studio.add(bakery());
  assert.equal(made.verifiedOn, '2099-07-07');
  db.prepare('UPDATE guest_app_places SET verified_on = ? WHERE id = ?').run('2098-01-01', made.id);
  assert.equal((await studio.list()).groups.find((g) => g.key === 'boulangerie').places[0].needsReview, true);

  const switched = await studio.update(made.id, { published: false });
  assert.equal(switched.body.verifiedOn, '2098-01-01', 'the switch alone re-verifies nothing');
  assert.equal(switched.body.published, false);

  ctx.clock.now = paris('2099-08-01', '10:00');
  const saved = await studio.update(made.id, { ...bakery({ driveMinutes: 5 }), published: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.verifiedOn, '2099-08-01');
  assert.equal(saved.body.needsReview, false);
  assert.equal(saved.body.driveMinutes, 5);
});

withPlaces(`${SPEC} rule 15: the Studio lists every category with its counts, those to re-verify first, an empty one hidden from guests`, async ({ db, studio }) => {
  const recent = await studio.add(bakery({ nameFr: 'Aaa récente' }));
  const old = await studio.add(bakery({ nameFr: 'Zzz ancienne' }));
  await studio.add(bakery({ nameFr: 'Brouillon', published: false }));
  db.prepare('UPDATE guest_app_places SET verified_on = ? WHERE id = ?').run('2097-01-01', old.id);

  const list = await studio.list();
  assert.deepEqual(list.groups.map((g) => g.key), CATEGORY_KEYS);
  const group = list.groups.find((g) => g.key === 'boulangerie');
  assert.deepEqual([group.count, group.publishedCount, group.hiddenFromGuests], [3, 2, false]);
  assert.deepEqual(group.places.map((p) => p.nameFr), ['Zzz ancienne', 'Aaa récente', 'Brouillon'], 'to re-verify first, then by name');
  assert.equal(list.reviewCount, 1);
  const pharmacy = list.groups.find((g) => g.key === 'pharmacie');
  assert.deepEqual([pharmacy.count, pharmacy.hiddenFromGuests], [0, true]);
  assert.equal(recent.needsReview, false);
});

withPlaces(`${SPEC} rule 15: a place is added, edited and deleted from the Studio`, async ({ studio, visitor }) => {
  const made = await studio.add(wasteBin());
  assert.deepEqual([made.wasteKind, made.accepts], ['point', ['om', 'verre']]);
  const edited = await studio.update(made.id, wasteBin({ wasteKind: 'decheterie', accepts: ['encombrants'], nameFr: 'Déchèterie de Saint-Alban', commune: 'Saint-Alban-d’Ay' }));
  assert.equal(edited.status, 200);
  const read = (await visitor()).body.data.places[0];
  assert.deepEqual([read.name, read.wasteKind.label, read.accepts.map((a) => a.label)], ['Déchèterie de Saint-Alban', 'Déchèterie', ['Encombrants']]);

  assert.equal((await studio.update(9999, { published: true })).status, 404);
  assert.equal((await studio.remove(made.id)).status, 200);
  assert.equal((await studio.remove(made.id)).status, 404);
  assert.equal((await visitor()).status, 404, 'last place gone: the module is off again');
});

withPlaces(`${SPEC} rule 12: the estate position is a Studio setting that the 15 km check follows`, async ({ ctx, studio }) => {
  const read = await ctx.call('GET', `${ADMIN}/studio/settings`);
  assert.equal(read.body.estatePosition, '45.16369, 4.63184');

  const refused = await ctx.call('PUT', `${ADMIN}/studio/settings`, { estatePosition: 'Satillieu' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, places.MESSAGES.position);

  assert.equal((await ctx.call('PUT', `${ADMIN}/studio/settings`, { estatePosition: '45.4, 4.63' })).status, 200);
  const far = await studio.create(bakery());
  assert.equal(far.status, 400, 'the bakery is now 28 km from the estate');
  assert.match(far.body.fields.position, /^Ce lieu est à 2\d km du domaine/);
  assert.equal((await studio.list()).estate.position, '45.4, 4.63');
});

withPlaces(`${SPEC} rule 18: the booklet's « places » button target is validated, shown while the module is on, hidden once it is off`, async ({ ctx, studio, codes }) => {
  const STUDIO = `${ADMIN}/studio`;
  const page = await ctx.call('POST', `${STUDIO}/lodgings/1/pages`, { slug: 'le-domaine', title: { fr: 'Le domaine' } });
  assert.equal(page.status, 200, JSON.stringify(page.body));
  const button = (target) => ctx.call('POST', `${STUDIO}/pages/${page.body.id}/blocks`, { type: 'button', data: { label: { fr: 'Voir les points de collecte' }, target } });

  assert.equal((await button({ kind: 'places', category: 'cinema' })).status, 400);
  assert.equal((await button({ kind: 'places', category: 'dechets', extra: 1 })).status, 400);
  const added = await button({ kind: 'places', category: 'dechets' });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal((await button({ kind: 'places' })).status, 200, 'a button without category opens the page unfiltered');
  await ctx.call('POST', `${STUDIO}/lodgings/1/publish`);

  const buttons = async () => {
    const res = await ctx.call('GET', `${PUBLIC}/booklet/pages/le-domaine?lodgingCode=${codes[1]}`, undefined, { cookie: null });
    return res.body.data.blocks.filter((b) => b.type === 'button').map((b) => b.target);
  };
  assert.deepEqual(await buttons(), [], 'no published place: the module is off, the button is not rendered');
  const made = await studio.add(wasteBin());
  assert.deepEqual(await buttons(), [{ kind: 'places', category: 'dechets' }, { kind: 'places' }], 'visitors included');
  await studio.update(made.id, { published: false });
  assert.deepEqual(await buttons(), []);
});
