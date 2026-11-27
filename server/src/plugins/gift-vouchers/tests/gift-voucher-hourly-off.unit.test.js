// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 28 — switching `hourly-resources` off breaks nothing: the voucher plugin keeps answering. Resource campaigns leave the offer with
// their reason, a code still opens, the slots, the recap and the confirmation answer « réservations indisponibles » (409), a remainder paid after the switch is flagged « à rembourser »,
// and the lapse job runs — no call throws.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const use = require('./useFixture');
const sdk = require('../../sdk');
const campaignRules = require('../campaignRules');
const { withdrawHourlyResources, liveHourlyResources } = require('../../../tests/hourlyResourcesFixture');

const ids = fx.seedCatalogue();
const offerOfBath = use.bookingOffer();
const links = use.paymentLinks();
let hookOn = true;
const shop = fx.openShop({ resources: () => (hookOn ? offerOfBath.offer : null), payments: links.payments });
const { api } = shop;
const VISITOR = { ip: '10.0.0.9' };
api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api)).value);
const DAY = '2026-11-17'; // date-literal-ok: the suite runs on its own clock, never the real today
const voucher = (() => {
  const out = api.offerService.issueDirect({
    request: { slug: 'bain-jour' },
    parties: { recipientFirstName: 'L', recipientLastName: 'M', senderName: 'P', message: '', email: '', language: 'fr' },
    outcome: 'paid',
    paymentMethod: 'cash',
    actor: 'user:7',
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  return { code: sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted).value };
})();
const confirm = (start) => api.useService.confirm({
  code: voucher.code, start, email: 'a@b.test', phone: '0612345678', firstName: 'L', lastName: 'M', people: 2, termsVersionId: 9, visitor: VISITOR,
});

test('rule 28 — with hourly-resources off every call of the voucher plugin answers and none throws; a remainder paid afterwards is owed back', async () => {
  const held = await confirm(`${DAY}T19:00`);
  assert.equal(held.ok, true, 'a supplement is due: the slot and the voucher are held while it is paid');
  withdrawHourlyResources();
  hookOn = false;
  try {
    const offer = await api.offerService.offer({ withOmitted: true });
    assert.deepEqual(offer.campaigns.filter((c) => c.kind === 'resource'), [], 'resource campaigns leave the offer');
    assert.equal(offer.omitted.length, 1, 'with the reason the operator reads');
    const opened = api.useService.open({ code: voucher.code, visitor: VISITOR });
    assert.deepEqual([opened.ok, opened.data.kind], [true, 'resource']);
    assert.deepEqual(['slots', 'quote'].map((call) => {
      const answer = call === 'slots'
        ? api.useService.slots({ code: voucher.code, from: DAY, to: DAY, visitor: VISITOR })
        : api.useService.quote({ code: voucher.code, start: `${DAY}T10:00`, visitor: VISITOR });
      return [answer.ok, answer.code];
    }), [[false, 'BOOKING_UNAVAILABLE'], [false, 'BOOKING_UNAVAILABLE']]);
    assert.equal((await confirm(`${DAY}T10:00`)).code, 'BOOKING_UNAVAILABLE');
    const row = shop.db.prepare('SELECT * FROM gift_voucher_uses ORDER BY id DESC LIMIT 1').get();
    const paid = api.useService.paid({ ref: row.id, linkId: row.linkId, amountCents: row.dueCents });
    assert.equal(paid.refundOwed, true);
    assert.doesNotThrow(() => api.useService.lapseDue());
  } finally {
    liveHourlyResources();
    hookOn = true;
  }
});
