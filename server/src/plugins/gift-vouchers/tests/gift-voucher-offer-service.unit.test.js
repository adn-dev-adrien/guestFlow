// specs/gift-vouchers/gift-voucher-campaigns.md rules 5, 16, 17, 41, 46, 52 — the one path of the sale: the offer and the price are built by `offerService`, and the site's routes and the
// operator's routes only wrap it. The same request gets the same payload and the same price on both sides; a one-shot composition takes the same path; what the
// giver reads is generic French built on the server — hours read from the resource, nothing computed by a client.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const campaignRules = require('../campaignRules');

const ids = fx.seedCatalogue();
const { api } = fx.openShop();
const add = (over) => api.campaigns.find(api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids, over), fx.rulesContext(api)).value));
const bath = add();
add({
  name: 'Bain soirée', title: 'Un bain du soir', slug: 'bain-soir', composition: { resourceId: ids.bath, band: 'evening', minutes: 60, options: [] }, addOns: [], extraTimeMaxMinutes: 0,
});
add({ name: 'Brouillon', slug: 'brouillon', state: 'draft' });

test('the offer lists the campaigns on sale only, each with its title, its band hours read from the resource, its contents, its add-ons and its extra time', async () => {
  const { campaigns } = await api.offerService.offer();
  assert.deepEqual(campaigns.map((c) => [c.slug, c.kind]), [['sejour', 'lodging'], ['bain-jour', 'resource'], ['bain-soir', 'resource']]);
  const day = campaigns.find((c) => c.slug === 'bain-jour');
  assert.deepEqual(day, {
    slug: 'bain-jour',
    kind: 'resource',
    title: 'Un bain nordique',
    validityMonths: 12,
    band: {
      key: 'day', label: 'journée', from: '10:00', to: '19:00',
    },
    contents: [
      { kind: 'session', label: 'Bain nordique', detail: '2 h en journée · semaine · de 10:00 à 19:00', qty: 1 },
      { kind: 'option', label: 'Planche apéro', detail: null, qty: 1 },
    ],
    addOns: [{
      articleRef: `option:${ids.drink}`, label: 'Boisson', maxQty: 20, unitLabel: 'l’unité', linear: true, prices: Array.from({ length: 20 }, (_, i) => ({ qty: i + 1, cents: (i + 1) * 650 })),
    }],
    periods: [{ period: 'week', priceCents: 10900, label: 'semaine' }],
    extraTime: {
      maxMinutes: 120, stepMinutes: 60, prices: [{ minutes: 60, cents: 4500 }, { minutes: 120, cents: 9000 }], pricesByPeriod: { week: [{ minutes: 60, cents: 4500 }, { minutes: 120, cents: 9000 }] },
    },
    totalCents: 10900,
  });
  const night = campaigns.find((c) => c.slug === 'bain-soir');
  assert.deepEqual([night.band, night.extraTime, night.addOns, night.totalCents], [{
    key: 'evening', label: 'soirée', from: '19:00', to: '22:00',
  }, null, [], 7000]);
});

test('the lodging campaign keeps the shape the site’s block reads: its bounds, validity and ideas at the top level too', async () => {
  const offer = await api.offerService.offer();
  assert.deepEqual([offer.minAmountCents, offer.maxAmountCents, offer.validityMonths, offer.ideas], [2000, 200000, 18, []]);
  assert.deepEqual(offer.campaigns[0], {
    slug: 'sejour', kind: 'lodging', title: 'Bon cadeau', validityMonths: 18, minAmountCents: 2000, maxAmountCents: 200000, ideas: [],
  });
  assert.equal(offer.omitted, undefined, 'the omitted campaigns are the operator’s to read');
});

