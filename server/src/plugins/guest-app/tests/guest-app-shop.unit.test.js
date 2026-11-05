// specs/guest-app.md rules 24-27, 27bis, 11bis — `GET /public/v1/guest/shop` through the real routes: the projection
// per lodging and language, the categories, the window, the module and the plugins the shop reads.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, addResource, addStay, enable, freshDb, livePlugins, openService, paris, sell, startApi,
} = require('./guestAppFixtures');
const { defaultModules } = require('../modules');

const defaultModulesOff = (key) => defaultModules().map((m) => (m.key === key ? { ...m, on: false } : m));

function withShop(name, fn, plugins = {}) {
  test(name, async () => {
    const teardown = livePlugins(plugins);
    const db = freshDb();
    const ctx = await startApi(db);
    try {
      await fn({ db, ...ctx });
    } finally {
      await ctx.close();
      teardown();
    }
  });
}

/** A session on the stay of a lodging, its cookie returned. */
async function scan(api, db, call, propertyId = 1, patch = {}) {
  const code = enable(api, db, propertyId, patch);
  return (await call('POST', '/public/v1/guest/sessions', { lodgingCode: code })).setCookie.split(';')[0];
}

const shopOf = async (call, cookie, query = '') => (await call('GET', `/public/v1/guest/shop${query}`, null, { cookie })).body.data;
const itemsOf = (shop) => shop.categories.flatMap((c) => c.items);
const item = (shop, kind, id) => itemsOf(shop).find((i) => i.kind === kind && i.id === id);

function translate(db, entryKey, text) {
  db.prepare("INSERT INTO translation_entries (entryKey, kind, sourceText, seenAt) VALUES (?, 'x', 'x', '2099-01-01')").run(entryKey);
  db.prepare("INSERT INTO translation_values (entryKey, lang, text, sourceAtTime) VALUES (?, 'en', ?, 'x')").run(entryKey, text);
}

withShop('rule 24: each lodging sees its own price — included at one, paid at the other — with the core’s labels', async ({ db, api, call }) => {
  addStay(db);
  addStay(db, { propertyId: 2, reservationNumber: 'R-99-002' });
  addOption(db, { id: 1, title: 'Panier du terroir', price: 25, prices: { 1: 0 } });
  sell(db, 'option', 1, { shortDescriptionFr: 'Fromages et charcuterie de la vallée', maxQuantity: 4, needsStaff: 1 });
  openService(db);
  const granja = item(await shopOf(call, await scan(api, db, call, 1)), 'option', 1);
  assert.deepEqual(granja, {
    kind: 'option', id: 1, title: 'Panier du terroir', shortDescription: 'Fromages et charcuterie de la vallée', imageUrl: null,
    price: 0, priceLabel: 'Inclus', priceUnitLabel: null, included: true, includedLeft: 4, maxQuantity: 4, needsStaff: true,
  });
  const estiva = item(await shopOf(call, await scan(api, db, call, 2)), 'option', 1);
  assert.equal(estiva.price, 25);
  assert.equal(estiva.priceLabel, '25 €');
  assert.equal(estiva.priceUnitLabel, 'au séjour');
  assert.equal(estiva.included, undefined);
  assert.equal(estiva.includedLeft, undefined);
});

withShop('rule 24: English — the catalogue’s title, the core’s unit, an English price, the French text when none is written', async ({ db, api, call }) => {
  addStay(db);
  addOption(db, { id: 1, title: 'Cidre', price: 6.5, category: 'Boissons' });
  sell(db, 'option', 1, { shortDescriptionFr: 'Cidre fermier' });
  translate(db, 'option:1:title', 'Cider');
  translate(db, 'category:Boissons', 'Drinks');
  db.prepare("INSERT INTO guest_media (id, path, createdAt) VALUES (3, 'guest-app/cidre.webp', '2099-01-01')").run();
  db.prepare("UPDATE guest_app_items SET mediaId = 3 WHERE itemId = 1").run();
  const shop = await shopOf(call, await scan(api, db, call), '?lang=en');
  assert.equal(shop.categories[0].name, 'Drinks');
  const cider = item(shop, 'option', 1);
  assert.equal(cider.title, 'Cider');
  assert.equal(cider.priceLabel, '€6.50');
  assert.equal(cider.priceUnitLabel, 'per stay');
  assert.equal(cider.shortDescription, 'Cidre fermier', 'rule 19: a missing English text falls back to French');
  assert.equal(cider.imageUrl, '/uploads/guest-app/cidre.webp');
  db.prepare("UPDATE guest_app_items SET shortDescriptionEn = 'Farm cider' WHERE itemId = 1").run();
  assert.equal(item(await shopOf(call, await scan(api, db, call), '?lang=en'), 'option', 1).shortDescription, 'Farm cider');
});

