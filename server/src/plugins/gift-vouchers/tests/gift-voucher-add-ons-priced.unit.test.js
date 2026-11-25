// specs/gift-voucher-campaigns.md rule 64 — what can be added to a voucher is priced by the server: each add-on of the offer (and of « Utiliser un bon ») carries its unit label,
// whether its price is linear and the price of every quantity; the extra time carries the price of every step; the price request answers `extrasCents`. Every figure is the
// engine's, the one the price request answers for the same choice, so a page reads it and multiplies nothing.
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
const { api } = fx.openShop({ resources: () => offerOfBath.offer });
const insert = (over) => {
  const checked = campaignRules.validateCampaign(fx.bathCampaign(ids, over), fx.rulesContext(api));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return api.campaigns.find(api.campaigns.insert(checked.value));
};
const bath = insert({ addOns: [`option:${ids.drink}`] });
const offered = async (slug) => (await api.offerService.offer()).campaigns.find((c) => c.slug === slug);

test('rule 64 — every add-on carries its unit label, its linearity and one price per quantity, each the add-on line of the price request for that quantity', async () => {
  const view = await offered(bath.slug);
  const drink = view.addOns.find((a) => a.articleRef === `option:${ids.drink}`);
  assert.deepEqual([view.addOns.length, drink.unitLabel, drink.linear], [1, 'l’unité', true]);
  [drink].forEach((addOn) => {
    assert.equal(addOn.prices.length, addOn.maxQty, 'one price per quantity, 1 … maxQty');
    addOn.prices.forEach(({ qty, cents }, index) => {
      assert.equal(qty, index + 1);
      const answer = api.offerService.price({ slug: bath.slug, addOns: [{ articleRef: addOn.articleRef, qty }] });
      assert.equal(cents, answer.lines.find((l) => l.kind === 'addOn').totalCents, `quantity ${qty}`);
    });
  });
  assert.equal(drink.prices[0].cents, 650);
});

test('rule 64 — the extra time carries one price per step up to its maximum, each the extra line of the price request, the ranks continuing after the included minutes', async () => {
  const { extraTime } = await offered(bath.slug);
  assert.deepEqual(extraTime.prices.map((p) => p.minutes), [60, 120]);
  extraTime.prices.forEach(({ minutes, cents }) => {
    const answer = api.offerService.price({ slug: bath.slug, extraMinutes: minutes });
    assert.equal(cents, answer.lines.find((l) => l.kind === 'extra').totalCents, `${minutes} min`);
  });
  assert.deepEqual(extraTime.prices.map((p) => p.cents), [4500, 9000]);
});

test('rule 64 — the price request answers extrasCents: the extra time and the add-ons, nothing of the session or the included options', () => {
  const none = api.offerService.price({ slug: bath.slug });
  assert.equal(none.extrasCents, 0);
  const both = api.offerService.price({ slug: bath.slug, extraMinutes: 60, addOns: [{ articleRef: `option:${ids.drink}`, qty: 2 }] });
  assert.equal(both.extrasCents, 4500 + 1300);
  assert.equal(both.totalCents - none.totalCents, both.extrasCents);
});

test('rule 64 — a campaign with no extra time offers none and no price table for it', async () => {
  const plain = insert({ name: 'Sans rallonge', slug: 'sans-rallonge', extraTimeMaxMinutes: 0, addOns: [] });
  const view = await offered(plain.slug);
  assert.deepEqual([view.extraTime, view.addOns], [null, []]);
});

test('rule 64 — « Utiliser un bon » reads the same figures: the add-ons not held yet and the extra-time steps, priced as the offer prices them', async () => {
  const out = api.offerService.issueDirect({
    request: { slug: bath.slug },
    parties: { recipientName: '', senderName: 'Paul', message: '', email: '', language: 'fr' },
    outcome: 'paid',
    paymentMethod: 'cash',
    actor: 'user:7',
  });
  assert.equal(out.ok, true);
  const code = sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted).value;
  const { ok, data } = api.useService.open({ code, visitor: { ip: '10.0.0.9' } });
  assert.equal(ok, true);
  const view = await offered(bath.slug);
  assert.deepEqual(data.addOns, view.addOns);
  assert.deepEqual(data.extraTime.prices.slice(0, view.extraTime.prices.length), view.extraTime.prices, 'the steps the campaign offers are priced as the offer prices them');
  assert.equal(data.extraTime.stepMinutes, view.extraTime.stepMinutes);
});

