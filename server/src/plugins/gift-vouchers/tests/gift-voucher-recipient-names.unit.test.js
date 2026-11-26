// specs/site/site-outside-resource-booking.md rules 31-33 — the recipient of a voucher in two required fields: refused when empty or past 40 characters (with the field), stored apart while
// `recipientName` keeps the first name for every reader that prints it, opened to the session page as first and last name, searchable and shown by the operator, and the orders sold
// before the split keep their name as the first name.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const adminFx = require('./giftVoucherFixtures');
const sdk = require('../../sdk');
const campaignRules = require('../campaignRules');
const { MIGRATIONS } = require('../migrations');
const use = require('./useFixture');

const ids = fx.seedCatalogue();
const offerOfBath = use.bookingOffer();
const shop = fx.openShop({ resources: () => offerOfBath.offer });
const { api } = shop;
api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api)).value);

const NAMES = { recipientFirstName: 'Marie', recipientLastName: 'Durand' };
const parties = (body, emailRequired = false) => api.offerService.partiesOf(body, { emailRequired });

test('rule 32 — both names are required: empty, blank or missing is refused with the field of the one that is missing, the first name first', () => {
  assert.deepEqual(parties({}), { ok: false, code: 'RECIPIENT_FIRST_NAME_REQUIRED', field: 'recipientFirstName' });
  assert.deepEqual(parties({ recipientFirstName: '   ', recipientLastName: 'Durand' }), { ok: false, code: 'RECIPIENT_FIRST_NAME_REQUIRED', field: 'recipientFirstName' });
  assert.deepEqual(parties({ recipientFirstName: 'Marie' }), { ok: false, code: 'RECIPIENT_LAST_NAME_REQUIRED', field: 'recipientLastName' });
  assert.deepEqual(parties({ recipientFirstName: 'Marie', recipientLastName: ' ' }), { ok: false, code: 'RECIPIENT_LAST_NAME_REQUIRED', field: 'recipientLastName' });
  assert.deepEqual(parties({ recipientLastName: 'Durand' }), { ok: false, code: 'RECIPIENT_FIRST_NAME_REQUIRED', field: 'recipientFirstName' });
});

test('rule 32 — each name holds 40 characters at most and is text; both are trimmed and the old single field is no longer read', () => {
  assert.equal(parties({ ...NAMES, recipientFirstName: 'x'.repeat(40) }).ok, true);
  assert.deepEqual(parties({ ...NAMES, recipientFirstName: 'x'.repeat(41) }), { ok: false, code: 'FIELD_INVALID', field: 'recipientFirstName' });
  assert.deepEqual(parties({ ...NAMES, recipientLastName: 'x'.repeat(41) }), { ok: false, code: 'FIELD_INVALID', field: 'recipientLastName' });
  assert.deepEqual(parties({ ...NAMES, recipientLastName: 42 }), { ok: false, code: 'FIELD_INVALID', field: 'recipientLastName' });
  const { value } = parties({ recipientFirstName: ' Marie ', recipientLastName: ' Durand ' });
  assert.deepEqual([value.recipientFirstName, value.recipientLastName, 'recipientName' in value], ['Marie', 'Durand', false]);
  assert.equal(parties({ recipientName: 'Marie' }).code, 'RECIPIENT_FIRST_NAME_REQUIRED');
});

