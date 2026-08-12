const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRecipeStore, validateRecipe } = require('../utils/tariffRecipe');

// specs/tariff-recipes/spec.md §3.5 rules 26-27 — two sources (bundled then local, local overrides
// by id), per-file failure isolation, a missing data directory is not an error.

const MINIMAL = {
  id: 'test-recipe', version: '1.0.0', label: 'Recette de test', horizonYears: 2,
  seasons: [
    { key: 'low', label: 'Basse', rank: 1, color: '#111111', pricePerNight: 100 },
    { key: 'high', label: 'Haute', rank: 2, color: '#222222', pricePerNight: 200 },
  ],
  calendar: {
    baseSeason: 'low',
    periods: [
      { id: 'summer', season: 'high', anchor: { type: 'fixed_dates', from: '07-01', to: '08-31' } },
    ],
    modifiers: [],
  },
  closures: [],
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-recipes-'));
}

function writeRecipe(dir, name, json) {
  fs.writeFileSync(path.join(dir, name), typeof json === 'string' ? json : JSON.stringify(json));
}

test('a valid bundled recipe loads; a missing local directory is not an error', () => {
  const bundled = tmpDir();
  writeRecipe(bundled, 'test.json', MINIMAL);
  const store = createRecipeStore({ bundledDir: bundled, localDir: path.join(bundled, 'nope') });
  const list = store.listRecipes();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'test-recipe');
  assert.equal(list[0].source, 'bundled');
  assert.equal(list[0].overridesBundled, false);
  assert.equal(store.listInvalidRecipes().length, 0);
  assert.equal(store.getRecipe('test-recipe').label, 'Recette de test');
});

test('a local recipe with the same id REPLACES the bundled one entirely', () => {
  const bundled = tmpDir(); const local = tmpDir();
  writeRecipe(bundled, 'test.json', MINIMAL);
  writeRecipe(local, 'test.json', { ...MINIMAL, version: '1.1.0', label: 'Version locale' });
  const store = createRecipeStore({ bundledDir: bundled, localDir: local });
  const list = store.listRecipes();
  assert.equal(list.length, 1);
  assert.equal(list[0].version, '1.1.0');
  assert.equal(list[0].source, 'local');
  assert.equal(list[0].overridesBundled, true);
  assert.equal(store.getRecipe('test-recipe').label, 'Version locale');
});

test('an invalid recipe is isolated with its error; the others still load; nothing throws', () => {
  const bundled = tmpDir();
  writeRecipe(bundled, 'good.json', MINIMAL);
  writeRecipe(bundled, 'broken.json', '{ not json');
  writeRecipe(bundled, 'bad-schema.json', { ...MINIMAL, id: 'bad', seasons: [] });
  const store = createRecipeStore({ bundledDir: bundled });
  assert.equal(store.listRecipes().length, 1);
  const invalid = store.listInvalidRecipes();
  assert.equal(invalid.length, 2);
  assert.ok(invalid.find((i) => i.file === 'broken.json').error.includes('JSON invalide'));
  assert.ok(invalid.find((i) => i.file === 'bad-schema.json').error.includes('seasons'));
});

test('a local-only recipe (no bundled counterpart) is listed as local, not as an override', () => {
  const bundled = tmpDir(); const local = tmpDir();
  writeRecipe(local, 'only.json', { ...MINIMAL, id: 'local-only' });
  const store = createRecipeStore({ bundledDir: bundled, localDir: local });
  const entry = store.listRecipes().find((r) => r.id === 'local-only');
  assert.equal(entry.source, 'local');
  assert.equal(entry.overridesBundled, false);
});

// ── Schema validation, each rule rejected by name ────────────────────────────