test('rule 64 — the unit label follows the price family, only a progressive per participant is not linear, and a step the engine cannot price drops itself and the following ones', () => {
  const { createExtrasPricing } = require('../extrasPricing');
  const types = { a: 'per_person', b: 'per_participant_progressive', c: 'per_unit' };
  const engine = {
    quote: ({ lines }) => (lines[0].quantity > 3
      ? { status: 200, refusals: [{ message: 'no' }], document: { lines: [] } }
      : { status: 200, refusals: [], document: { lines: [{ totalCents: 100 * lines[0].quantity }] } }),
  };
  const pricing = createExtrasPricing({ engine, catalogue: { element: (ref) => ({ priceType: types[ref] }) } });
  assert.deepEqual(['a', 'b', 'c'].map((ref) => { const r = pricing.addOn(ref, 5); return [r.unitLabel, r.linear]; }), [['par personne', true], ['par personne', false], ['l’unité', true]]);
  assert.deepEqual(pricing.addOn('a', 5).prices, [{ qty: 1, cents: 100 }, { qty: 2, cents: 200 }, { qty: 3, cents: 300 }]);
});

test('rule 64 — an add-on the engine cannot sell outside a stay is not offered, as the price request would refuse it', async () => {
  const view = await offered(insert({ name: 'Avec peignoir', slug: 'avec-peignoir', addOns: [`option:${ids.drink}`, `option:${ids.perPerson}`] }).slug);
  assert.deepEqual(view.addOns.map((a) => a.articleRef), [`option:${ids.drink}`]);
});

// ── « Utiliser un bon »: the extra time keeps the slot duration's steps (rule 27), priced like the offer, then at the chosen start (rule 64) ──────────────────────────────────

const MONDAY = '2026-11-16'; // date-literal-ok: the suite runs on its own clock, never the real today
const day = (n) => new Date(Date.parse(`${MONDAY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const VISITOR = { ip: '10.0.0.9' };
const issueAndCode = (request) => {
  const out = api.offerService.issueDirect({
    request, parties: { recipientName: '', senderName: 'Paul', message: '', email: '', language: 'fr' }, outcome: 'paid', paymentMethod: 'cash', actor: 'user:7',
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  return sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted).value;
};

test('rule 64 — « Utiliser un bon » offers the extra time by the resource’s slot step, with no maximum, even for a one-shot voucher and a campaign that offers none', () => {
  const oneShot = issueAndCode({ composition: { resourceId: ids.bath, band: 'day', minutes: 120, options: [] } });
  const none = insert({ name: 'Sans rallonge 2', slug: 'sans-rallonge-2', extraTimeMaxMinutes: 0, addOns: [] });
  const noExtra = issueAndCode({ slug: none.slug });
  [oneShot, noExtra].forEach((code) => {
    const { data } = api.useService.open({ code, visitor: VISITOR });
    assert.equal(data.extraTime.stepMinutes, 60);
    assert.equal('maxMinutes' in data.extraTime, false, 'the close time is judged at each slot, not here');
    const { prices } = data.extraTime;
    assert.deepEqual(prices.map((p) => p.minutes), [60, 120, 180, 240, 300, 360, 420, 480, 540, 600], 'every step up to the closing time (22:00) from the band’s start (10:00), past the campaign’s own maximum');
    assert.deepEqual(prices.slice(0, 2), [{ minutes: 60, cents: 4500 }, { minutes: 120, cents: 9000 }]);
    assert.deepEqual(prices.filter((p) => p.cents === null).map((p) => p.minutes), [480, 540, 600], 'past the day band’s end the dateless pricing cannot price: the slot’s own quote does');
    assert.equal(prices.slice(0, 7).every((p) => Number.isInteger(p.cents)), true);
  });
});

test('rule 64 — the use recap answers the extra-time steps priced at the chosen start: each equals the recap’s extra line for that time, an evening start included', () => {
  const code = issueAndCode({ slug: bath.slug });
  [`${day(0)}T10:00`, `${day(0)}T18:00`].forEach((start) => {
    const base = api.useService.quote({ code, start, visitor: VISITOR });
    assert.equal(base.ok, true, JSON.stringify(base));
    const steps = base.data.extraTimePrices;
    assert.equal(steps.length > 0, true);
    steps.forEach(({ minutes, cents }) => {
      const quoted = api.useService.quote({ code, start, extraMinutes: minutes, visitor: VISITOR });
      assert.equal(quoted.ok, true, `${start} +${minutes} min: ${JSON.stringify(quoted)}`);
      assert.equal(cents, quoted.data.extras.find((e) => e.label.startsWith('Temps supplémentaire')).cents, `${start} +${minutes} min`);
    });
  });
  const evening = api.useService.quote({ code, start: `${day(0)}T18:00`, visitor: VISITOR }).data.extraTimePrices;
  const morning = api.useService.quote({ code, start: `${day(0)}T10:00`, visitor: VISITOR }).data.extraTimePrices;
  assert.notEqual(evening[0].cents, morning[0].cents, 'the evening rate differs from the offer’s day rate: the fold must read this figure');
});
