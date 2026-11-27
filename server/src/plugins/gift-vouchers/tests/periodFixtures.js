// Shared fixture of the week-weekend redemption suites (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md): the bath resource priced week 50 / 70 €, weekend 70 / 90 €,
// following hours 45 / 63 and 60 / 80, on the booking offer of the resource plugin, a payment provider that remembers its links, and the helpers a suite sells and redeems with.
// The clock is 2026-11-15 (a Sunday). Not a test file: call `setup()` once per suite, after `process.env.DB_PATH` is set.
const assert = require('node:assert/strict');
const fx = require('./campaignFixtures');
const use = require('./useFixture');
const sdk = require('../../sdk');
const campaignRules = require('../campaignRules');
const { memorySettings } = require('..');

const TUESDAY = '2026-11-17'; // date-literal-ok: the suite runs on its own clock, never the real today
const FRIDAY = '2026-11-20'; // date-literal-ok: the suite runs on its own clock, never the real today
const SATURDAY = '2026-11-21'; // date-literal-ok: the suite runs on its own clock, never the real today
const PARTIES = { recipientFirstName: 'Léa', recipientLastName: 'Martin', senderName: 'Paul', message: '', email: 'paul@example.test', language: 'fr' };
const VISITOR = { ip: '10.0.0.9' };

function setup() {
  const ids = fx.seedCatalogue();
  const offerOfBath = use.bookingOffer();
  const links = use.paymentLinks();
  const settingsStore = memorySettings();
  const shop = fx.openShop({ resources: () => offerOfBath.offer, payments: links.payments, settingsStore: () => settingsStore });
  const { api, db, clock } = shop;
  db.prepare('UPDATE resources SET hourlyExternalWeekendDayRate = 70, hourlyExternalWeekendEveningRate = 90, hourlyExternalWeekendNextDayRate = 60, hourlyExternalWeekendNextEveningRate = 80 WHERE id = ?').run(ids.bath);
  const hour = { composition: { resourceId: ids.bath, band: 'day', minutes: 60, options: [] }, addOns: [], extraTimeMaxMinutes: 60 };
  const create = (over) => {
    const checked = campaignRules.validateCampaign(fx.bathCampaign(ids, over), fx.rulesContext(api));
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    return api.campaigns.find(api.campaigns.insert(checked.value));
  };
  const campaign = (slug, band, periods = ['week', 'weekend'], minutes = 60) => create({
    ...hour, name: slug, slug, composition: { resourceId: ids.bath, band, minutes, options: [] }, periods,
  });
  const sell = (slug, period) => {
    const out = api.offerService.issueDirect({ request: { slug, period }, parties: PARTIES, outcome: 'paid', paymentMethod: 'cash', actor: 'user:7' });
    assert.equal(out.ok, true, JSON.stringify(out));
    return { id: out.voucherId, code: sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted).value };
  };
  const slotsOf = (voucher, date, extra = 0) => Object.fromEntries(api.useService.slots({ code: voucher.code, from: date, to: date, extraMinutes: extra, visitor: VISITOR }).data.days.flatMap((d) => d.slots).map((s) => [s.start, s]));
  const quoteOf = (voucher, date, start, over = {}) => api.useService.quote({ code: voucher.code, start: `${date}T${start}`, visitor: VISITOR, ...over });
  const confirm = (voucher, date, start, over = {}) => api.useService.confirm({
    code: voucher.code, start: `${date}T${start}`, email: 'lea@example.test', phone: '06 12 34 56 78', termsVersionId: 9, visitor: VISITOR, ...over,
  });
  const saleOf = (bookingId) => require('../../../utils/standaloneSale').documentOf(Number(db.prepare('SELECT saleRef FROM resource_bookings WHERE id = ?').get(bookingId).saleRef.split(':')[1]));
  return {
    ids, offerOfBath, links, settingsStore, api, db, clock, hour, create, campaign, sell, slotsOf, quoteOf, confirm, saleOf,
  };
}

module.exports = {
  setup, TUESDAY, FRIDAY, SATURDAY, PARTIES, VISITOR,
};
