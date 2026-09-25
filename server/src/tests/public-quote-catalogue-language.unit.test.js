/**
 * specs/translation-catalogue.md rule 21 — the live quote reads the catalogue, like every other
 * surface that names a label. Also specs/site-english-version.md rule 6, which said so first.
 *
 * The regression this suite exists for shipped in 3.3.0 and was visible in the tunnel: the catalogue
 * migration dropped `options.titleEn` / `resources.nameEn`, and `toPublicQuote` was the one projection
 * still resolving its lines from those columns. `undefined` fell back to French exactly as rule 14
 * asks it to, so nothing failed and nothing logged — an English visitor picked « Breakfast » in the
 * drawer and read « Petit déjeuner » in the summary underneath it.
 *
 * Which is why these tests assert on the RESOLVER being consulted, not merely on the strings: a
 * fallback that works is what hid the bug for a whole release.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { toPublicQuote } = require('../utils/publicProjections');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

/**
 * The real resolver's shape and contract, over a catalogue given as `entryKey → text`.
 *
 * Including the one behaviour that matters most here: `fr` is the source language and is never looked
 * up, so a French quote cannot be changed by the resolver's presence.
 */
function resolverOver(values, lang = 'en') {
  const source = !lang || String(lang).toLowerCase() === 'fr';
  const get = (key) => (!source && values[key] && String(values[key]).trim() ? values[key] : null);
  return {
    lang: source ? 'fr' : lang,
    optionTitle: (id, french) => get(`option:${id}:title`) || french,
    optionDescription: (id, french) => (source ? (french || null) : get(`option:${id}:description`)),
    englishOptionTitle: (id) => get(`option:${id}:title`),
    resourceName: (id, french) => get(`resource:${id}`) || french,
    englishResourceName: (id) => get(`resource:${id}`),
    category: (french) => get(`category:${french}`) || french,
  };
}

const CATALOGUE = {
  'option:7:title': 'Breakfast',
  'option:9:title': 'Cancellation insurance',
  'option:9:description': 'Cancel without a reason',
  'resource:3': 'Nordic bath',
};

/** Engine output carrying a French option line and a French resource line, and nothing English. */
function engineQuote() {
  return {
    property: { id: 1 }, nights: 3, persons: 2, requiredMinNights: 1, minNightsBreached: false,
    nightlyBreakdown: [], totalPrice: 600, extraGuestSurcharge: 0,
    optionLines: [{ optionId: 7, title: 'Petit déjeuner', quantity: 6, unitPrice: 12, totalPrice: 72, offered: false }],
    optionsTotal: 72,
    resourceLines: [{ resourceId: 3, name: 'Bain nordique', quantity: 2, billedUnits: 1, unitPrice: 30, totalPrice: 30, offered: false }],
    resourcesTotal: 30,
    touristTaxTotal: 0, touristTaxLabel: null, touristTaxCollectedOnArrival: false,
    finalPrice: 702, totalStayPrice: 702, complementAmount: 0,
  };
}

// ── The projection ───────────────────────────────────────────────────────────

test('an English quote names its option lines and its resource lines from the catalogue (rule 21)', () => {
  const out = toPublicQuote(engineQuote(), {
    available: true, startDate: '2026-11-10', endDate: '2026-11-13',
    lang: 'en', translate: resolverOver(CATALOGUE),
  });
  assert.equal(out.options[0].title, 'Breakfast');
  assert.equal(out.resources[0].name, 'Nordic bath');
});

test('a line the catalogue does not hold falls back to French, silently (rules 14 and 21)', () => {
  const out = toPublicQuote(engineQuote(), {
    available: true, startDate: '2026-11-10', endDate: '2026-11-13',
    lang: 'en', translate: resolverOver({}),
  });
  assert.equal(out.options[0].title, 'Petit déjeuner');
  assert.equal(out.resources[0].name, 'Bain nordique');
});

test('a French quote is untouched by the resolver — same payload as before the catalogue (rule 21)', () => {
  const withResolver = toPublicQuote(engineQuote(), {
    available: true, startDate: '2026-11-10', endDate: '2026-11-13',
    lang: 'fr', translate: resolverOver(CATALOGUE, 'fr'),
  });
  // The neutral resolver returns the French it is given, so the two payloads must be identical.
  const bare = toPublicQuote(engineQuote(), {
    available: true, startDate: '2026-11-10', endDate: '2026-11-13', lang: 'fr',
  });
  assert.equal(withResolver.options[0].title, 'Petit déjeuner');
  assert.equal(withResolver.resources[0].name, 'Bain nordique');
  assert.deepEqual(withResolver, bare);
});