withShop('rule 25: free units and free minutes left read as sentences, in both languages', async ({ db, api, call }) => {
  const stay = addStay(db);
  addOption(db, { id: 1, title: 'Petit pot de miel', price: 8, freeUnits: { 1: 2 } });
  addResource(db, { id: 6, name: 'Bain nordique', freeMinutes: { 1: 60 } });
  sell(db, 'option', 1);
  sell(db, 'resource', 6);
  const cookie = await scan(api, db, call);
  const fresh = await shopOf(call, cookie);
  assert.equal(item(fresh, 'option', 1).freeLeftLabel, '2 offerts avec votre séjour');
  assert.equal(item(fresh, 'resource', 6).freeLeftLabel, '1 h offerte avec votre séjour');
  assert.equal(item(await shopOf(call, cookie, '?lang=en'), 'resource', 6).freeLeftLabel, '1 h included with your stay');
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, sessions) VALUES (?, 6, 1, ?)')
    .run(stay, JSON.stringify([{ date: '2099-07-06', start: '18:00', end: '19:00' }]));
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, billedUnits) VALUES (?, 1, 2, 2)').run(stay);
  const used = await shopOf(call, cookie);
  assert.equal(item(used, 'resource', 6).freeLeftLabel, '1 h offerte — déjà utilisée');
  assert.equal(item(used, 'option', 1).freeLeftLabel, '2 offerts — déjà utilisés');
});

withShop('rule 25: an option offered by default that the stay carries reads « Déjà inclus » and is not orderable', async ({ db, api, call }) => {
  const stay = addStay(db);
  addOption(db, { id: 1, title: 'Bouteille de bienvenue', price: 15 });
  sell(db, 'option', 1);
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 1, 1)').run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, billedUnits, offered) VALUES (?, 1, 1, 1, 1)').run(stay);
  const welcome = item(await shopOf(call, await scan(api, db, call)), 'option', 1);
  assert.equal(welcome.included, true);
  assert.equal(welcome.priceLabel, 'Inclus');
  assert.equal(welcome.unavailableReason, 'Déjà inclus dans votre séjour');
  assert.equal(welcome.includedLeft, undefined);
});