const cases = [
  ['missing id', { ...MINIMAL, id: '' }, 'id'],
  ['bad version', { ...MINIMAL, version: 'v1' }, 'version'],
  ['bad horizon', { ...MINIMAL, horizonYears: 9 }, 'horizonYears'],
  ['duplicate season key', { ...MINIMAL, seasons: [MINIMAL.seasons[0], { ...MINIMAL.seasons[1], key: 'low' }] }, 'key'],
  ['duplicate rank', { ...MINIMAL, seasons: [MINIMAL.seasons[0], { ...MINIMAL.seasons[1], rank: 1 }] }, 'rank'],
  ['non-contiguous ranks', { ...MINIMAL, seasons: [MINIMAL.seasons[0], { ...MINIMAL.seasons[1], rank: 3 }] }, 'rangs'],
  ['negative price', { ...MINIMAL, seasons: [{ ...MINIMAL.seasons[0], pricePerNight: -5 }, MINIMAL.seasons[1]] }, 'pricePerNight'],
  ['unknown base season', { ...MINIMAL, calendar: { ...MINIMAL.calendar, baseSeason: 'nope' } }, 'baseSeason'],
  ['unknown period season', { ...MINIMAL, calendar: { ...MINIMAL.calendar, periods: [{ id: 'x', season: 'nope', anchor: { type: 'fixed_dates', from: '01-01', to: '01-02' } }] } }, 'season'],
  ['bad anchor type', { ...MINIMAL, calendar: { ...MINIMAL.calendar, periods: [{ id: 'x', season: 'high', anchor: { type: 'wat' } }] } }, 'anchor.type'],
  ['between references a LATER period', { ...MINIMAL, calendar: { ...MINIMAL.calendar, periods: [
    { id: 'core', season: 'high', anchor: { type: 'between', after: 'a', before: 'b' } },
    { id: 'a', season: 'high', anchor: { type: 'nth_weekday_of_month', month: 7, weekday: 6, occurrence: 1 }, nights: 7 },
  ] } }, 'after'],
  ['out-of-range weekday', { ...MINIMAL, calendar: { ...MINIMAL.calendar, periods: [{ id: 'x', season: 'high', anchor: { type: 'nth_weekday_of_month', month: 7, weekday: 8, occurrence: 1 }, nights: 7 }] } }, 'weekday'],
  ['ratio outside (0,1]', { ...MINIMAL, seasons: [{ ...MINIMAL.seasons[0], pricingMode: 'progressive', extraNightRatio: 1.2 }, MINIMAL.seasons[1]] }, 'extraNightRatio'],
  ['ratio AND tiers', { ...MINIMAL, seasons: [{ ...MINIMAL.seasons[0], pricingMode: 'progressive', extraNightRatio: 0.7, progressiveTiers: [{ nightNumber: 2, extraNightPrice: 50 }] }, MINIMAL.seasons[1]] }, 'mutuellement exclusifs'],
  ['bad closure format', { ...MINIMAL, closures: [{ label: 'Hiver', from: '15-10', to: '03-31' }] }, 'from'],
  ['bad changeover weekday', { ...MINIMAL, seasons: [{ ...MINIMAL.seasons[0], changeover: { arrival: 9, departure: null } }, MINIMAL.seasons[1]] }, 'arrival'],
];

for (const [label, json, needle] of cases) {
  test(`validateRecipe rejects: ${label}`, () => {
    const out = validateRecipe(json);
    assert.equal(out.valid, false);
    assert.ok(out.error.includes(needle), `error « ${out.error} » should mention « ${needle} »`);
  });
}

test('validateRecipe expands a cumulative discount table into marginal tiers', () => {
  const out = validateRecipe({
    ...MINIMAL,
    lengthOfStayDiscounts: [
      { nights: 2, discountPct: 24 }, { nights: 3, discountPct: 33 }, { nights: 7, discountPct: 45 },
    ],
    seasons: [
      { ...MINIMAL.seasons[0], pricePerNight: 179, pricingMode: 'progressive' },
      MINIMAL.seasons[1],
    ],
  });
  assert.equal(out.valid, true, out.error);
  const tiers = out.recipe.seasons[0].progressiveTiers;
  const byNight = new Map(tiers.map((t) => [t.nightNumber, t.extraNightPrice]));
  // Walk the nights ONCE, accumulating, and check the total wherever the table declares a value.
  const declared = { 2: 24, 3: 33, 7: 45 };
  let cumulative = 179;
  for (let n = 2; n <= 7; n += 1) {
    cumulative = Math.round((cumulative + byNight.get(n)) * 100) / 100;
    if (declared[n] === undefined) continue;
    assert.equal(cumulative, Math.round(179 * n * (1 - declared[n] / 100) * 100) / 100, `${n} nights`);
  }
  // Nights 4-6 are absent from the table: they keep night 3's cumulative discount.
  assert.equal(byNight.get(4), Math.round((179 * 4 * 0.67 - 179 * 3 * 0.67) * 100) / 100);
});

const discountTableCases = [
  ['nights below 2', [{ nights: 1, discountPct: 10 }], 'nights'],
  ['nights not increasing', [{ nights: 3, discountPct: 10 }, { nights: 3, discountPct: 20 }], 'croissantes'],
  ['discount going backwards', [{ nights: 2, discountPct: 30 }, { nights: 3, discountPct: 20 }], 'inférieur'],
  ['discount out of range', [{ nights: 2, discountPct: 120 }], 'discountPct'],
];
for (const [label, table, needle] of discountTableCases) {
  test(`validateRecipe rejects a discount table with ${label}`, () => {
    const out = validateRecipe({ ...MINIMAL, lengthOfStayDiscounts: table });
    assert.equal(out.valid, false);
    assert.ok(out.error.includes(needle), `error « ${out.error} » should mention « ${needle} »`);
  });
}

test('validateRecipe rejects declaring a table AND a ratio on the same season', () => {
  const out = validateRecipe({
    ...MINIMAL,
    seasons: [
      { ...MINIMAL.seasons[0], pricingMode: 'progressive', extraNightRatio: 0.7, lengthOfStayDiscounts: [{ nights: 2, discountPct: 24 }] },
      MINIMAL.seasons[1],
    ],
  });
  assert.equal(out.valid, false);
  assert.ok(out.error.includes('mutuellement exclusifs'));
});

test('validateRecipe expands extraNightRatio into the single night-2 tier', () => {
  const out = validateRecipe({
    ...MINIMAL,
    seasons: [
      { ...MINIMAL.seasons[0], pricePerNight: 179, pricingMode: 'progressive', extraNightRatio: 0.70 },
      MINIMAL.seasons[1],
    ],
  });
  assert.equal(out.valid, true);
  assert.deepEqual(out.recipe.seasons[0].progressiveTiers, [{ nightNumber: 2, extraNightPrice: 125.30 }]);
});
