// specs/gift-vouchers.md rule 14 — the price ideas: always a stay, priced by the server with the website's quote engine over the
// next 12 months, one lowest amount per tariff season or a single « à partir de », cached a day, refreshed on pricing.changed.
const test = require('node:test');
const assert = require('node:assert/strict');

const campaignRules = require('../campaignRules');
const fx = require('./giftVoucherFixtures');
const { termsStub } = require('./termsFixture');

const validate = campaignRules.ideasError;
const boundsOf = (api) => { const c = api.campaigns.firstLodging(); return { minAmountCents: c.minAmountCents, maxAmountCents: c.maxAmountCents }; };
const stay = { label: 'Un week-end', propertyId: 1, nights: 2, guests: 2 };

/** A quote whose season and price depend on the month of arrival: July–August « Haute » 400 €, December « Fêtes » 650 €, else « Basse » 180 €. */
function seasonalQuote(calls = []) {
  return ({ propertyId, startDate, endDate }) => {
    calls.push({ propertyId, startDate, endDate });
    const month = Number(startDate.slice(5, 7));
    const [label, price] = [7, 8].includes(month) ? ['Haute', 400] : (month === 12 ? ['Fêtes', 650] : ['Basse', 180]);
    const nights = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000);
    return {
      totalStayPrice: price + (Number(startDate.slice(8, 10)) % 5), // a different price each day: the lowest wins
      nightlyBreakdown: Array.from({ length: nights }, () => ({ seasonLabel: label })),
      unpricedNights: [],
    };
  };
}

async function withIdeas(over, fn) {
  const fixture = fx.buildApi(undefined, over);
  const server = await fx.start(fixture);
  try {
    await fn({ ...fixture, server });
  } finally {
    await server.close();
  }
}

test('rule 14: an idea is always a stay { label, propertyId, nights, guests } — a bare amount is refused by the campaign', () => {
  assert.equal(validate('[]'), null);
  assert.equal(validate(JSON.stringify([stay])), null);
  assert.equal(validate([stay]), null, 'a list as well as its JSON');
  const refused = (value) => assert.notEqual(validate(typeof value === 'string' ? value : JSON.stringify(value)), null, JSON.stringify(value));
  refused([{ label: 'Un cadeau', amountCents: 15000 }]);
  refused([{ label: 'Un cadeau', amount: 150 }]);
  refused([{ ...stay, amountCents: 15000 }]);
  refused([{ label: '150 €' }]);
  refused([150]);
  refused([null]);
  refused(['150']);
  refused({ label: 'x' });
  refused('not json');
  refused([{ ...stay, propertyId: 0 }]);
  refused([{ ...stay, propertyId: '1' }]);
  refused([{ ...stay, nights: 0 }]);
  refused([{ ...stay, nights: 61 }]);
  refused([{ ...stay, guests: 0 }]);
  refused([{ ...stay, guests: 31 }]);
  refused([{ ...stay, label: '' }]);
  refused([{ ...stay, label: 'x'.repeat(61) }]);
});

test('rule 14: at most six ideas', () => {
  assert.equal(validate(JSON.stringify(Array.from({ length: 6 }, () => stay))), null);
  assert.notEqual(validate(JSON.stringify(Array.from({ length: 7 }, () => stay))), null);
});

test('rule 14: the stored ideas read back as a list; an unreadable value is no idea at all', () => {
  assert.deepEqual(campaignRules.ideasOf(JSON.stringify([stay])), [stay]);
  assert.deepEqual(campaignRules.ideasOf(''), []);
  assert.deepEqual(campaignRules.ideasOf('garbage'), []);
  assert.deepEqual(campaignRules.ideasOf(JSON.stringify([{ label: 'x', amountCents: 5 }])), []);
});

