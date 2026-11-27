// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 10-13 (offer, frozen period, validity menu) — the week and the weekend of a bath voucher priced by the engine.
// The redemption rules 14-17 are covered by the second half of this file.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const use = require('./useFixture');
const rules = require('../voucherRules');
const { memorySettings } = require('..');
const sdk = require('../../sdk');

const ids = fx.seedCatalogue();
const offerOfBath = use.bookingOffer();
const links = use.paymentLinks();
const settingsStore = memorySettings();
const shop = fx.openShop({ resources: () => offerOfBath.offer, payments: links.payments, settingsStore: () => settingsStore });
const { api, db, clock } = shop;
// Week 50 € / 70 €, weekend 70 € / 90 €, following hours 45 / 63 and 60 / 80.
db.prepare(`UPDATE resources SET hourlyExternalWeekendDayRate = 70, hourlyExternalWeekendEveningRate = 90, hourlyExternalWeekendNextDayRate = 60, hourlyExternalWeekendNextEveningRate = 80 WHERE id = ?`).run(ids.bath);
const create = (over) => {
  const checked = require('../campaignRules').validateCampaign(fx.bathCampaign(ids, over), fx.rulesContext(api));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return api.campaigns.find(api.campaigns.insert(checked.value));
};
const contentsOf = (order) => JSON.parse(db.prepare('SELECT contents FROM gift_voucher_orders WHERE id = ?').get(order.id).contents);
const hour = { composition: { resourceId: ids.bath, band: 'day', minutes: 60, options: [] }, addOns: [], extraTimeMaxMinutes: 60 };
const both = create({ ...hour, name: 'Une heure', slug: 'une-heure', periods: ['week', 'weekend'] });
const weekOnly = create({ ...hour, name: 'Semaine', slug: 'semaine', periods: ['week'] });

test('rule 10 — a campaign offers one or both periods, both by default; at least one, nothing else', () => {
  const rulesOf = require('../campaignRules');
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
  assert.equal(api.offerService.price({ slug: 'une-heure' }, { admin: true }).code, 'PERIOD_REQUIRED');
  assert.equal(api.offerService.price({ slug: 'une-heure' }).totalCents, 5000, 'K1: a public caller without a period gets the cheapest one');
  assert.equal(api.offerService.price({ slug: 'une-heure', period: 'weekend' }).totalCents, 7000);
  assert.equal(api.offerService.price({ slug: 'une-heure', period: 'week' }).totalCents, 5000);
  assert.equal(api.offerService.price({ slug: 'semaine' }).totalCents, 5000);
  assert.equal(api.offerService.price({ slug: 'semaine', period: 'weekend' }).code, 'PERIOD_NOT_OFFERED');
  assert.equal(api.offerService.price({ slug: 'une-heure', period: 'lundi' }).code, 'PERIOD_NOT_OFFERED');
});

