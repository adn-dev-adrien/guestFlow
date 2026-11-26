// specs/gift-vouchers/gift-voucher-campaigns.md §5, rules 3, 11 — the migration: the lodging settings (bounds, validity, VAT rate, ideas) become the one `lodging` campaign `sejour`, on sale when the
// plugin was set up, else a draft; every order and voucher already there points to it with the contents `{"kind":"lodging"}`; no row is deleted; running it again changes nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { MIGRATIONS } = require('../migrations');
const createCampaignsModel = require('../models/campaignsModel');

const campaignStep = MIGRATIONS.find((m) => m.name === 'gift_voucher_campaigns_v1');
const IDEAS = JSON.stringify([{ label: 'Un week-end', propertyId: 1, nights: 2, guests: 2 }]);

/** A database as the plugin 1.3.0 left it: its tables, two orders, two vouchers, and the settings an operator saved. */
function legacy(settings = null) {
  const db = new Database(':memory:');
  MIGRATIONS[0].up(db);
  MIGRATIONS[1].up(db);
  if (settings) {
    db.exec('CREATE TABLE plugin_settings (plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, updated_at TEXT, PRIMARY KEY (plugin_id, key))');
    Object.entries(settings).forEach(([key, value]) => db.prepare("INSERT INTO plugin_settings (plugin_id, key, value) VALUES ('gift-vouchers', ?, ?)").run(key, value));
    db.prepare("INSERT INTO plugin_settings (plugin_id, key, value) VALUES ('another-plugin', 'minAmountCents', '1')").run();
  }
  db.prepare("INSERT INTO gift_voucher_orders (amountCents, source, state, createdAt) VALUES (5000, 'manual', 'issued', '2026-11-01T10:00:00Z')").run(); // date-literal-ok: the suite runs on its own clock, never the real today
  db.prepare("INSERT INTO gift_voucher_orders (amountCents, source, state, createdAt) VALUES (9000, 'site', 'pending', '2026-11-02T10:00:00Z')").run(); // date-literal-ok: the suite runs on its own clock, never the real today
  db.prepare("INSERT INTO gift_vouchers (orderId, number, codeHash, codeEncrypted, amountCents, issuedAt, expiresOn) VALUES (1, 'BC-2026-0001', 'h1', 'e1', 5000, '2026-11-01T10:00:00Z', '2028-05-01')").run(); // date-literal-ok: the suite runs on its own clock, never the real today
  return db;
}

const rows = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();

test('the settings of the plugin become the lodging campaign « sejour », on sale since the page of the voucher was set up', () => {
  const db = legacy({
    minAmountCents: '3000', maxAmountCents: '150000', validityMonths: '12', vatRatePercent: '5,5', ideas: IDEAS, pageUrl: 'https://site.example.test/bon', mailSubjectFr: 'Sujet',
  });
  campaignStep.up(db);
  const campaigns = createCampaignsModel(db).list();
  assert.equal(campaigns.length, 1);
  assert.deepEqual(campaigns[0], {
    id: 1,
    name: 'Bon cadeau séjour',
    title: 'Bon cadeau',
    kind: 'lodging',
    state: 'on_sale',
    oneShot: false,
    slug: 'sejour',
    slugLockedAt: null,
    validityMonths: 12,
    composition: null,
    addOns: [],
    extraTimeMaxMinutes: 0,
    minAmountCents: 3000,
    maxAmountCents: 150000,
    ideas: [{ label: 'Un week-end', propertyId: 1, nights: 2, guests: 2 }],
    vatRatePercent: 5.5,
    voucherVisualId: null,
    merchantVisualId: null,
    createdAt: campaigns[0].createdAt,
    updatedAt: campaigns[0].updatedAt,
  });
});

test('every order and voucher already sold points to it, with the lodging contents and no VAT lines of their own; no row is deleted', () => {
  const db = legacy({ pageUrl: 'https://site.example.test/bon' });
  const before = { orders: rows(db, 'gift_voucher_orders').length, vouchers: rows(db, 'gift_vouchers').length };
  campaignStep.up(db);
  const orders = rows(db, 'gift_voucher_orders');
  const vouchers = rows(db, 'gift_vouchers');
  assert.deepEqual([orders.length, vouchers.length], [before.orders, before.vouchers]);
  [...orders, ...vouchers].forEach((row) => assert.deepEqual([row.campaignId, row.contents, row.vatLines], [1, '{"kind":"lodging"}', null]));
  assert.deepEqual([orders.map((o) => o.amountCents), vouchers.map((v) => v.number)], [[5000, 9000], ['BC-2026-0001']], 'what was sold is unchanged');
});

test('a plugin never set up starts the campaign as a draft, at the defaults of the settings it replaces', () => {
  const noSettings = legacy();
  campaignStep.up(noSettings);
  const [campaign] = createCampaignsModel(noSettings).list();
  assert.deepEqual([campaign.state, campaign.minAmountCents, campaign.maxAmountCents, campaign.validityMonths, campaign.vatRatePercent, campaign.ideas], ['draft', 2000, 200000, 18, 10, []]);
  const unset = legacy({ mailSubjectFr: 'Sujet' });
  campaignStep.up(unset);
  assert.equal(createCampaignsModel(unset).list()[0].state, 'draft');
});

test('values that cannot be read fall back as the settings read them: a min above the max, a validity out of range, a rate that is no rate', () => {
  const db = legacy({
    minAmountCents: '9000', maxAmountCents: '1000', validityMonths: '999', vatRatePercent: 'abc', ideas: '',
  });
  campaignStep.up(db);
  const [campaign] = createCampaignsModel(db).list();
  assert.deepEqual([campaign.minAmountCents, campaign.maxAmountCents, campaign.validityMonths, campaign.vatRatePercent], [2000, 200000, 120, 10]);
  assert.deepEqual(campaign.ideas, []);
});

test('it is idempotent: run again, nothing is added, changed or deleted — and the campaign an operator edited since is left alone', () => {
  const db = legacy({ pageUrl: 'https://site.example.test/bon', minAmountCents: '3000' });
  campaignStep.up(db);
  db.prepare("UPDATE gift_voucher_campaigns SET minAmountCents = 4000, state = 'closed' WHERE id = 1").run();
  const snapshot = JSON.stringify([rows(db, 'gift_voucher_campaigns'), rows(db, 'gift_voucher_orders'), rows(db, 'gift_vouchers')]);
  campaignStep.up(db);
  assert.equal(JSON.stringify([rows(db, 'gift_voucher_campaigns'), rows(db, 'gift_voucher_orders'), rows(db, 'gift_vouchers')]), snapshot);
});

test('a voucher or an order written after the migration without a campaign reads as lodging; a new database gets the campaign too', () => {
  const db = new Database(':memory:');
  MIGRATIONS.forEach((m) => m.up(db));
  assert.equal(createCampaignsModel(db).list().length, 1);
  db.prepare("INSERT INTO gift_voucher_orders (amountCents, source, createdAt) VALUES (5000, 'manual', '2026-11-03T10:00:00Z')").run(); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(db.prepare('SELECT contents FROM gift_voucher_orders').get().contents, '{"kind":"lodging"}');
  assert.deepEqual(MIGRATIONS.slice(-5).map((m) => m.name), ['gift_voucher_campaigns_v1', 'gift_voucher_visuals_v1', 'gift_voucher_uses_v1', 'gift_voucher_uses_people_v2', 'gift_voucher_uses_ref_v3']);
});
