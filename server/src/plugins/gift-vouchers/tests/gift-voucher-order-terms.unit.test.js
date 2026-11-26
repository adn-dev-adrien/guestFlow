// specs/gift-vouchers/gift-voucher-campaigns.md rule 37 — a voucher order accepts the CURRENT terms of its campaign's activity (the lodging terms for a lodging campaign, the resource's for
// a composed one) through the core's record, with the visitor's address and agent; a bath cannot be sold before its terms are published; the operator's payment link records
// the acceptance at the payment, channel « lien de paiement »; the acceptances an order recorded in its own columns move into the core's record.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const sale = require('./giftVoucherFixtures');
const { termsStub } = require('./termsFixture');
const campaignRules = require('../campaignRules');
const { MIGRATIONS } = require('../migrations');

const ids = fx.seedCatalogue();
const published = {};
const terms = termsStub(published);
const shop = fx.openShop({ terms });
const { api, db } = shop;
const checked = campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api));
const bath = api.campaigns.find(api.campaigns.insert(checked.value));
let visitors = 0;

/** One shop for the suite; each test states which terms are published (an activity → its current version id). */
async function withShop(versions, fn) {
  Object.keys(published).forEach((key) => delete published[key]);
  Object.assign(published, versions);
  terms.accepted.length = 0;
  db.prepare('DELETE FROM gift_voucher_orders').run();
  const server = await fx.serve(api);
  const place = (body = {}) => {
    visitors += 1;
    const ip = `10.0.2.${visitors}`;
    return server.call('POST', '/public/v1/gift-vouchers/orders', {
      slug: bath.slug, recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', email: 'paul@example.test', language: 'fr', ...body, ...sale.solvedProof({ ip }),
    }, { 'x-test-ip': ip });
  };
  try { await fn({ ...shop, terms, bath, server, place }); } finally { await server.close(); }
}

const orders = (db) => db.prepare('SELECT * FROM gift_voucher_orders ORDER BY id').all();

test('a composed campaign asks the resource terms: not sent is TERMS_NOT_ACCEPTED, another version TERMS_OUTDATED, and no order is stored for a refusal', () => withShop({ lodging: 4, resource: 9 }, async ({ place, db, terms }) => {
  const missing = await place();
  assert.deepEqual([missing.status, missing.body.error.code], [400, 'TERMS_NOT_ACCEPTED']);
  const outdated = await place({ termsVersionId: 4 });
  assert.deepEqual([outdated.status, outdated.body.error.code], [400, 'TERMS_OUTDATED'], 'the lodging version is not the resource’s');
  assert.deepEqual(orders(db), []);
  assert.deepEqual(terms.accepted, []);
}));