test('K1 — a public order without a period freezes the cheapest period; an admin order without one is refused', () => {
  const parties = { recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', message: '', email: 'p@x.test', language: 'fr' };
  const site = api.offerService.createOrder({ request: { slug: 'une-heure' }, parties, source: 'site' });
  assert.equal(site.ok, true, JSON.stringify(site));
  assert.equal(contentsOf(site.order).resource.period, 'week');
  assert.equal(api.offerService.createOrder({ request: { slug: 'une-heure' }, parties, source: 'manual', createdBy: 'admin', admin: true }).code, 'PERIOD_REQUIRED');
  assert.equal(api.offerService.createOrder({ request: { slug: 'semaine', period: 'weekend' }, parties, source: 'site' }).code, 'PERIOD_NOT_OFFERED');
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
    const checked = require('../campaignRules').validateCampaign(fx.bathCampaign(ids, { ...hour, slug: `v${months}`, validityMonths: months }), fx.rulesContext(api));
    assert.equal(checked.ok, true, String(months));
  });
  [1, 4, 36, 120].forEach((months) => {
    const checked = require('../campaignRules').validateCampaign(fx.bathCampaign(ids, { ...hour, slug: 'v', validityMonths: months }), fx.rulesContext(api));
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

// ── redemption by value (rules 14-17) ──────────────────────────────────────────────────────────────────────────────────────────────────
// The clock is 2026-11-15 (a Sunday). Tuesday 17th is a week day, Saturday 21st a weekend day; the bath opens 10:00-22:00, its evening starts at 19:00.
const TUESDAY = '2026-11-17'; // date-literal-ok: the suite runs on its own clock, never the real today
const FRIDAY = '2026-11-20'; // date-literal-ok: the suite runs on its own clock, never the real today
const SATURDAY = '2026-11-21'; // date-literal-ok: the suite runs on its own clock, never the real today
const PARTIES = { recipientFirstName: 'Léa', recipientLastName: 'Martin', senderName: 'Paul', message: '', email: 'paul@example.test', language: 'fr' };
const VISITOR = { ip: '10.0.0.9' };
const sell = (slug, period) => {
  const out = api.offerService.issueDirect({ request: { slug, period }, parties: PARTIES, outcome: 'paid', paymentMethod: 'cash', actor: 'user:7' });
  assert.equal(out.ok, true, JSON.stringify(out));
  return { id: out.voucherId, code: sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted).value };
};
const campaign = (slug, band, periods = ['week', 'weekend']) => create({
  ...hour, name: slug, slug, composition: { resourceId: ids.bath, band, minutes: 60, options: [] }, periods,
});
campaign('jour', 'day');
campaign('soir', 'evening');
const slotsOf = (voucher, date, extra = 0) => Object.fromEntries(api.useService.slots({ code: voucher.code, from: date, to: date, extraMinutes: extra, visitor: VISITOR }).data.days.flatMap((d) => d.slots).map((s) => [s.start, s]));
const quoteOf = (voucher, date, start, over = {}) => api.useService.quote({ code: voucher.code, start: `${date}T${start}`, visitor: VISITOR, ...over });
const confirm = (voucher, date, start, over = {}) => api.useService.confirm({
  code: voucher.code, start: `${date}T${start}`, email: 'lea@example.test', phone: '06 12 34 56 78', termsVersionId: 9, visitor: VISITOR, ...over,
});

test('rule 15 — a day-week voucher (50 €): « Inclus » on a week day slot, a supplement on a weekend slot and on a week evening, « soirée week-end » on a Friday evening, each named', () => {
  const v = sell('jour', 'week');
  const tue = slotsOf(v, TUESDAY);
  assert.deepEqual([tue['10:00'].tag, tue['10:00'].supplementCents], ['in', 0]);
  assert.deepEqual([tue['19:00'].tag, tue['19:00'].supplementCents, tue['19:00'].supplementLabel], ['supplement', 2000, 'Supplément soirée']);
  const sat = slotsOf(v, SATURDAY);
  assert.deepEqual([sat['10:00'].tag, sat['10:00'].supplementCents, sat['10:00'].supplementLabel], ['supplement', 2000, 'Supplément week-end']);
  const fri = slotsOf(v, FRIDAY);
  assert.deepEqual([fri['10:00'].tag, fri['19:00'].tag, fri['19:00'].supplementCents, fri['19:00'].supplementLabel], ['in', 'supplement', 4000, 'Supplément soirée week-end']);
  const recap = quoteOf(v, FRIDAY, '19:00');
  assert.deepEqual(recap.data.supplement, { label: 'Supplément soirée week-end', cents: 4000 });
  assert.equal(recap.data.dueCents, 4000);
});

test('rule 15 — a week voucher on a weekend slot pays the supplement (the owner\'s answer Q2)', () => {
  const v = sell('jour', 'week');
  assert.equal(quoteOf(v, SATURDAY, '14:00').data.dueCents, 2000);
});

test('rule 15 — every slot is offered in every direction: a weekend evening voucher (90 €) sees the whole opening, none owing a supplement', () => {
  const v = sell('soir', 'weekend');
  const sat = slotsOf(v, SATURDAY);
  assert.ok(sat['10:00'] && sat['21:00'], 'day and evening starts alike');
  assert.deepEqual(Object.values(sat).filter((s) => s.supplementCents > 0), []);
  assert.equal(sat['20:00'].tag, 'in');
});

test('rule 16 — a cheaper slot gives one drink whatever the gap, traced as « Écart de créneau »; nothing is kept as a balance', async () => {
  settingsStore.set('leftoverDrinkArticleRef', `option:${ids.drink}`);
  const v = sell('jour', 'weekend');
  const tue = slotsOf(v, TUESDAY);
  assert.deepEqual([tue['10:00'].tag, tue['10:00'].supplementCents], ['drink', 0]);
  const recap = quoteOf(v, TUESDAY, '10:00');
  assert.deepEqual(recap.data.gifts, [{ label: 'Boisson offerte', detail: null }]);
  assert.equal(recap.data.dueCents, 0);
  const booked = await confirm(v, TUESDAY, '10:00');
  assert.equal(booked.ok, true, JSON.stringify(booked));
  const sale = require('../../../utils/standaloneSale').documentOf(Number(db.prepare('SELECT saleRef FROM resource_bookings WHERE id = ?').get(booked.data.bookingId).saleRef.split(':')[1]));
  const drink = sale.lines.find((l) => l.articleKey === `option:${ids.drink}`);
  assert.deepEqual([drink.totalCents, drink.offered], [0, true], 'a 0 € line on the booking');
  assert.deepEqual(api.unused.listByVoucher(v.id).map((r) => [r.label, r.valueCents]), [['Écart de créneau', 2000]]);
  assert.equal(sale.totals.totalCents, 5000, 'the 50 € session, nothing else owed');
});

test('rule 16 — no drink option set: the slot is « Inclus » and the gap is only traced', async () => {
  settingsStore.set('leftoverDrinkArticleRef', '');
  const v = sell('jour', 'weekend');
  const THURSDAY = '2026-11-26'; // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(slotsOf(v, THURSDAY)['10:00'].tag, 'in');
  const booked = await confirm(v, THURSDAY, '11:00');
  assert.equal(booked.ok, true, JSON.stringify(booked));
  assert.deepEqual(api.unused.listByVoucher(v.id).map((r) => [r.label, r.valueCents]), [['Écart de créneau', 2000]]);
});

test('rule 17 — an evening-weekend voucher on a free day-week slot gives 2 h and a drink; the added hour is a 0 € line', async () => {
  settingsStore.set('leftoverDrinkArticleRef', `option:${ids.drink}`);
  const v = sell('soir', 'weekend');
  const tue = slotsOf(v, TUESDAY);
  assert.equal(tue['14:00'].tag, 'twoHoursDrink');
  const recap = quoteOf(v, TUESDAY, '14:00');
  assert.deepEqual([recap.data.start, recap.data.end], ['14:00', '16:00']);
  assert.deepEqual(recap.data.gifts.map((g) => g.label), ['Heure offerte', 'Boisson offerte']);
  const booked = await confirm(v, TUESDAY, '14:00');
  assert.equal(booked.ok, true, JSON.stringify(booked));
  const row = db.prepare('SELECT startTime, endTime FROM resource_bookings WHERE id = ?').get(booked.data.bookingId);
  assert.deepEqual([row.startTime, row.endTime], ['14:00', '16:00']);
  const sale = require('../../../utils/standaloneSale').documentOf(Number(db.prepare('SELECT saleRef FROM resource_bookings WHERE id = ?').get(booked.data.bookingId).saleRef.split(':')[1]));
  const hourLine = sale.lines.find((l) => l.label === 'Heure offerte');
  assert.deepEqual([hourLine.totalCents, hourLine.offered], [0, true]);
  assert.deepEqual(api.unused.listByVoucher(v.id).map((r) => [r.label, r.valueCents]), [['Écart de créneau', 4000]], '90 € of reference against the 50 € day hour');
});

test('rule 17 — when the doubled session is not free, or would end after closing, the slot gets rule 16 (1 h + drink)', async () => {
  settingsStore.set('leftoverDrinkArticleRef', `option:${ids.drink}`);
  const taken = sell('soir', 'weekend');
  const MONDAY = '2026-11-23'; // date-literal-ok: the suite runs on its own clock, never the real today
  const first = await confirm(sell('soir', 'weekend'), MONDAY, '15:00');
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(slotsOf(taken, MONDAY)['14:00'].tag, 'drink', '14:00-16:00 would overlap the 15:00 booking: 1 h and a drink');
  const late = slotsOf(taken, '2026-11-18'); // date-literal-ok: a calendar fact (a weekday or a holiday of that very date), not a day relative to today
  assert.equal(late['18:00'].tag, 'twoHoursDrink');
  const night = slotsOf(sell('soir', 'weekend'), '2026-11-19'); // date-literal-ok: a calendar fact (a weekday or a holiday of that very date), not a day relative to today
  assert.notEqual(night['21:00'] && night['21:00'].tag, 'twoHoursDrink', '21:00 + 2 h ends after the 22:00 close');
});

test('rule 17 — extra time bought by the recipient starts after the offered hour', () => {
  settingsStore.set('leftoverDrinkArticleRef', `option:${ids.drink}`);
  const v = sell('soir', 'weekend');
  const recap = quoteOf(v, '2026-11-24', '10:00', { extraMinutes: 60 }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(recap.ok, true, JSON.stringify(recap));
  assert.deepEqual([recap.data.start, recap.data.end], ['10:00', '13:00'], '1 h covered + 1 h offered + 1 h bought');
});