test('public and admin routes return the same payload and the same price for the same request', async () => {
  const server = await fx.serve(api);
  try {
    const site = (method, path, body) => server.call(method, `/public/v1/gift-vouchers${path}`, body, { 'x-test-ip': '10.0.0.1' });
    const admin = (method, path, body) => server.call(method, `/api/gift-vouchers${path}`, body);
    const publicOffer = (await site('GET', '/offer')).body.data;
    const adminOffer = (await admin('GET', '/offer')).body;
    assert.deepEqual(adminOffer.omitted, []);
    const { omitted, paymentMethods, ...adminPayload } = adminOffer;
    assert.deepEqual(paymentMethods.map((m) => m.value), ['card', 'cash', 'transfer'], 'what only the operator needs: the means of « Payé »');
    const {
      available, brand, termsVersionId, termsVersion, back: _back, ...publicPayload
    } = publicOffer;
    assert.deepEqual([available, brand, termsVersionId, termsVersion], [true, 'Domaine Solio', 4, 1], 'what only the site needs: the terms id it sends back and the number its link shows');
    assert.deepEqual(publicPayload.campaigns.map((c) => [c.slug, c.termsVersionId]), [['sejour', 4], ['bain-jour', 9], ['bain-soir', 9]], 'each campaign names the terms its purchase accepts (rule 37)');
    assert.deepEqual(publicPayload.campaigns.map((c) => [c.slug, c.visual ? c.visual.width : null]), [['sejour', null], ['bain-jour', 720], ['bain-soir', 720]], 'and the front the site shows, when the campaign has one (rule 62)');
    assert.deepEqual({ ...publicPayload, campaigns: publicPayload.campaigns.map(({ termsVersionId: _terms, termsVersion: _number, visual: _front, back: _cardBack, ...rest }) => rest) }, adminPayload);
    const request = { slug: 'bain-jour', extraMinutes: 60, addOns: [{ articleRef: `option:${ids.drink}`, qty: 2 }] };
    const sitePrice = (await site('POST', '/offer/price', request)).body.data;
    const adminPrice = (await admin('POST', '/offer/price', request)).body;
    assert.equal(sitePrice.totalCents, 9500 + 4500 + 1400 + 1300);
    assert.deepEqual({ lines: adminPrice.lines, totalCents: adminPrice.totalCents, extrasCents: adminPrice.extrasCents, vat: adminPrice.vat }, sitePrice);
    assert.equal(sitePrice.extrasCents, 4500 + 1300, 'rule 64: the extra time and the add-ons, summed by the server');
    assert.deepEqual(sitePrice, (({
      lines, totalCents, extrasCents, vat,
    }) => ({
      lines, totalCents, extrasCents, vat,
    }))(api.offerService.price(request)), 'and the service’s own answer');
    const lodging = { slug: 'sejour', amountCents: 15000 };
    const siteLodging = (await site('POST', '/offer/price', lodging)).body.data;
    const adminLodging = (await admin('POST', '/offer/price', lodging)).body;
    assert.deepEqual({ lines: adminLodging.lines, totalCents: adminLodging.totalCents, extrasCents: adminLodging.extrasCents, vat: adminLodging.vat }, siteLodging);
    assert.deepEqual([siteLodging.totalCents, siteLodging.vat], [15000, [{ rate: 10, cents: 1364 }]]);
  } finally {
    await server.close();
  }
});

test('a lodging voucher is priced by the same service: the amount inside the campaign’s bounds, the VAT cut at the campaign’s rate', () => {
  const answer = api.offerService.price({ slug: 'sejour', amountCents: 15000 });
  assert.deepEqual(answer.lines, [{
    kind: 'amount', label: 'Bon cadeau', detail: null, qty: 1, unitCents: 15000, totalCents: 15000, vatRate: 10,
  }]);
  assert.deepEqual([answer.totalCents, answer.vat, answer.kind], [15000, [{ rate: 10, cents: 1364 }], 'lodging']);
  assert.equal(api.offerService.price({ slug: 'sejour', amountCents: 1999 }).code, 'VOUCHER_AMOUNT_OUT_OF_BOUNDS');
  assert.equal(api.offerService.price({ slug: 'sejour', amountCents: '15000' }).code, 'AMOUNT_INVALID');
  assert.equal(api.offerService.price({ amountCents: 15000 }).ok, true, 'no slug: the lodging voucher the site has always sold');
});

