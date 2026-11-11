// specs/pricing-components.md §3 rules 10, 14, 41, 47, 56 — the Articles head: the only interface of « Articles », dispatch to
// the family registry, refusals, the sold snapshot, the stay allowance, « offert », frozen instances.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const articles = require('../utils/pricing/articles');
const registry = require('../utils/pricing/articles/registry');
const { createFreeUnitsLedger } = require('../utils/pricing/allowances');
const { STAY, optionRow, resourceRow, article } = require('./articlesFixtures');

const quote = (request, extra = {}) => articles.quote({ requests: [request], stayContext: STAY, ...extra });
const one = (request, extra) => quote(request, extra).lines[0];

test('rule 47 — the head is the only module of articles/ the rest of the code requires', () => {
  const root = path.join(__dirname, '..');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['tests', 'node_modules', 'articles'].includes(entry.name)) walk(full);
      } else if (entry.name.endsWith('.js') && !full.includes(`${path.sep}utils${path.sep}pricing${path.sep}articles${path.sep}`)) {
        const source = fs.readFileSync(full, 'utf8');
        for (const match of source.matchAll(/require\(\s*['"]([^'"]*articles[^'"]*)['"]\s*\)/g)) {
          if (!/(^|\/)pricing\/articles$/.test(match[1]) && !/(^|\/)pricing\/articles\/index$/.test(match[1])) offenders.push(`${path.relative(root, full)} requires ${match[1]}`);
        }
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders.filter((line) => /pricing\/articles/.test(line)), []);
});

test('rule 47 — the head exposes quote, commit, release, describe, the factory and the family registration', () => {
  for (const name of ['quote', 'commit', 'release', 'describe', 'makeArticle', 'registerFamily']) assert.equal(typeof articles[name], 'function', name);
});

test('rule 47 — dispatch: each request is priced by the family of its article', () => {
  const rows = [
    ['fixed', optionRow({ priceType: 'per_stay' }), 6.5],
    ['perPerson', optionRow({ priceType: 'per_person' }), 26],
    ['perNight', optionRow({ priceType: 'per_night' }), 19.5],
    ['perPersonPerNight', optionRow({ priceType: 'per_person_per_night' }), 78],
    ['percentOfStay', optionRow({ priceType: 'percent_of_stay', price: 4 }), 20],
    ['perParticipantProgressive', optionRow({ priceType: 'per_participant_progressive', price: 10 }), 10],
  ];
  for (const [family, row, total] of rows) {
    const instance = article(row);
    assert.equal(instance.family, family);
    const line = one({ article: instance, quantity: 1 });
    assert.equal(line.family, family);
    assert.equal(line.offeredFigures.totalPrice, total, family);
  }
});

test('rule 47 — a request returns its line at its own index, null when it prices nothing', () => {
  const result = articles.quote({
    requests: [{ article: article(), quantity: 1 }, { article: article(optionRow({ priceType: 'per_participant_progressive', price: 10 })), quantity: 0 }],
    stayContext: STAY,
  });
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].offeredFigures.totalPrice, 6.5);
  assert.equal(result.lines[1].offeredFigures.totalPrice, 0);
  assert.equal(result.taggedAmounts.length, 2);
});

test('rule 47 — a request for an unregistered family is refused, a family of a plugin that is not live is unavailable', () => {
  const ghost = Object.freeze({ ref: 'resource:9', family: 'ghost', config: Object.freeze({ id: 9, kind: 'resource', price: 1, priceType: 'ghost', vatClass: 'resources' }) });
  const refused = quote({ article: ghost, quantity: 1 });
  assert.deepEqual(refused.refusals.map((r) => r.code), ['FAMILY_UNAVAILABLE']);
  assert.deepEqual(refused.lines, [null]);

  let live = false;
  const stub = {
    id: 'stubbed', configSchema: [], validate: () => [], describe: () => ({ label: '', detail: '' }),
    price: (config, request) => ({ quantity: request.quantity, unitPrice: 2, billedUnits: request.quantity, typed: null, components: [], allowanceUsed: 0, amounts: [] }),
  };
  registry.register('stubbed', stub, { owner: 'stub-plugin', isLive: () => live });
  const instance = Object.freeze({ ref: 'option:8', family: 'stubbed', config: Object.freeze({ id: 8, kind: 'option', price: 2, priceType: 'per_stay', vatClass: 'options', freeUnits: 0 }) });
  assert.deepEqual(quote({ article: instance, quantity: 2 }).refusals.map((r) => r.code), ['FAMILY_UNAVAILABLE']);
  live = true;
  assert.equal(one({ article: instance, quantity: 2 }).offeredFigures.totalPrice, 4);
});