withShop('rule 27bis: the breakfast carries its state, the mornings left and the ones the stay already has', async ({ db, api, call }) => {
  const stay = addStay(db);
  addOption(db, { id: 1, title: 'Petit déjeuner', priceType: 'per_person_per_night', price: 12, autoOptionType: 'breakfast', category: 'Restauration' });
  db.prepare("UPDATE options SET breakfastTime = '08:30' WHERE id = 1").run();
  sell(db, 'option', 1);
  const cookie = await scan(api, db, call);
  const sold = item(await shopOf(call, cookie), 'breakfast', 1);
  assert.equal(sold.state, 'sold');
  assert.equal(sold.price, 12);
  assert.equal(sold.defaultTime, '08:30');
  assert.deepEqual(sold.mornings.map((m) => m.date), ['2099-07-08', '2099-07-09'], 'today’s service is over at noon');
  assert.equal(sold.mornings[0].label, 'mer. 8 juil.');
  assert.deepEqual(sold.occurrences, []);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, billedUnits, offered, cardOccurrences)
    VALUES (?, 1, 1, 3, 1, ?)`).run(stay, JSON.stringify([{ date: '2099-07-08', time: '09:00' }]));
  const included = item(await shopOf(call, cookie), 'breakfast', 1);
  assert.equal(included.state, 'included');
  assert.equal(included.price, 0);
  assert.equal(included.priceLabel, 'Inclus');
  assert.equal(included.unavailableReason, undefined, 'still orderable: the guest picks mornings and hour');
  assert.deepEqual(included.occurrences, [{ date: '2099-07-08', time: '09:00' }]);
});

withShop('rule 26: categories in the core’s order, items by the plugin’s order, hourly in « Bien-être », the rest last', async ({ db, api, call }) => {
  addStay(db);
  addOption(db, { id: 1, title: 'Vin rouge', category: 'Boissons' });
  addOption(db, { id: 2, title: 'Cidre', category: 'Boissons' });
  addOption(db, { id: 3, title: 'Planche apéro', category: 'Restauration' });
  addOption(db, { id: 4, title: 'Bouquet', category: '' });
  addOption(db, { id: 5, title: 'Pas vendu', category: 'Décoration' });
  addResource(db, { id: 6, name: 'Bain nordique' });
  addResource(db, { id: 7, name: 'Fagot de bois', priceType: 'per_stay' });
  sell(db, 'option', 1, { sortOrder: 1 });
  sell(db, 'option', 2, { sortOrder: 2 });
  sell(db, 'option', 3);
  sell(db, 'option', 4);
  sell(db, 'resource', 6);
  sell(db, 'resource', 7);
  const shop = await shopOf(call, await scan(api, db, call));
  assert.deepEqual(shop.categories.map((c) => [c.name, c.items.map((i) => i.title)]), [
    ['Bien-être', ['Bain nordique']],
    ['Boissons', ['Vin rouge', 'Cidre']],
    ['Restauration', ['Planche apéro']],
    ['Autres', ['Bouquet', 'Fagot de bois']],
  ], 'an empty category (« Décoration ») is not shown');
  assert.equal(item(shop, 'resource', 6).scheduling, 'hourly');
  assert.equal(item(shop, 'resource', 7).scheduling, undefined);
  assert.equal((await shopOf(call, await scan(api, db, call), '?lang=en')).categories[0].name, 'Wellness');
});

withShop('rule 23 edge: hourly-resources inactive → the hourly resource is absent, the rest stays', async ({ db, api, call }) => {
  addStay(db);
  addResource(db, { id: 6, name: 'Bain nordique' });
  addResource(db, { id: 7, name: 'Fagot de bois', priceType: 'per_stay' });
  sell(db, 'resource', 6);
  sell(db, 'resource', 7);
  const shop = await shopOf(call, await scan(api, db, call));
  assert.deepEqual(itemsOf(shop).map((i) => i.id), [7]);
}, { hourly: false });

withShop('rule 27: open during the stay; read-only before it; closed once the complement is collected', async ({ db, api, call, clock }) => {
  const stay = addStay(db);
  addOption(db, { id: 1, title: 'Cidre' });
  sell(db, 'option', 1);
  enable(api, db, 1);
  clock.now = paris('2099-07-03', '12:00');
  const lookup = await call('POST', '/public/v1/guest/sessions/lookup', { lastName: 'Le Goff-Durand', reservationNumber: 'R-99-001' });
  assert.equal(lookup.body.data.mode, 'preArrival');
  const before = await shopOf(call, lookup.setCookie.split(';')[0]);
  assert.equal(before.open, false);
  assert.equal(before.closedReason, 'Disponible pendant votre séjour');
  assert.equal(before.canPayNote, false);
  assert.equal(itemsOf(before).length, 1, 'the catalogue is shown, read-only');
  clock.now = paris('2099-07-07', '12:00');
  const cookie = await scan(api, db, call);
  const during = await shopOf(call, cookie);
  assert.equal(during.open, true);
  assert.equal(during.closedReason, undefined);
  assert.equal(during.canPayNote, true);
  db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1 WHERE id = ?').run(stay);
  const after = await shopOf(call, cookie);
  assert.equal(after.open, false);
  assert.equal(after.closedReason, 'La boutique est fermée — bon retour !');
  assert.equal((await shopOf(call, cookie, '?lang=en')).closedReason, 'The shop is closed — safe travels home!');
});

withShop('rules 11bis, 27: the shop module off answers 404 MODULE_OFF; a visitor has no shop; no session is 401', async ({ db, api, call }) => {
  addStay(db);
  addOption(db, { id: 1, title: 'Cidre' });
  sell(db, 'option', 1);
  const off = await scan(api, db, call, 1, { modules: defaultModulesOff('shop') });
  const res = await call('GET', '/public/v1/guest/shop', null, { cookie: off });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'MODULE_OFF');
  const visitor = await scan(api, db, call, 2);
  const visitorRes = await call('GET', '/public/v1/guest/shop', null, { cookie: visitor });
  assert.equal(visitorRes.status, 404);
  assert.equal(visitorRes.body.error.code, 'MODULE_OFF');
  assert.equal((await call('GET', '/public/v1/guest/shop', null, { cookie: 'gf_guest=nothing' })).status, 401);
});

withShop('rule 33: card payment only while a provider is ready', async ({ db, api, call }) => {
  addStay(db);
  addOption(db, { id: 1, title: 'Cidre' });
  sell(db, 'option', 1);
  const cookie = await scan(api, db, call);
  assert.equal((await shopOf(call, cookie)).canPayCard, true);
  require('../../sdk/registry').ensure('online-payment').paymentProvider.isReady = () => false;
  assert.equal((await shopOf(call, cookie)).canPayCard, false);
}, { payment: 'ready' });

withShop('rule 33: no online-payment plugin → no card payment', async ({ db, api, call }) => {
  addStay(db);
  addOption(db, { id: 1, title: 'Cidre' });
  sell(db, 'option', 1);
  assert.equal((await shopOf(call, await scan(api, db, call))).canPayCard, false);
});