const issue = (over = {}) => {
  const out = api.offerService.issueDirect({
    request: { slug: 'bain-jour' },
    parties: parties({ ...NAMES, senderName: 'Paul', ...over }).value,
    outcome: 'paid',
    paymentMethod: 'cash',
    actor: 'user:7',
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  return { id: out.voucherId, code: sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted).value };
};

test('rules 32-33 — an order stores both names and keeps `recipientName` as the first name, which the PDF, the mails and the notices print', () => {
  const { id } = issue();
  const voucher = api.vouchers.find(id);
  assert.deepEqual([voucher.recipientFirstName, voucher.recipientLastName, voucher.recipientName], ['Marie', 'Durand', 'Marie']);
});

test('rule 31 — « Utiliser un bon » opens with the recipient’s first and last names; `recipientName` stays the first name', () => {
  const { code } = issue({ recipientFirstName: 'Léa', recipientLastName: 'Martin' });
  const { data } = api.useService.open({ code, visitor: { ip: '10.0.0.9' } });
  assert.deepEqual([data.recipientFirstName, data.recipientLastName, data.recipientName], ['Léa', 'Martin', 'Léa']);
});

test('rule 33 — the migration gives an order sold before the split its name as the first name, leaves the last name empty and is safe to run again', () => {
  const db = new Database(':memory:');
  MIGRATIONS[0].up(db);
  db.prepare("INSERT INTO gift_voucher_orders (amountCents, recipientName, source, state, createdAt) VALUES (5000, 'Marie', 'manual', 'issued', '2026-11-01T10:00:00Z')").run(); // date-literal-ok: the suite runs on its own clock, never the real today
  db.prepare("INSERT INTO gift_voucher_orders (amountCents, source, state, createdAt) VALUES (7000, 'manual', 'issued', '2026-11-02T10:00:00Z')").run(); // date-literal-ok: the suite runs on its own clock, never the real today
  const step = MIGRATIONS.find((m) => m.name === 'gift_voucher_recipient_names_v4');
  step.up(db);
  step.up(db);
  const rows = db.prepare('SELECT recipientName, recipientFirstName, recipientLastName FROM gift_voucher_orders ORDER BY id').all();
  assert.deepEqual(rows, [
    { recipientName: 'Marie', recipientFirstName: 'Marie', recipientLastName: '' },
    { recipientName: '', recipientFirstName: '', recipientLastName: '' },
  ]);
});

async function withAdmin(fn) {
  const fixture = adminFx.buildApi();
  const server = await adminFx.start(fixture);
  try {
    await fn({ ...fixture, server });
  } finally {
    await server.close();
  }
}

test('rule 32 — « Nouveau bon » goes through the same refusals, each with its field, and the list and the detail carry both names', () => withAdmin(async ({ server }) => {
  const post = (body) => server.call('POST', '/api/gift-vouchers', { amountCents: 5000, paymentMethod: 'cash', ...body });
  const noFirst = await post({ recipientLastName: 'Durand' });
  assert.deepEqual([noFirst.status, noFirst.body.code, noFirst.body.field], [400, 'RECIPIENT_FIRST_NAME_REQUIRED', 'recipientFirstName']);
  const noLast = await post({ recipientFirstName: 'Marie' });
  assert.deepEqual([noLast.status, noLast.body.code, noLast.body.field], [400, 'RECIPIENT_LAST_NAME_REQUIRED', 'recipientLastName']);
  const created = await post({ recipientFirstName: 'Zoé', recipientLastName: 'Petit' });
  assert.equal(created.status, 201);
  assert.deepEqual([created.body.recipientFirstName, created.body.recipientLastName], ['Zoé', 'Petit']);
  await post({ ...NAMES });
  const ids = async (query) => (await server.call('GET', `/api/gift-vouchers?${query}`)).body.items.map((i) => i.recipientLastName);
  assert.deepEqual(await ids('q=petit'), ['Petit'], 'the search reads the last name');
  assert.deepEqual(await ids('q=zo%C3%A9'), ['Petit'], 'and the first name');
  assert.deepEqual(await ids('q=durand'), ['Durand']);
}));

test('rule 32 — a connector before 1.24.0 sends the single `recipientName`: taken as the first name, optional as before, on the public path only', () => {
  const legacy = (body) => api.offerService.partiesOf(body, { emailRequired: false, legacyName: true });
  const taken = legacy({ recipientName: ' Marie ' });
  assert.deepEqual([taken.ok, taken.value.recipientFirstName, taken.value.recipientLastName], [true, 'Marie', '']);
  assert.equal(legacy({ recipientName: '' }).ok, true);
  assert.deepEqual(legacy({ recipientName: 'x'.repeat(41) }), { ok: false, code: 'FIELD_INVALID', field: 'recipientFirstName' });
  assert.deepEqual(legacy({ recipientName: 12 }), { ok: false, code: 'FIELD_INVALID', field: 'recipientFirstName' });
  assert.equal(legacy({}).code, 'RECIPIENT_FIRST_NAME_REQUIRED');
  assert.equal(legacy({ recipientName: 'Marie', recipientFirstName: 'Marie' }).code, 'RECIPIENT_LAST_NAME_REQUIRED', 'the new fields present: both are required');
  assert.equal(parties({ recipientName: 'Marie' }).code, 'RECIPIENT_FIRST_NAME_REQUIRED', 'not on the operator’s path');
});

test('rule 32 — the operator’s search also finds a voucher by the full « Prénom Nom »', () => withAdmin(async ({ server }) => {
  await server.call('POST', '/api/gift-vouchers', { amountCents: 5000, paymentMethod: 'cash', recipientFirstName: 'Léa', recipientLastName: 'Martin' });
  const found = (await server.call('GET', `/api/gift-vouchers?q=${encodeURIComponent('léa martin')}`)).body.items;
  assert.deepEqual(found.map((i) => i.recipientLabel), ['Léa Martin']);
}));