test('the dropped columns are no longer what a line is resolved from (rule 21)', () => {
  // `titleEn` / `nameEn` do not exist on an engine line any more. A projection that still read them
  // would pass the two tests above by accident — this one fails unless the resolver is consulted.
  const legacy = engineQuote();
  legacy.optionLines[0].titleEn = 'Stale column';
  legacy.resourceLines[0].nameEn = 'Stale column';
  const out = toPublicQuote(legacy, {
    available: true, startDate: '2026-11-10', endDate: '2026-11-13',
    lang: 'en', translate: resolverOver(CATALOGUE),
  });
  assert.equal(out.options[0].title, 'Breakfast');
  assert.equal(out.resources[0].name, 'Nordic bath');
});

// ── The controller: the wiring that was actually missing ─────────────────────

function buildController({ captures, insurance = null, options = [{ id: 7 }] }) {
  return withMocks({
    // Only what `resolveNeatPricing` reads: the property's name for the Neat snapshot.
    '../../database': { prepare: () => ({ get: () => ({ name: 'La Granja' }) }) },
    '../../utils/neatGuestPricing': {
      isNeatPricingActive: () => false,
      buildQuoteSnapshot: () => ({}),
      resolveInsurancePricing: () => null,
    },
    '../../utils/pricing': {
      calculateReservationQuote: () => engineQuote(),
      computePercentOfStayAmount: () => 0,
      getTypeMultiplier: () => 1,
      roundMoney: (n) => n,
    },
    '../../models/optionsModel': {
      listForProperty: () => options,
      getCancellationInsurance: () => insurance,
    },
    '../../models/resourcesModel': { list: () => [{ id: 3 }] },
    '../../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    './publicCatalogController': { computeBlockedDates: () => [], rangeHasBlockedNight: () => false },
    '../../utils/translationResolver': {
      forLang: (lang) => {
        captures.langAsked = lang;
        return resolverOver(CATALOGUE, lang);
      },
    },
  }, () => {
    const m = '../controllers/public/publicQuoteController';
    delete require.cache[require.resolve(m)];
    return require(m);
  });
}

const STAY = {
  propertyId: 1, startDate: '2026-11-10', endDate: '2026-11-13', adults: 2,
  options: [{ optionId: 7, quantity: 6 }], resources: [{ resourceId: 3, quantity: 2 }],
};

test('POST /quote asks the catalogue for the language it was called in (rule 21)', async () => {
  const captures = {};
  const controller = buildController({ captures });
  const res = fakeRes();
  await controller.quote({ body: { ...STAY, lang: 'en' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(captures.langAsked, 'en');
  assert.equal(res.body.data.options[0].title, 'Breakfast');
  assert.equal(res.body.data.resources[0].name, 'Nordic bath');
});

test('POST /quote without a language reads as French, and nothing is translated (rules 18 and 21)', async () => {
  const captures = {};
  const controller = buildController({ captures });
  const res = fakeRes();
  await controller.quote({ body: STAY }, res);

  assert.equal(captures.langAsked, 'fr');
  assert.equal(res.body.data.options[0].title, 'Petit déjeuner');
  assert.equal(res.body.data.resources[0].name, 'Bain nordique');
});

test('the insurance block of a quote is translated too (rule 21)', async () => {
  const captures = {};
  const controller = buildController({
    captures,
    options: [{ id: 7 }, { id: 9 }],
    insurance: {
      id: 9, title: 'Assurance annulation', description: 'Annulez sans justificatif',
      priceType: 'per_stay', price: 40, isCancellationInsurance: 1,
    },
  });
  const res = fakeRes();
  await controller.quote({
    body: { ...STAY, lang: 'en' },
  }, res);

  const block = res.body.data.cancellationInsurance;
  assert.equal(captures.langAsked, 'en');
  assert.equal(block.title, 'Cancellation insurance');
  // Rule 15 — a description the catalogue holds is served; one it does not is omitted, not French.
  assert.equal(block.description, 'Cancel without a reason');
});

test('the portion hint under a stepper follows the language (rule 21)', () => {
  const captures = {};
  const controller = buildController({
    captures,
    options: [{ id: 6, title: 'Petit déjeuner', priceType: 'per_person', showsPlanningCard: 1 }],
  });
  const limits = controller.buildOptionLimits(
    { propertyId: 1, checkInTime: '16:00', checkOutTime: '10:00' },
    { persons: 2, nights: 3, defaultCheckIn: '16:00', defaultCheckOut: '10:00' },
    'en',
  );
  assert.equal(limits.length, 1);
  assert.ok(
    !/Jusqu|personnes|matins/.test(limits[0].hint),
    `the hint is still French: « ${limits[0].hint} »`,
  );
});
