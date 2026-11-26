// specs/site-outside-resource-booking.md rule 30 — the session page builds no line of its own: every option and every add-on a voucher holds, with its quantity, is in the opening
// answer's `contents` (drawn at 0 € before any slot) and in the quote's `included` (drawn at 0 € once a slot is chosen).
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
const offerOfBath = use.bookingOffer();
const shop = fx.openShop({ resources: () => offerOfBath.offer, payments: use.paymentLinks().payments });
const { api } = shop;
const VISITOR = { ip: '10.0.0.9' };
api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api)).value);

const DAY = '2026-11-17'; // date-literal-ok: the suite runs on its own clock, never the real today
const issue = (request) => {
  const out = api.offerService.issueDirect({
    request,
    parties: {
      recipientFirstName: 'Léa', recipientLastName: 'Martin', senderName: 'Paul', message: '', email: '', language: 'fr',
    },
    outcome: 'paid',
    paymentMethod: 'cash',
    actor: 'user:7',
    admin: true,
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  return sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted).value;
};

const held = (lines) => lines.filter((l) => l.kind !== 'session').map((l) => [l.label, l.qty]);
const includedHeld = (included) => included.slice(1).map((l) => [l.label, l.qty]);

test('rule 30 — a voucher holding several of an option and an add-on lists each with its quantity in the opening answer and in the quote', () => {
  const code = issue({
    composition: {
      resourceId: ids.bath, band: 'day', minutes: 120, options: [{ articleRef: `option:${ids.board}`, qty: 2 }, { articleRef: `option:${ids.drink}`, qty: 3 }],
    },
  });
  const { data } = api.useService.open({ code, visitor: VISITOR });
  assert.equal(data.contents[0].kind, 'session');
  assert.deepEqual(data.contents.filter((l) => l.kind === 'option').map((l) => l.qty), [2, 3]);
  const quoted = api.useService.quote({ code, start: `${DAY}T10:00`, visitor: VISITOR });
  assert.equal(quoted.ok, true, JSON.stringify(quoted));
  assert.equal(quoted.data.included.length, 1 + data.contents.length - 1);
  assert.deepEqual(includedHeld(quoted.data.included).map(([, qty]) => qty), [2, 3]);
  assert.deepEqual(includedHeld(quoted.data.included), held(data.contents));
});

test('rule 30 — an add-on bought with the campaign’s voucher is held like an option: in `contents` and in `included` with its quantity', () => {
  const code = issue({ slug: 'bain-jour', addOns: [{ articleRef: `option:${ids.drink}`, qty: 2 }] });
  const { data } = api.useService.open({ code, visitor: VISITOR });
  const kinds = data.contents.map((l) => [l.kind, l.qty]);
  assert.deepEqual(kinds, [['session', 1], ['option', 1], ['addOn', 2]]);
  const quoted = api.useService.quote({ code, start: `${DAY}T12:00`, visitor: VISITOR });
  assert.equal(quoted.ok, true, JSON.stringify(quoted));
  assert.deepEqual(includedHeld(quoted.data.included), held(data.contents));
  assert.equal(quoted.data.dueCents, 0);
});