test('the current version of the campaign’s activity is recorded through the core: activity, order, channel « site », the visitor’s address and agent', () => withShop({ lodging: 4, resource: 9 }, async ({ place, db, terms, server }) => {
  const res = await server.call('POST', '/public/v1/gift-vouchers/orders', {
    slug: 'bain-jour', recipientFirstName: 'Marie', recipientLastName: 'Durand', email: 'paul@example.test', termsVersionId: 9, ...sale.solvedProof({ ip: '10.0.3.1' }),
  }, { 'x-test-ip': '10.0.3.1' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const [row] = orders(db);
  assert.deepEqual(terms.accepted, [{
    activity: 'resource', versionId: 9, subjectType: 'voucherOrder', subjectRef: row.id, channel: 'site', ip: '10.0.3.1', userAgent: null, pluginVersion: null,
  }]);
  assert.deepEqual([row.termsVersionId, row.termsAcceptedAt], [null, null], 'the order’s old columns are no longer written');
  assert.ok((await place({ termsVersionId: 9 })).status === 201);
}));

test('a lodging campaign asks the lodging terms; with none published it asks nothing and records nothing', async () => {
  await withShop({ lodging: 4, resource: 9 }, async ({ server, terms }) => {
    const order = (termsVersionId) => server.call('POST', '/public/v1/gift-vouchers/orders', {
      slug: 'sejour', amountCents: 15000, recipientFirstName: 'Marie', recipientLastName: 'Durand', email: 'paul@example.test', termsVersionId, ...sale.solvedProof({ ip: '10.0.4.1' }),
    }, { 'x-test-ip': '10.0.4.1' });
    assert.equal((await order(9)).body.error.code, 'TERMS_OUTDATED');
    assert.equal((await order(4)).status, 201);
    assert.deepEqual(terms.accepted.map((a) => [a.activity, a.versionId]), [['lodging', 4]]);
  });
  await withShop({ resource: 9 }, async ({ server, terms, db }) => {
    const res = await server.call('POST', '/public/v1/gift-vouchers/orders', {
      slug: 'sejour', amountCents: 15000, recipientFirstName: 'Marie', recipientLastName: 'Durand', email: 'paul@example.test', ...sale.solvedProof({ ip: '10.0.4.2' }),
    }, { 'x-test-ip': '10.0.4.2' });
    assert.equal(res.status, 201, 'lodging behaves as before');
    assert.deepEqual([terms.accepted, orders(db).length], [[], 1]);
  });
});

test('specs/gift-vouchers/gift-voucher-campaigns.md rule 60 — a bath cannot be sold before its terms are published: the order is refused with a sentence, the offer leaves the campaign out, the lodging campaign stays', () => withShop({ lodging: 4 }, async ({ place, db, server }) => {
  const res = await place({ termsVersionId: 9 });
  assert.deepEqual([res.status, res.body.error.code], [409, 'TERMS_UNPUBLISHED']);
  assert.equal(res.body.error.message, 'Ce bon ne peut pas encore être vendu : les conditions de l’activité ne sont pas encore publiées.');
  assert.deepEqual(orders(db), []);
  const offer = (await server.call('GET', '/public/v1/gift-vouchers/offer', undefined, { 'x-test-ip': '10.0.5.1' })).body.data;
  assert.deepEqual(offer.campaigns.map((c) => c.slug), ['sejour']);
  const english = await server.call('POST', '/public/v1/gift-vouchers/orders', {
    slug: 'bain-jour', recipientFirstName: 'Marie', recipientLastName: 'Durand', email: 'paul@example.test', language: 'en', ...sale.solvedProof({ ip: '10.0.5.2' }),
  }, { 'x-test-ip': '10.0.5.2' });
  assert.equal(english.body.error.message, 'This voucher cannot be sold yet: the terms of the activity are not published yet.');
}));

test('the operator’s payment link records the acceptance at the payment, channel « lien de paiement », for the campaign’s activity — once, and never for a site order', () => withShop({ lodging: 4, resource: 9 }, async ({ server, api, terms, place }) => {
  const sent = await server.call('POST', '/api/gift-vouchers', { slug: 'bain-jour', outcome: 'link', email: 'paul@example.test', recipientFirstName: 'Marie', recipientLastName: 'Durand' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.deepEqual(terms.accepted, [], 'nothing is accepted by sending the link');
  const { orderId } = sent.body;
  const paidLink = () => api.orderPaid({ ref: String(orderId), linkId: 91, amountCents: sent.body.totalCents });
  paidLink();
  paidLink();
  assert.deepEqual(terms.accepted.map((a) => [a.activity, a.versionId, a.subjectType, a.subjectRef, a.channel]), [['resource', 9, 'voucherOrder', orderId, 'payment-link']]);
  const site = (await place({ termsVersionId: 9 })).body.data;
  terms.accepted.length = 0;
  api.orderPaid({ ref: String(site.orderId), linkId: 92, amountCents: sent.body.totalCents });
  assert.deepEqual(terms.accepted, [], 'a site order recorded its own when it was placed');
}));

function legacyDb() {
  const db = new Database(':memory:');
  MIGRATIONS.slice(0, 3).forEach((m) => m.up(db));
  db.exec(`CREATE TABLE terms_acceptances (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, termsVersionId INTEGER NOT NULL, acceptedAt TEXT NOT NULL, ip TEXT, userAgent TEXT, pluginVersion TEXT,
    activity TEXT NOT NULL DEFAULT 'lodging', subjectType TEXT NOT NULL DEFAULT 'reservation', subjectRef TEXT, channel TEXT NOT NULL DEFAULT 'site')`);
  const order = db.prepare("INSERT INTO gift_voucher_orders (amountCents, source, state, createdAt, termsVersionId, termsAcceptedAt) VALUES (5000, 'site', 'issued', '2026-11-01T10:00:00Z', ?, ?)"); // date-literal-ok: the suite runs on its own clock, never the real today
  order.run(3, '2026-11-01T10:00:00.000Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  order.run(null, null);
  order.run(4, '2026-11-02T10:00:00.000Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  return db;
}

test('migration: the acceptances an order recorded move into the core’s record as lodging, subject the order, channel site — once, the old columns kept', () => {
  const db = legacyDb();
  const visuals = MIGRATIONS.find((m) => m.name === 'gift_voucher_visuals_v1');
  visuals.up(db);
  const moved = () => db.prepare('SELECT termsVersionId, acceptedAt, activity, subjectType, subjectRef, channel, reservationId FROM terms_acceptances ORDER BY id').all();
  assert.deepEqual(moved(), [
    {
      termsVersionId: 3, acceptedAt: '2026-11-01T10:00:00.000Z', activity: 'lodging', subjectType: 'voucherOrder', subjectRef: '1', channel: 'site', reservationId: null, // date-literal-ok: the suite runs on its own clock, never the real today
    },
    {
      termsVersionId: 4, acceptedAt: '2026-11-02T10:00:00.000Z', activity: 'lodging', subjectType: 'voucherOrder', subjectRef: '3', channel: 'site', reservationId: null, // date-literal-ok: the suite runs on its own clock, never the real today
    },
  ]);
  assert.equal(db.prepare('SELECT termsVersionId FROM gift_voucher_orders WHERE id = 1').get().termsVersionId, 3, 'the columns stay');
  visuals.up(db);
  assert.equal(moved().length, 2, 'a second run carries over nothing twice');
});

test('migration: a host with no record of acceptances has nothing to carry over', () => {
  const db = new Database(':memory:');
  MIGRATIONS.slice(0, 3).forEach((m) => m.up(db));
  db.prepare("INSERT INTO gift_voucher_orders (amountCents, source, createdAt, termsVersionId, termsAcceptedAt) VALUES (5000, 'site', '2026-11-01T10:00:00Z', 3, '2026-11-01T10:00:00.000Z')").run(); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.doesNotThrow(() => MIGRATIONS.find((m) => m.name === 'gift_voucher_visuals_v1').up(db));
});
