// specs/gift-voucher-campaigns.md rules 5, 6, 17, 27, 44 — the price of a composed voucher comes from the pricing engine only, for the outside customer: the band's
// external rate, the resource's degressive tiers by hour rank (extra time continues the ranks of the included minutes), each option at its catalogue price, the
// outside VAT of each line's class. Nothing is stored by the campaign, nothing is written by a price, a campaign the engine cannot price is not offered.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');

const ids = fx.seedCatalogue();
const { api, db } = fx.openShop();
const create = (over) => {
  const checked = require('../campaignRules').validateCampaign(fx.bathCampaign(ids, over), fx.rulesContext(api));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return api.campaigns.find(api.campaigns.insert(checked.value));
};
const bath = create();
const price = (request) => api.offerService.price({ slug: bath.slug, ...request });

test('2 h of day + a board = 95 + 14 = 109 €, each line with its VAT rate and the VAT per rate, as the engine cut them', () => {
  const answer = price({});
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.lines.map((l) => [l.kind, l.label, l.qty, l.totalCents, l.vatRate]), [
    ['session', 'Bain nordique · journée', 1, 9500, 20],
    ['option', 'Planche apéro', 1, 1400, 10],
  ]);
  assert.equal(answer.totalCents, 10900);
  assert.deepEqual(answer.vat, [{ rate: 10, cents: 127 }, { rate: 20, cents: 1583 }]);
  assert.deepEqual(answer.vatLines.map((l) => [l.ratePercent, l.htCents, l.vatCents]), [[10, 1273, 127], [20, 7917, 1583]]);
  assert.equal(answer.vatLines.reduce((sum, l) => sum + l.htCents + l.vatCents, 0), answer.totalCents);
});

test('extra time continues the ranks of the included minutes: the 3rd hour is at −20 %, and one line or two cost the same', () => {
  const withExtra = price({ extraMinutes: 60 });
  assert.deepEqual(withExtra.lines.map((l) => [l.kind, l.label, l.totalCents]), [
    ['session', 'Bain nordique · journée', 9500],
    ['extra', 'Temps supplémentaire · 1 h', 4000],
    ['option', 'Planche apéro', 1400],
  ]);
  assert.equal(withExtra.totalCents, 14900);
  const twoHours = price({ extraMinutes: 120 });
  assert.equal(twoHours.lines[1].totalCents, 8000, 'the 3rd and the 4th hour both at the last tier');
  const whole = fx.db.prepare('SELECT 1').get() && require('../../../utils/standaloneSale').quote({
    lines: [{ articleRef: `resource:${ids.bath}`, session: { band: 'day', minutes: 180 } }],
  });
  assert.equal(whole.document.totals.totalCents, 9500 + 4000, 'priced as one 3 h session by the same engine');
});

test('an evening voucher is priced at the evening rate: 2 h = 70 + 63 = 133 €', () => {
  const evening = create({
    name: 'Bain soirée', slug: 'bain-soir', composition: { resourceId: ids.bath, band: 'evening', minutes: 120, options: [] }, addOns: [], extraTimeMaxMinutes: 0,
  });
  const answer = api.offerService.price({ slug: evening.slug });
  assert.equal(answer.totalCents, 13300);
  assert.deepEqual(answer.vat, [{ rate: 20, cents: 2217 }]);
});

test('add-ons are priced at their own class: a drink at 20 %, the board at 10 %; the VAT is listed per rate', () => {
  const answer = price({ addOns: [{ articleRef: `option:${ids.drink}`, qty: 2 }] });
  assert.equal(answer.totalCents, 9500 + 1400 + 1300);
  assert.deepEqual(answer.lines.map((l) => [l.kind, l.label, l.qty, l.unitCents, l.totalCents, l.vatRate]).slice(-1), [['addOn', 'Boisson', 2, 650, 1300, 20]]);
  assert.deepEqual(answer.vat.map((v) => v.rate), [10, 20]);
  assert.equal(answer.vat.find((v) => v.rate === 20).cents, 1583 + 217);
});

test('a price is read each time: a rate changed on the resource moves the price with no change to the campaign', () => {
  const before = price({}).totalCents;
  const updatedAt = api.campaigns.find(bath.id).updatedAt;
  db.prepare('UPDATE resources SET hourlyExternalDayRate = 60 WHERE id = ?').run(ids.bath);
  assert.equal(price({}).totalCents, 6000 + 5400 + 1400);
  db.prepare('UPDATE resources SET hourlyExternalDayRate = 50 WHERE id = ?').run(ids.bath);
  assert.equal(price({}).totalCents, before);
  assert.equal(api.campaigns.find(bath.id).updatedAt, updatedAt);
  assert.equal(Object.keys(db.prepare('SELECT * FROM gift_voucher_campaigns WHERE id = ?').get(bath.id)).some((c) => /price|cents$/i.test(c) && !/amount|extra/i.test(c)), false, 'no price column on a campaign');
});

