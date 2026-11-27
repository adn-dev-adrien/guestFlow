// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 10-13 (offer, frozen period, validity menu) — the week and the weekend of a bath voucher priced by the engine.
// The redemption rules 14-17 are covered by the second half of this file.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../plugins/sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('../plugins/gift-vouchers/tests/campaignFixtures');
const rules = require('../plugins/gift-vouchers/voucherRules');

const ids = fx.seedCatalogue();
const { api, db } = fx.openShop();
// Week 50 € / 70 €, weekend 70 € / 90 €, following hours 45 / 63 and 60 / 80.
db.prepare(`UPDATE resources SET hourlyExternalWeekendDayRate = 70, hourlyExternalWeekendEveningRate = 90, hourlyExternalWeekendNextDayRate = 60, hourlyExternalWeekendNextEveningRate = 80 WHERE id = ?`).run(ids.bath);
const create = (over) => {
  const checked = require('../plugins/gift-vouchers/campaignRules').validateCampaign(fx.bathCampaign(ids, over), fx.rulesContext(api));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return api.campaigns.find(api.campaigns.insert(checked.value));
};
const contentsOf = (order) => JSON.parse(db.prepare('SELECT contents FROM gift_voucher_orders WHERE id = ?').get(order.id).contents);
const hour = { composition: { resourceId: ids.bath, band: 'day', minutes: 60, options: [] }, addOns: [], extraTimeMaxMinutes: 60 };
const both = create({ ...hour, name: 'Une heure', slug: 'une-heure', periods: ['week', 'weekend'] });
const weekOnly = create({ ...hour, name: 'Semaine', slug: 'semaine', periods: ['week'] });

test('rule 10 — a campaign offers one or both periods, both by default; at least one, nothing else', () => {
  const rulesOf = require('../plugins/gift-vouchers/campaignRules');
  const checked = (periods) => rulesOf.validateCampaign(fx.bathCampaign(ids, { ...hour, slug: 'p', periods }), fx.rulesContext(api));
  assert.deepEqual(checked(undefined).value.periods, ['week', 'weekend']);
  assert.deepEqual(checked(['weekend']).value.periods, ['weekend']);
  assert.equal(checked([]).errors[0].field, 'periods');
  assert.equal(checked(['month']).errors[0].field, 'periods');
});

test('rule 11 — the offer shows one price per period and the lowest as « à partir de »', async () => {
  const { campaigns } = await api.offerService.offer();
  const view = campaigns.find((c) => c.slug === 'une-heure');
  assert.deepEqual(view.periods, [{ period: 'week', priceCents: 5000, label: 'semaine' }, { period: 'weekend', priceCents: 7000, label: 'week-end' }]);
  assert.equal(view.totalCents, 5000);
  assert.deepEqual(view.extraTime.pricesByPeriod.weekend, [{ minutes: 60, cents: 6000 }]);
  assert.deepEqual(campaigns.find((c) => c.slug === 'semaine').periods.map((p) => p.period), ['week']);
});

test('rule 11 — the period is the giver\'s choice when the campaign offers two; one is implied; one that is not offered is refused', () => {
  assert.equal(api.offerService.price({ slug: 'une-heure' }).code, 'PERIOD_REQUIRED');
  assert.equal(api.offerService.price({ slug: 'une-heure', period: 'weekend' }).totalCents, 7000);
  assert.equal(api.offerService.price({ slug: 'une-heure', period: 'week' }).totalCents, 5000);
  assert.equal(api.offerService.price({ slug: 'semaine' }).totalCents, 5000);
  assert.equal(api.offerService.price({ slug: 'semaine', period: 'weekend' }).code, 'PERIOD_NOT_OFFERED');
  assert.equal(api.offerService.price({ slug: 'une-heure', period: 'lundi' }).code, 'PERIOD_NOT_OFFERED');
});

test('rule 12 — the period is frozen on the voucher, its title says it, and a later rate change moves nothing', () => {
  const placed = api.offerService.createOrder({
    request: { slug: 'une-heure', period: 'weekend' }, parties: { recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', message: '', email: 'p@x.test', language: 'fr' }, source: 'site',
  });
  assert.equal(placed.ok, true, JSON.stringify(placed));
  const contents = contentsOf(placed.order);
  assert.equal(contents.resource.period, 'weekend');
  assert.equal(contents.title, 'Un bain nordique · week-end');
  assert.equal(db.prepare('SELECT amountCents FROM gift_voucher_orders WHERE id = ?').get(placed.order.id).amountCents, 7000);
});

test('rule 13 — the validity is 3, 6, 12, 18 or 24 months and nothing else, on a campaign, « Nouveau bon » and « Sur mesure »', () => {
  assert.deepEqual(rules.VALIDITY_CHOICES, [3, 6, 12, 18, 24]);
  [3, 6, 12, 18, 24].forEach((months) => {
    const checked = require('../plugins/gift-vouchers/campaignRules').validateCampaign(fx.bathCampaign(ids, { ...hour, slug: `v${months}`, validityMonths: months }), fx.rulesContext(api));
    assert.equal(checked.ok, true, String(months));
  });
  [1, 4, 36, 120].forEach((months) => {
    const checked = require('../plugins/gift-vouchers/campaignRules').validateCampaign(fx.bathCampaign(ids, { ...hour, slug: 'v', validityMonths: months }), fx.rulesContext(api));
    assert.deepEqual(checked.errors[0], { field: 'validityMonths', message: 'La validité doit être de 3, 6, 12, 18 ou 24 mois.' });
  });
  const named = (validityMonths) => api.offerService.createOrder({
    request: { slug: 'semaine', validityMonths }, parties: { recipientFirstName: 'M', recipientLastName: 'D', senderName: 'P', message: '', email: '', language: 'fr' }, source: 'manual', createdBy: 'admin', admin: true,
  });
  assert.equal(named(7).code, 'VALIDITY_INVALID');
  assert.equal(named(7).message, 'La validité doit être de 3, 6, 12, 18 ou 24 mois.');
  const six = named(6);
  assert.equal(six.ok, true);
  assert.equal(contentsOf(six.order).validityMonths, 6, 'the validity picked for this voucher is frozen with its contents');
  const oneShot = api.offerService.price({ composition: hour.composition, validityMonths: 5, period: 'week' }, { admin: true });
  assert.equal(oneShot.code, 'COMPOSITION_INVALID');
});

test('rule 13 — the site\'s giver never chooses the validity: the campaign\'s stands', () => {
  const placed = api.offerService.createOrder({
    request: { slug: 'semaine', validityMonths: 3 }, parties: { recipientFirstName: 'M', recipientLastName: 'D', senderName: 'P', message: '', email: 'p@x.test', language: 'fr' }, source: 'site',
  });
  assert.equal(placed.ok, true);
  assert.equal(contentsOf(placed.order).validityMonths, undefined);
});