test('rule 47 — a family id is registered once: DUPLICATE_FAMILY, except a plugin registering its own id again', () => {
  const fixedFamily = require('../utils/pricing/articles/families/fixed').family;
  assert.throws(() => articles.registerFamily('fixed', fixedFamily), { code: 'DUPLICATE_FAMILY' });
  assert.throws(() => articles.registerFamily('fixed', fixedFamily, { owner: 'some-plugin' }), { code: 'DUPLICATE_FAMILY' });
  assert.throws(() => articles.registerFamily('broken', { id: 'broken' }), { code: 'INVALID_FAMILY' });
  const own = { ...fixedFamily, id: 'again' };
  registry.register('again', own, { owner: 'p1' });
  assert.doesNotThrow(() => registry.register('again', own, { owner: 'p1' }));
  assert.throws(() => registry.register('again', own, { owner: 'p2' }), { code: 'DUPLICATE_FAMILY' });
});

test('rule 47 — a refusal of the family comes back as a refusal with the article ref, nothing is priced', () => {
  const result = quote({ article: article(optionRow({ priceType: 'per_person' })), quantity: 1 }, { stayContext: { nights: 3 } });
  assert.deepEqual(result.refusals.map((r) => [r.code, r.ref]), [['STAY_PERSONS_MISSING', 'option:7']]);
  assert.deepEqual(result.lines, [null]);
});

test('rule 47 — only the hosted customer context is priced in PR A', () => {
  const result = articles.quote({ requests: [{ article: article(), quantity: 1 }], stayContext: STAY, customerContext: 'external' });
  assert.deepEqual(result.refusals.map((r) => r.code), ['CONTEXT_UNSUPPORTED']);
  assert.deepEqual(result.lines, [null]);
});

test('rule 47 — instances are frozen configuration, with the ref and the family of the catalogue row', () => {
  const option = article(optionRow({ optionProgressiveTiers: [{ participantNumber: 2, unitPrice: 4 }] }));
  assert.equal(option.ref, 'option:7');
  assert.equal(Object.isFrozen(option), true);
  assert.equal(Object.isFrozen(option.config), true);
  assert.equal(Object.isFrozen(option.config.progressiveTiers[0]), true);
  assert.throws(() => { 'use strict'; option.config.price = 1; }, TypeError);
  const resource = article(resourceRow(), 'resource');
  assert.deepEqual([resource.ref, resource.family, resource.config.vatClass], ['resource:3', 'hourly', 'resources']);
  assert.equal(Object.isFrozen(resource.config.resource), true);
});

test('rule 47 — makeArticle maps today\'s price types one to one to families', () => {
  const expected = {
    per_stay: 'fixed', free: 'fixed', per_person: 'perPerson', per_night: 'perNight', per_person_per_night: 'perPersonPerNight',
    percent_of_stay: 'percentOfStay', per_participant_progressive: 'perParticipantProgressive', per_hour: 'hourly',
  };
  for (const [priceType, family] of Object.entries(expected)) assert.equal(article(optionRow({ priceType })).family, family, priceType);
  assert.equal(article(optionRow({ priceType: undefined })).family, 'fixed');
});

test('rule 13 — a sold line keeps its price: same units, more units at today\'s price, fewer at the sold price', () => {
  const sold = { billedUnits: 3, totalPrice: 30, unitPrice: 10, quantity: 3 };
  const row = optionRow({ price: 12, priceType: 'per_stay' });
  const total = (quantity) => one({ article: article(row), quantity, locked: sold }).offeredFigures.totalPrice;
  assert.equal(total(3), 30);
  assert.equal(one({ article: article(row), quantity: 3, locked: sold }).figures.unitPrice, 10);
  assert.equal(total(4), 42);
  assert.equal(total(2), 20);
});