test('extra time is refused beyond what the campaign offers, off the slot step and where none is offered — each with its sentence', () => {
  assert.deepEqual([price({ extraMinutes: 180 }).code, price({ extraMinutes: 180 }).message], ['EXTRA_TIME_NOT_OFFERED', 'Temps supplémentaire : 2 h au plus.']);
  assert.equal(price({ extraMinutes: 'abc' }).code, 'EXTRA_TIME_INVALID');
  assert.equal(price({ extraMinutes: -60 }).code, 'EXTRA_TIME_INVALID');
  const none = create({ name: 'Sans rallonge', slug: 'sans-rallonge', extraTimeMaxMinutes: 0, addOns: [] });
  assert.equal(api.offerService.price({ slug: none.slug, extraMinutes: 60 }).message, 'Temps supplémentaire : non proposé avec ce bon.');
  db.prepare('UPDATE resources SET slotDuration = 30 WHERE id = ?').run(ids.bath);
  assert.equal(price({ extraMinutes: 45 }).code, 'PRICE_UNAVAILABLE');
  assert.match(price({ extraMinutes: 45 }).message, /^« Bain nordique » se réserve par tranches de 30 min : 45 min ne convient pas\.$/);
  db.prepare('UPDATE resources SET slotDuration = 60 WHERE id = ?').run(ids.bath);
});

test('an add-on the campaign does not offer, a quantity out of range and a repeated add-on are refused', () => {
  const ref = (id) => `option:${id}`;
  assert.equal(price({ addOns: [{ articleRef: ref(ids.perPerson), qty: 1 }] }).code, 'ADDON_NOT_OFFERED');
  assert.equal(price({ addOns: [{ articleRef: ref(ids.drink), qty: 0 }] }).code, 'ADDON_QTY_INVALID');
  assert.equal(price({ addOns: [{ articleRef: ref(ids.drink), qty: 21 }] }).code, 'ADDON_QTY_INVALID');
  assert.equal(price({ addOns: [{ articleRef: ref(ids.drink), qty: 1 }, { articleRef: ref(ids.drink), qty: 1 }] }).code, 'ADDON_DUPLICATE');
  assert.equal(price({ addOns: 'x' }).code, 'ADDONS_INVALID');
});

test('a price writes nothing: no order, no sale document, no voucher', () => {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const before = ['gift_voucher_orders', 'gift_vouchers', 'standalone_sales', 'gift_voucher_campaigns'].map(count);
  price({ extraMinutes: 60, addOns: [{ articleRef: `option:${ids.drink}`, qty: 1 }] });
  assert.deepEqual(['gift_voucher_orders', 'gift_vouchers', 'standalone_sales', 'gift_voucher_campaigns'].map(count), before);
});

test('a campaign the engine cannot price is left out of the offer, and the operator is told why', async () => {
  const fragile = create({ name: 'Fragile', title: 'Un bain fragile', slug: 'fragile' });
  assert.ok((await api.offerService.offer()).campaigns.some((c) => c.slug === 'fragile'));
  db.prepare('UPDATE resources SET sellableExternally = 0 WHERE id = ?').run(ids.bath);
  const offer = await api.offerService.offer({ withOmitted: true });
  assert.equal(offer.campaigns.some((c) => c.kind === 'resource'), false);
  assert.deepEqual(offer.omitted.map((o) => [o.id, o.reason]).filter(([id]) => id === fragile.id), [[fragile.id, 'Article non vendable hors séjour.']]);
  assert.deepEqual(api.offerService.campaignStatus(fragile), { priceable: false, reason: 'Article non vendable hors séjour.' });
  assert.equal(api.offerService.price({ slug: 'fragile' }).code, 'PRICE_UNAVAILABLE');
  db.prepare('UPDATE resources SET sellableExternally = 1 WHERE id = ?').run(ids.bath);
});

test('a band with no external rate prices nothing: the engine refuses, no free voucher is ever sold', () => {
  db.prepare('UPDATE resources SET hourlyExternalDayRate = 0, price = 0 WHERE id = ?').run(ids.bath);
  assert.deepEqual([price({}).code, price({}).message], ['PRICE_UNAVAILABLE', '« Bain nordique » n’a pas de tarif extérieur pour la journée.']);
  db.prepare('UPDATE resources SET hourlyExternalDayRate = 50, price = 25 WHERE id = ?').run(ids.bath);
});