test('rule 14: one lowest amount per tariff season the stay falls in, from the quote engine, over the next 12 months', () => withIdeas({
  settings: { ideas: JSON.stringify([stay]) },
}, async ({ api }) => {
  const calls = [];
  const priced = await require('../ideas').priceIdea(stay, {
    quote: seasonalQuote(calls), today: '2026-11-15', bounds: boundsOf(api), // date-literal-ok: the suite runs on its own clock, never the real today
  });
  assert.deepEqual(priced, {
    label: 'Un week-end',
    amounts: [{ label: 'Basse', amountCents: 18000 }, { label: 'Haute', amountCents: 40000 }, { label: 'Fêtes', amountCents: 65000 }],
  });
  assert.equal(calls[0].startDate, '2026-11-16'); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(calls[calls.length - 1].startDate, '2027-11-15'); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.ok(calls.every((c) => c.propertyId === 1 && Math.round((Date.parse(c.endDate) - Date.parse(c.startDate)) / 86400000) === 2));
}));

test('rule 14: a property with no named season gets a single « À partir de » amount', () => withIdeas({}, async ({ api }) => {
  const flat = () => ({ totalStayPrice: 220, nightlyBreakdown: [{ seasonLabel: 'Standard' }, { seasonLabel: 'Standard' }], unpricedNights: [] });
  const priced = await require('../ideas').priceIdea(stay, { quote: flat, today: '2026-11-15', bounds: boundsOf(api) }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual(priced, { label: 'Un week-end', amounts: [{ label: 'À partir de', amountCents: 22000 }] });
}));

test('rule 14: a stay that straddles two seasons, an unpriced night, a breached rule or a thrown quote prices nothing', () => withIdeas({}, async ({ api }) => {
  const { priceIdea } = require('../ideas');
  const args = (quote) => ({ quote, today: '2026-11-15', bounds: boundsOf(api) }); // date-literal-ok: the suite runs on its own clock, never the real today
  const base = { totalStayPrice: 300, nightlyBreakdown: [{ seasonLabel: 'A' }], unpricedNights: [] };
  assert.equal(await priceIdea(stay, args(() => ({ ...base, nightlyBreakdown: [{ seasonLabel: 'A' }, { seasonLabel: 'B' }] }))), null);
  assert.equal(await priceIdea(stay, args(() => ({ ...base, unpricedNights: ['2027-01-01'] }))), null); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(await priceIdea(stay, args(() => ({ ...base, minNightsBreached: true }))), null);
  assert.equal(await priceIdea(stay, args(() => ({ ...base, maxNightsBreached: true }))), null);
  assert.equal(await priceIdea(stay, args(() => ({ ...base, changeoverBreached: true }))), null);
  assert.equal(await priceIdea(stay, args(() => ({ ...base, totalStayPrice: 0 }))), null);
  assert.equal(await priceIdea(stay, args(() => { throw new Error('no rule'); })), null);
  assert.equal(await priceIdea(stay, args(() => null)), null);
}));

test('rule 14: an amount the form could not accept (below the minimum, above the maximum) is not suggested', () => withIdeas({}, async ({ api }) => {
  const { priceIdea } = require('../ideas');
  const cheap = () => ({ totalStayPrice: 15, nightlyBreakdown: [{ seasonLabel: 'Basse' }], unpricedNights: [] });
  const dear = () => ({ totalStayPrice: 2500, nightlyBreakdown: [{ seasonLabel: 'Haute' }], unpricedNights: [] });
  assert.equal(await priceIdea(stay, { quote: cheap, today: '2026-11-15', bounds: boundsOf(api) }), null); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(await priceIdea(stay, { quote: dear, today: '2026-11-15', bounds: boundsOf(api) }), null); // date-literal-ok: the suite runs on its own clock, never the real today
}));

const IDEAS = [{
  label: 'Un week-end',
  amounts: [{ label: 'Basse', amountCents: 18000 }, { label: 'Haute', amountCents: 40000 }, { label: 'Fêtes', amountCents: 65000 }],
}];

test('rule 14: GET /offer answers the bounds, the validity, the priced ideas and the terms version — the brand is the company name, and with no online payment configured available is false', () => withIdeas({
  settings: { ideas: JSON.stringify([stay]), minAmountCents: '3000', validityMonths: '12' },
  deps: { quote: seasonalQuote(), terms: termsStub({ lodging: 4 }) },
}, async ({ server }) => {
  const res = await server.call('GET', '/public/v1/gift-vouchers/offer');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  // The back the site draws (rule 66) has its own suite.
  const { back, ...offered } = res.body.data;
  assert.ok(back);
  offered.campaigns = offered.campaigns.map(({ back: _back, ...rest }) => rest);
  assert.deepEqual(offered, {
    available: false,
    brand: 'Domaine Solio',
    minAmountCents: 3000,
    maxAmountCents: 200000,
    validityMonths: 12,
    ideas: IDEAS,
    campaigns: [{
      slug: 'sejour', kind: 'lodging', title: 'Bon cadeau', validityMonths: 12, minAmountCents: 3000, maxAmountCents: 200000, ideas: IDEAS, termsVersionId: 4, termsVersion: 1, visual: null,
    }],
    termsVersionId: 4,
    termsVersion: 1,
  });
}));

test('rule 14: with no idea configured the offer lists none', () => withIdeas({}, async ({ server }) => {
  const res = await server.call('GET', '/public/v1/gift-vouchers/offer');
  assert.deepEqual(res.body.data.ideas, []);
}));

test('rule 14: ideas are priced at most once a day, and again after pricing.changed', () => withIdeas({
  settings: { ideas: JSON.stringify([stay]) },
}, async ({ clock, db }) => {
  const calls = [];
  const fixture = fx.buildApi(db, { settings: { ideas: JSON.stringify([stay]) }, deps: { quote: seasonalQuote(calls) } });
  fixture.clock.at = clock.at;
  const { offerService } = fixture.api;
  const read = () => offerService.offer();
  await read();
  const first = calls.length;
  assert.ok(first > 300);
  await read();
  await read();
  assert.equal(calls.length, first, 'served from the cache');
  fixture.clock.at = new Date(fixture.clock.at.getTime() + 23 * 3600 * 1000);
  await read();
  assert.equal(calls.length, first, 'still the same day');
  fixture.clock.at = new Date(fixture.clock.at.getTime() + 2 * 3600 * 1000);
  await read();
  assert.equal(calls.length, 2 * first, 'a day later it is priced again');
  offerService.invalidateIdeas();
  await read();
  assert.equal(calls.length, 3 * first, 'pricing.changed drops the cache');
}));

test('rule 14: two readers at once share one pricing run; a change during a run is not served stale', () => withIdeas({}, async ({ db }) => {
  const calls = [];
  const fixture = fx.buildApi(db, { settings: { ideas: JSON.stringify([stay]) }, deps: { quote: seasonalQuote(calls) } });
  const { offerService } = fixture.api;
  const [a, b] = await Promise.all([offerService.offer(), offerService.offer()]);
  assert.deepEqual(a, b);
  const once = calls.length;
  offerService.invalidateIdeas();
  const running = offerService.offer();
  offerService.invalidateIdeas();
  await running;
  await offerService.offer();
  assert.equal(calls.length, once * 3, 'the run begun before the second change is thrown away and priced again');
}));

test('rule 14: the plugin refreshes its ideas on the core’s pricing.changed event', () => {
  const handlers = new Map();
  const noop = new Proxy(function noop() {}, { get: () => noop, apply: () => noop });
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === 'events') return { on: (name, handler) => handlers.set(name, handler) };
      if (key === 'db') return null;
      if (key === 'settings') return { declare() {}, get: () => '' };
      return noop;
    },
  });
  require('..').register(ctx);
  assert.equal(typeof handlers.get('pricing.changed'), 'function');
});
