// specs/guest-app.md rules 22, 23, 27bis, 39 — the sell switch and its fields, validated at the boundary of the real
// admin routes.
const test = require('node:test');
const assert = require('node:assert/strict');

const { addOption, addResource, freshDb, startApi } = require('./guestAppFixtures');

function withApi(name, fn) {
  test(name, async () => {
    const db = freshDb();
    addOption(db, { id: 1, title: 'Cidre', category: 'Boissons' });
    addOption(db, { id: 2, title: 'Ménage quotidien', priceType: 'per_night' });
    addOption(db, { id: 3, title: 'Taxe de séjour bis', priceType: 'per_person_per_night' });
    addOption(db, { id: 4, title: 'Assurance', priceType: 'percent_of_stay', isCancellationInsurance: 1 });
    addOption(db, { id: 5, title: 'Dîner dégressif', priceType: 'per_participant_progressive' });
    addOption(db, { id: 6, title: 'Départ tardif', autoOptionType: 'late_check_out' });
    addOption(db, { id: 7, title: 'Pourcentage', priceType: 'percent_of_stay' });
    addOption(db, { id: 8, title: 'Petit déjeuner', priceType: 'per_person_per_night', autoOptionType: 'breakfast' });
    addResource(db, { id: 20, name: 'Bain nordique' });
    const ctx = await startApi(db);
    try {
      await fn({ db, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const stored = (db) => db.prepare('SELECT * FROM guest_app_items ORDER BY kind, itemId').all();

withApi('rule 22: every option and resource is listed with its plugin row merged and its sellable state', async ({ db, call }) => {
  db.prepare("INSERT INTO guest_app_items (kind, itemId, sold, maxQuantity) VALUES ('option', 1, 1, 4)").run();
  const res = await call('GET', '/api/guest-app/items');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 9);
  const cidre = res.body.find((i) => i.kind === 'option' && i.id === 1);
  assert.deepEqual(cidre, {
    kind: 'option', id: 1, title: 'Cidre', priceType: 'per_stay', category: 'Boissons', archived: false,
    sellable: { ok: true, reason: null }, sold: true, mediaId: null, shortDescriptionFr: null, shortDescriptionEn: null,
    maxQuantity: 4, needsStaff: false, leadMinutes: 30,
    stockable: true,
    stock: {
      tracked: false, quantity: null, quantityLabel: null, held: 0, heldLabel: null, left: null, alertBelow: null, soldOut: false, out: false, restockLine: null,
    },
  });
  const bath = res.body.find((i) => i.kind === 'resource' && i.id === 20);
  assert.equal(bath.sold, false, 'no plugin row: not sold, the table’s defaults');
  assert.equal(bath.maxQuantity, 10);
  assert.equal(res.body.find((i) => i.id === 2).sellable.ok, false);
});

withApi('rules 22, 39: a PUT writes the fields it names and keeps the others', async ({ db, call }) => {
  const first = await call('PUT', '/api/guest-app/items/option/1', {
    sold: true, shortDescriptionFr: 'Cidre fermier de la vallée', shortDescriptionEn: 'Farm cider', maxQuantity: 6, needsStaff: true, leadMinutes: 45,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.sold, true);
  assert.equal(first.body.needsStaff, true);
  const second = await call('PUT', '/api/guest-app/items/option/1', { maxQuantity: 2 });
  assert.equal(second.body.maxQuantity, 2);
  assert.equal(second.body.shortDescriptionFr, 'Cidre fermier de la vallée');
  assert.equal(second.body.leadMinutes, 45);
  assert.deepEqual((await call('GET', '/api/guest-app/items/option/1')).body, second.body);
  const cleared = await call('PUT', '/api/guest-app/items/option/1', { shortDescriptionEn: '  ' });
  assert.equal(cleared.body.shortDescriptionEn, null);
  assert.equal(stored(db).length, 1);
});

withApi('rule 23: a non-sellable price type cannot be switched on — 400 NOT_SELLABLE with the reason', async ({ db, call }) => {
  for (const id of [2, 3, 4, 5, 6, 7]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('PUT', `/api/guest-app/items/option/${id}`, { sold: true });
    assert.equal(res.status, 400, String(id));
    assert.equal(res.body.code, 'NOT_SELLABLE', String(id));
    // eslint-disable-next-line no-await-in-loop
    const read = await call('GET', `/api/guest-app/items/option/${id}`);
    assert.equal(res.body.error, read.body.sellable.reason, 'the editor shows the same reason before the click');
  }
  assert.deepEqual(stored(db), []);
  const off = await call('PUT', '/api/guest-app/items/option/2', { sold: false, maxQuantity: 3 });
  assert.equal(off.status, 200, 'switching off, or editing the other fields, stays allowed');
});

withApi('rule 23 (R36b N2): a per-person resource cannot be switched on — 400 NOT_SELLABLE with the reason', async ({ db, call }) => {
  addResource(db, { id: 21, name: 'Vélo', priceType: 'per_person', price: 10 });
  const res = await call('PUT', '/api/guest-app/items/resource/21', { sold: true });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'NOT_SELLABLE');
  assert.equal(res.body.error, 'Une ressource au prix par personne ne se vend pas dans l’application.');
  assert.equal((await call('GET', '/api/guest-app/items/resource/21')).body.sellable.ok, false);
  assert.deepEqual(stored(db), []);
});

withApi('rule 27bis: the seeded breakfast can be switched on despite its per-person-night price', async ({ call }) => {
  const res = await call('PUT', '/api/guest-app/items/option/8', { sold: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.sold, true);
  assert.deepEqual(res.body.sellable, { ok: true, reason: null });
});

withApi('rules 31, 39: a resource is never « préparé par l’équipe »', async ({ call }) => {
  const res = await call('PUT', '/api/guest-app/items/resource/20', { sold: true, needsStaff: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.needsStaff, false);
  assert.equal(res.body.category, undefined);
});

withApi('rule 22: a photo must exist in the media library', async ({ db, call }) => {
  assert.equal((await call('PUT', '/api/guest-app/items/option/1', { mediaId: 9 })).status, 400);
  db.prepare("INSERT INTO guest_media (id, path, createdAt) VALUES (9, 'guest-app/cidre.webp', '2099-01-01T00:00:00Z')").run();
  assert.equal((await call('PUT', '/api/guest-app/items/option/1', { mediaId: 9 })).body.mediaId, 9);
  assert.equal((await call('PUT', '/api/guest-app/items/option/1', { mediaId: null })).body.mediaId, null);
});

const BAD_BODIES = [
  ['unknown field', { price: 0 }],
  ['sortOrder is not a field of the switch', { sortOrder: 1 }],
  ['sold not a boolean', { sold: 'yes' }],
  ['description too long', { shortDescriptionFr: 'x'.repeat(141) }],
  ['English description too long', { shortDescriptionEn: 'x'.repeat(141) }],
  ['description not text', { shortDescriptionFr: 12 }],
  ['maxQuantity 0', { maxQuantity: 0 }],
  ['maxQuantity 51', { maxQuantity: 51 }],
  ['maxQuantity not whole', { maxQuantity: 1.5 }],
  ['leadMinutes negative', { leadMinutes: -1 }],
  ['leadMinutes 241', { leadMinutes: 241 }],
  ['leadMinutes as text', { leadMinutes: '30' }],
  ['needsStaff not a boolean', { needsStaff: 1 }],
  ['mediaId not an id', { mediaId: 'x' }],
  ['body an array', [true]],
];

withApi('rules 22, 39: the boundary refuses a bad body and stores nothing', async ({ db, call }) => {
  for (const [label, body] of BAD_BODIES) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('PUT', '/api/guest-app/items/option/1', body);
    assert.equal(res.status, 400, label);
    assert.equal(typeof res.body.error, 'string', label);
  }
  assert.equal((await call('PUT', '/api/guest-app/items/option/1', { shortDescriptionFr: 'x'.repeat(140), maxQuantity: 50, leadMinutes: 240 })).status, 200, 'the bounds themselves pass');
  assert.equal(stored(db).length, 1);
});

withApi('rule 22: an unknown kind or a bad id answers 400, a missing item 404', async ({ call }) => {
  assert.equal((await call('GET', '/api/guest-app/items/cocktail/1')).status, 400);
  assert.equal((await call('PUT', '/api/guest-app/items/option/abc', { sold: true })).status, 400);
  assert.equal((await call('GET', '/api/guest-app/items/option/99')).status, 404);
  assert.equal((await call('PUT', '/api/guest-app/items/resource/99', { sold: true })).status, 404);
});

test('rule 22: the sell switch is the admin’s, a restricted role is refused', () => {
  const enforceRoleAccess = require('../../../middleware/enforceRoleAccess');
  ['reception', 'accountant'].forEach((role) => {
    [['GET', '/guest-app/items'], ['PUT', '/guest-app/items/option/1']].forEach(([method, path]) => {
      const res = { code: null, status(code) { this.code = code; return this; }, json() { return this; } };
      let passed = false;
      enforceRoleAccess({ user: { roles: [role] }, method, path }, res, () => { passed = true; });
      assert.equal(passed, false, `${role} ${method}`);
      assert.equal(res.code, 403, `${role} ${method}`);
    });
  });
});

// specs/guest-app.md rule 48 — the studio's Boutique lists the articles linked to the chosen lodging, at its price.
test('rule 48: ?propertyId= lists only the lodging’s articles, each with that lodging’s price', async () => {
  const db = freshDb();
  addOption(db, { id: 1, title: 'Cidre', category: 'Boissons', price: 4.5, prices: { 2: 0 } });
  addOption(db, { id: 2, title: 'Bois', lodgings: [1] });
  addResource(db, { id: 20, name: 'Bain nordique', lodgings: [2] });
  const ctx = await startApi(db);
  try {
    const granja = await ctx.call('GET', '/api/guest-app/items?propertyId=1');
    assert.equal(granja.status, 200);
    assert.deepEqual(granja.body.map((i) => `${i.kind}:${i.id}`).sort(), ['option:1', 'option:2']);
    assert.equal(granja.body.find((i) => i.id === 1).priceLabel, '4,50 €');
    const estiva = await ctx.call('GET', '/api/guest-app/items?propertyId=2');
    assert.deepEqual(estiva.body.map((i) => `${i.kind}:${i.id}`).sort(), ['option:1', 'resource:20']);
    assert.equal(estiva.body.find((i) => i.id === 1).priceLabel, 'Inclus (0 €)');
    assert.equal((await ctx.call('GET', '/api/guest-app/items?propertyId=x')).status, 400);
  } finally {
    await ctx.close();
  }
});

// specs/guest-app.md rule 48 (2026-11-12) — a resource set to « Tous les logements » in GuestFlow has no lodging row
// (choosing every lodging collapses to it): it belongs to every lodging's Boutique, like the engine reads it.
test('rule 48: ?propertyId= lists a « Tous les logements » resource in every lodging', async () => {
  const db = freshDb();
  addResource(db, { id: 20, name: 'Bain nordique', lodgings: [] });
  addResource(db, { id: 21, name: 'Vélo', priceType: 'per_stay', lodgings: [2] });
  const ctx = await startApi(db);
  try {
    const granja = await ctx.call('GET', '/api/guest-app/items?propertyId=1');
    assert.deepEqual(granja.body.map((i) => `${i.kind}:${i.id}`).sort(), ['resource:20']);
    const estiva = await ctx.call('GET', '/api/guest-app/items?propertyId=2');
    assert.deepEqual(estiva.body.map((i) => `${i.kind}:${i.id}`).sort(), ['resource:20', 'resource:21']);
  } finally {
    await ctx.close();
  }
});