test('rule 14 — offered zeroes the billed amount and keeps the real one; the tagged amount follows what is billed', () => {
  const line = one({ article: article(optionRow()), quantity: 2, offered: true });
  assert.deepEqual(line.offeredFigures, { originalTotalPrice: 13, totalPrice: 0, offered: true });
  assert.equal(line.taggedAmounts[0].amountCents, 0);
  const back = one({ article: article(optionRow()), quantity: 2, offered: false });
  assert.deepEqual(back.offeredFigures, { originalTotalPrice: 13, totalPrice: 13, offered: false });
  assert.equal(back.taggedAmounts[0].amountCents, 1300);
});

test('rule 14 — an amount fixed upstream takes « offert » only', () => {
  const line = one({ ref: 'custom:1', vatClass: 'options', priced: { totalPrice: 42.5 }, offered: true });
  assert.deepEqual(line.offeredFigures, { originalTotalPrice: 42.5, totalPrice: 0, offered: true });
  assert.deepEqual(line.figures, {});
  const billed = one({ article: article(optionRow()), priced: { totalPrice: 8 }, offered: false });
  assert.deepEqual([billed.ref, billed.taggedAmounts[0].amountCents], ['option:7', 800]);
});

test('rule 41 — allowance coordination: the free units of the stay are consumed in the line, on an own-channel stay only', () => {
  const row = optionRow({ price: 6, freeUnits: 2 });
  const direct = one({ article: article(row), quantity: 3 });
  assert.deepEqual([direct.figures.freeUnits, direct.figures.freeUnitsAmount, direct.figures.chargedUnits, direct.offeredFigures.totalPrice, direct.allowanceUsed], [2, 12, 1, 6, 2]);
  const platform = one({ article: article(row), quantity: 3 }, { stayContext: { ...STAY, isDirectBooking: false } });
  assert.deepEqual([platform.figures.freeUnits, platform.offeredFigures.totalPrice, platform.allowanceUsed], [0, 18, 0]);
  const total = articles.quote({ requests: [{ article: article(row), quantity: 3 }, { article: article(row), quantity: 1 }], stayContext: STAY });
  assert.equal(total.allowanceUsed, 3);
});

test('rule 41 — the stay\'s ledger grants and consumes what the sold snapshot says, not the live catalogue', () => {
  const row = optionRow({ id: 7, price: 6, freeUnits: 2 });
  const ledger = createFreeUnitsLedger({
    lockedTariff: { grantedFreeUnitsByOption: { 7: 1 } },
    optionsById: new Map([[7, row]]),
    lockedOptionsById: new Map(),
    isDirectBooking: true,
  });
  const line = one({ article: article(row), quantity: 3 }, { allowance: ledger });
  assert.deepEqual([line.figures.freeUnits, line.offeredFigures.totalPrice], [1, 12]);
});

test('rule 47 — commit returns the lines to write and refuses a refused quote; release gives the allowance back', () => {
  const row = optionRow({ price: 6, freeUnits: 2 });
  const quoted = quote({ article: article(row), quantity: 3 });
  assert.equal(articles.commit(quoted).length, 1);
  assert.throws(() => articles.commit({ lines: [null], refusals: [{ code: 'X' }] }), { code: 'QUOTE_REFUSED' });
  assert.deepEqual(articles.release(quoted.lines[0], 'removed'), { returned: 2, amount: 12 });
});

test('rule 47 — describe prints the label and the detail through the family', () => {
  const line = one({ article: article(optionRow({ price: 6, freeUnits: 2 })), quantity: 3 });
  assert.deepEqual(articles.describe(line), { label: 'Petit déjeuner', detail: '3 × 6,00 € · 2 offerts' });
});

test('rule 56 — families, instances and ports are plain objects and functions: no class in articles/', () => {
  const dir = path.join(__dirname, '..', 'utils', 'pricing', 'articles');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
  walk(dir);
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''), /\bclass\s+\w+|\bextends\b|\bnew\s+[A-Z]\w*Registry/, path.basename(file));
});
