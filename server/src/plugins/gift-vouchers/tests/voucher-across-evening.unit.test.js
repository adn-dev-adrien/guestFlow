// specs/site/site-outside-resource-booking.md rules 9-10, 14 — a voucher settles what it covers at the band it was sold for, and every hour beyond it is due at the band it falls in: a
// « 1 h journée » voucher placed at 19:00 for 2 h leaves the 20:00–21:00 hour due at the evening following-hour rate; placed at 20:00 for 1 h it leaves the evening supplement. The slots of
// « Mon bain » say it per start (`dueCents`, `evening`), the recap and the booking agree, and the visitor who tells his people and his name is heard (rule 4).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const sdk = require('../../sdk');
const campaignRules = require('../campaignRules');
const use = require('./useFixture');

const ids = fx.seedCatalogue();
// The evening switch at 20:00: the day band runs from 10:00 to 20:00, the evening one to 22:00.
const bath = fx.resource({ name: 'Bain du soir', hourlyEveningStart: '20:00' });
const offerOfBath = use.bookingOffer();
const links = use.paymentLinks();
const shop = fx.openShop({ resources: () => offerOfBath.offer, payments: links.payments });
const { api } = shop;
const VISITOR = { ip: '10.0.0.9' };
api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids, {
  name: 'Une heure', title: 'Une heure de bain', slug: 'une-heure', composition: { resourceId: bath, band: 'day', minutes: 60, options: [] }, addOns: [], extraTimeMaxMinutes: 120,
}), fx.rulesContext(api)).value);

// The same bath on a half-hour grid: a 1 h session may then start at 19:30 and run into the evening.
const halfBath = fx.resource({ name: 'Bain demi-heure', hourlyEveningStart: '20:00', slotDuration: 30 });
api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids, {
  name: 'Demi-heure', title: 'Une heure de bain, au quart d’heure', slug: 'demi-heure', composition: { resourceId: halfBath, band: 'day', minutes: 60, options: [] }, addOns: [], extraTimeMaxMinutes: 120,
}), fx.rulesContext(api)).value);

const DAY = '2026-11-16'; // date-literal-ok: the suite runs on its own clock, never the real today
const voucherOf = (slug) => {
  const out = api.offerService.issueDirect({
    request: { slug }, parties: { recipientName: 'Léa', senderName: 'Paul', message: '', email: '', language: 'fr' }, outcome: 'paid', paymentMethod: 'cash', actor: 'user:7',
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  return { id: out.voucherId, code: sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted).value };
};
const voucher = () => voucherOf('une-heure');
const slots = (v, extraMinutes) => Object.fromEntries(api.useService.slots({
  code: v.code, from: DAY, to: DAY, extraMinutes, visitor: VISITOR,
}).data.days[0].slots.map((s) => [s.start, s]));

test('rule 10 — an hour of a 1 h day voucher inside the day band is wholly included; one that runs into the evening leaves the evening supplement due', () => {
  const v = voucher();
  const free = slots(v, 0);
  assert.deepEqual([free['10:00'].dueCents, free['10:00'].evening], [0, false]);
  assert.deepEqual([free['19:00'].dueCents, free['19:00'].evening], [0, false], '19:00–20:00 is still the day band');
  assert.equal(free['20:00'], undefined, 'a day voucher is offered the starts of the day band only');
  const half = voucherOf('demi-heure');
  const halves = slots(half, 0);
  assert.deepEqual([halves['19:00'].dueCents, halves['19:00'].evening], [0, false]);
  assert.deepEqual([halves['19:30'].dueCents, halves['19:30'].evening], [1000, true], 'half an hour of day at 25 €, then half an hour of evening at 35 € (still the first hour): 10 € above the 50 € covered');
  const recap = api.useService.quote({ code: half.code, start: `${DAY}T19:30`, visitor: VISITOR });
  assert.deepEqual([recap.data.supplement, recap.data.dueCents], [{ label: 'Supplément soirée', cents: 1000 }, 1000]);
});

test('rules 9-10 — placed at 19:00 for 2 h, the second hour is due at the evening following-hour rate', () => {
  const v = voucher();
  const two = slots(v, 60);
  assert.deepEqual([two['19:00'].dueCents, two['19:00'].evening], [6300, true]);
  assert.deepEqual([two['10:00'].dueCents, two['10:00'].evening], [4500, false], 'two day hours: the second at the following-hour day rate');
  assert.deepEqual([two['18:00'].dueCents, two['18:00'].evening], [4500, false], '18:00–19:00 covered, 19:00–20:00 still day band');
  const recap = api.useService.quote({ code: v.code, start: `${DAY}T19:00`, extraMinutes: 60, visitor: VISITOR });
  assert.equal(recap.data.dueCents, 6300);
  assert.deepEqual(recap.data.extras.map((e) => [e.label, e.cents]), [['Temps supplémentaire · 1 h', 6300]]);
});

test('rules 4, 14 — the confirmation takes a first name, a last name and the people, and the booking keeps them', async () => {
  const v = voucher();
  const booked = await api.useService.confirm({
    code: v.code, start: `${DAY}T12:00`, email: 'lea@example.test', phone: '06 12 34 56 78', firstName: 'Léa', lastName: 'Martin', people: 4, termsVersionId: 9, visitor: VISITOR,
  });
  assert.deepEqual(booked.data.booked, true);
  const row = offerOfBath.bookings.rawById(booked.data.bookingId);
  assert.deepEqual([row.clientName, row.people], ['Léa Martin', 4]);
  assert.match(shop.sent.at(-1).text, /pour 4 personnes/);
  assert.deepEqual((await api.useService.confirm({
    code: voucher().code, start: `${DAY}T14:00`, email: 'lea@example.test', phone: '06 12 34 56 78', people: 0, termsVersionId: 9, visitor: VISITOR,
  })).code, 'PEOPLE_INVALID');
  const older = voucher();
  const legacy = await api.useService.confirm({
    code: older.code, start: `${DAY}T16:00`, email: 'lea@example.test', phone: '06 12 34 56 78', name: 'Paul Durand', termsVersionId: 9, visitor: VISITOR,
  });
  assert.equal(offerOfBath.bookings.rawById(legacy.data.bookingId).clientName, 'Paul Durand', 'a connector that still sends `name` keeps working');
  assert.equal(offerOfBath.bookings.rawById(legacy.data.bookingId).people, null);
});