test('a draft or closed campaign is not for sale, to the giver or by slug; the operator’s default lodging campaign needs no state', () => {
  assert.equal(api.offerService.price({ slug: 'brouillon' }).code, 'CAMPAIGN_CLOSED');
  assert.equal(api.offerService.price({ slug: 'nope' }).code, 'CAMPAIGN_UNKNOWN');
  const lodging = api.campaigns.firstLodging();
  api.campaigns.update(lodging.id, { ...lodging, state: 'draft' });
  assert.equal(api.offerService.price({ amountCents: 15000 }).code, 'CAMPAIGN_UNKNOWN', 'the site has no lodging campaign on sale');
  assert.equal(api.offerService.price({ amountCents: 15000 }, { admin: true }).ok, true, 'the operator may still sell one by hand');
  api.campaigns.update(lodging.id, { ...lodging, state: 'on_sale' });
});

test('a one-shot composition takes the same path as a campaign: same price as the campaign it equals, same lines, nothing stored by the price', () => {
  const composition = { resourceId: ids.bath, band: 'day', minutes: 120, options: [{ articleRef: `option:${ids.board}`, qty: 1 }] };
  const before = api.campaigns.list().length;
  const oneShot = api.offerService.price({
    composition, extraTimeMaxMinutes: 120, offeredAddOns: [`option:${ids.drink}`], extraMinutes: 60, addOns: [{ articleRef: `option:${ids.drink}`, qty: 1 }],
  }, { admin: true });
  const campaign = api.offerService.price({ slug: 'bain-jour', extraMinutes: 60, addOns: [{ articleRef: `option:${ids.drink}`, qty: 1 }] });
  assert.equal(oneShot.ok, true);
  assert.deepEqual([oneShot.lines, oneShot.totalCents, oneShot.vat], [campaign.lines, campaign.totalCents, campaign.vat]);
  assert.equal(oneShot.title, 'Bon sur mesure');
  assert.equal(api.campaigns.list().length, before);
  assert.equal(api.offerService.price({ composition }).code, 'CAMPAIGN_UNKNOWN', 'only the operator composes');
  assert.equal(api.offerService.price({ composition: { ...composition, minutes: 45 } }, { admin: true }).code, 'COMPOSITION_INVALID');
});

test('the parties of an order are judged once, for both sides: texts, language, e-mail — a link needs the e-mail', () => {
  const parties = (body, emailRequired = false) => api.offerService.partiesOf({ recipientFirstName: 'Marie', recipientLastName: 'Durand', ...body }, { emailRequired });
  assert.deepEqual(parties({ recipientFirstName: ' Marie ', senderName: 'Paul', email: ' paul@example.test ' }).value, {
    recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', message: '', email: 'paul@example.test', language: 'fr',
  });
  assert.equal(parties({ language: 'en' }).value.language, 'en');
  assert.deepEqual(parties({}, true), { ok: false, code: 'EMAIL_INVALID' });
  assert.deepEqual(parties({ email: 'x' }), { ok: false, code: 'EMAIL_INVALID' });
  assert.deepEqual(parties({ email: ['a@b.test'] }), { ok: false, code: 'EMAIL_INVALID' });
  assert.deepEqual(parties({ senderName: 'x'.repeat(41) }), { ok: false, code: 'FIELD_INVALID' });
  assert.deepEqual(parties({ message: 'x'.repeat(201) }), { ok: false, code: 'FIELD_INVALID' });
  assert.deepEqual(parties({ language: 'de' }), { ok: false, code: 'FIELD_INVALID' });
  assert.deepEqual(parties({ recipientFirstName: 12 }), { ok: false, code: 'FIELD_INVALID', field: 'recipientFirstName' });
});
