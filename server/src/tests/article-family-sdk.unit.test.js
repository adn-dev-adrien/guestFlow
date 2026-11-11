// specs/pricing-components.md §3 rules 5 and 47 (SDK 2.27.0) — `ctx.articleFamily(id, family)`: a plugin adds a pricing
// family to the Articles head; it prices only while the plugin is live; an id is declared once; the hourly-resources
// plugin declares `hourly` next to its price-line contributor (the alias).
const test = require('node:test');
const assert = require('node:assert/strict');
const pluginRegistry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const articleRegistry = require('../utils/pricing/articles/registry');
const articles = require('../utils/pricing/articles');
const { SDK_VERSION } = require('../plugins/sdk/version');

const family = (id) => ({
  id,
  configSchema: [],
  validate: () => [],
  describe: () => ({ label: 'x', detail: 'y' }),
  price: (config, request) => ({ quantity: request.quantity, unitPrice: 3, billedUnits: request.quantity, typed: null, components: [], allowanceUsed: 0, amounts: [] }),
});
const instanceOf = (familyId) => Object.freeze({
  ref: 'option:50', family: familyId, config: Object.freeze({ id: 50, kind: 'option', price: 3, priceType: 'per_stay', vatClass: 'options', freeUnits: 0 }),
});
const priceWith = (familyId) => articles.quote({ requests: [{ article: instanceOf(familyId), quantity: 2 }], stayContext: { persons: 1, nights: 1 } });

test.beforeEach(() => {
  pluginRegistry.reset();
  pluginRegistry.configure({ isActive: () => true, allows: () => true });
});
test.afterEach(() => pluginRegistry.reset());

test('rule 5 — the SDK is a minor above the entry point it adds', () => {
  assert.match(SDK_VERSION, /^2\.(2[7-9]|[3-9]\d)\./);
});

test('rule 47 — a plugin family is recorded, priced while the plugin is live, unavailable once it is not', () => {
  createContext('sdk-probe-live', {}).articleFamily('sdkProbeLive', family('sdkProbeLive'));
  assert.deepEqual(pluginRegistry.get('sdk-probe-live').articleFamilies, ['sdkProbeLive']);
  assert.equal(priceWith('sdkProbeLive').lines[0].offeredFigures.totalPrice, 6);
  pluginRegistry.configure({ isActive: () => false, allows: () => true });
  assert.deepEqual(priceWith('sdkProbeLive').refusals.map((r) => r.code), ['FAMILY_UNAVAILABLE']);
  assert.equal(articleRegistry.get('sdkProbeLive'), null);
});

test('rule 47 — a family id is declared once: a core id, or another plugin\'s, is DUPLICATE_FAMILY', () => {
  assert.throws(() => createContext('sdk-probe-a', {}).articleFamily('fixed', family('fixed')), { code: 'DUPLICATE_FAMILY' });
  createContext('sdk-probe-a', {}).articleFamily('sdkProbeDup', family('sdkProbeDup'));
  assert.throws(() => createContext('sdk-probe-b', {}).articleFamily('sdkProbeDup', family('sdkProbeDup')), { code: 'DUPLICATE_FAMILY' });
  assert.doesNotThrow(() => createContext('sdk-probe-a', {}).articleFamily('sdkProbeDup', family('sdkProbeDup')));
});

test('rule 47 — a family lacking a member is refused at registration', () => {
  assert.throws(() => createContext('sdk-probe-c', {}).articleFamily('sdkProbeBad', { id: 'sdkProbeBad', configSchema: [] }), { code: 'INVALID_FAMILY' });
  assert.throws(() => createContext('sdk-probe-c', {}).articleFamily('other', family('sdkProbeBad')), { code: 'INVALID_FAMILY' });
});
