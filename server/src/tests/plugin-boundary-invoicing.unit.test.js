// specs/resource-booking-pricing-and-invoicing.md rules 1-2 — the two core contracts are inert without plugins: the
// issuer and the sales of a plugin exist only while it is live, at most one issuer per instance, and a throwing plugin
// never breaks the journal or the reconciliation.
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const invoiceIssuers = require('../utils/invoiceIssuers');
const standaloneSales = require('../utils/standaloneSales');

const issuer = (over = {}) => ({
  id: 'qonto', isReady: () => true, issue: async () => ({}), findCardBatch: async () => null, attach: async () => ({}), invoiceStatus: async () => 'paid', ...over,
});
const ctx = (id) => createContext(id, { settingsModel: () => ({}) });

function withRegistry(active, fn) {
  registry.reset();
  registry.configure({ isActive: (id) => active.includes(id), allows: () => true });
  try { return fn(); } finally { registry.reset(); }
}

test('rule 1 — no plugin: no issuer, no sale', () => withRegistry([], () => {
  assert.equal(invoiceIssuers.current(), null);
  assert.equal(invoiceIssuers.ready(), false);
  assert.deepEqual(standaloneSales.list({ from: '2026-11-01', to: '2026-11-30' }), []);
}));

test('rule 1 — at most one invoice issuer per instance; an incomplete one is refused', () => withRegistry(['online-payment'], () => {
  ctx('online-payment').invoiceIssuer(issuer());
  assert.throws(() => ctx('other').invoiceIssuer(issuer()), /already declared by online-payment/);
  assert.throws(() => ctx('third').invoiceIssuer({ id: 'x' }), /lacks "isReady"/);
}));

test('rule 2 — the issuer counts only while its plugin is live, and only when it says it is ready', () => {
  withRegistry([], () => {
    ctx('online-payment').invoiceIssuer(issuer());
    assert.equal(invoiceIssuers.current(), null);
  });
  withRegistry(['online-payment'], () => {
    ctx('online-payment').invoiceIssuer(issuer({ isReady: () => false }));
    assert.ok(invoiceIssuers.current());
    assert.equal(invoiceIssuers.ready(), false);
  });
});

test('rule 2 — sales of a plugin that is off, out of the window, or that throws are left out', () => withRegistry(['hourly-resources', 'broken'], () => {
  ctx('hourly-resources').standaloneSales(() => [
    { key: 'a', date: '2026-11-09', totalCents: 1 },
    { key: 'b', date: '2026-12-01', totalCents: 1 },
  ]);
  ctx('off').standaloneSales(() => [{ key: 'c', date: '2026-11-09', totalCents: 1 }]);
  ctx('broken').standaloneSales(() => { throw new Error('boom'); });
  const out = standaloneSales.list({ from: '2026-11-01', to: '2026-11-30' }, { error() {} });
  assert.deepEqual(out.map((s) => [s.key, s.pluginId]), [['a', 'hourly-resources']]);
  assert.deepEqual(standaloneSales.list({ from: 'x', to: 'y' }), []);
}));
