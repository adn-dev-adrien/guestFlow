// specs/payment-link-lifecycle.md rule 67 — a withdrawn link whose deactivation is owed (whichever path withdrew it) is
// deactivated by the poll while the provider is connected, and listed in the home's « À traiter » until it is.
// A mocked provider only: nothing leaves the process.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink, fakeProvider, spies } = require('./paymentLinkLifecycleFixture');
const { runLinkLifecycle } = require('../utils/paymentPollRunner');
const { owedDeactivations } = require('../controllers/paymentDeactivationsAttentionController');
const { CORE_SUMMARIES, buildAttention } = require('../utils/dashboardAttention');

// date-literal-ok: a fixed instant handed to the poll as its clock
const NOW = new Date('2026-11-05T10:00:00Z');
const REASONS = ['orphan', 'dates-taken', 'amount-changed', 'settled', 'superseded', 'operator'];

function seed() {
  const { db, links, devis } = seedDb();
  const stay = addStay(db);
  const owe = (reservationId, reason, extra = {}) => {
    const link = addLink(links, db, reservationId, extra);
    db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = ?, remoteCancelPendingAt = ? WHERE id = ?").run(reason, NOW.toISOString(), link.id);
    return link.id;
  };
  return { db, links, devis, stay, owe };
}

const providers = (provider) => ({ active: () => provider, declared: () => provider });
const run = (ctx, provider) => runLinkLifecycle({ database: ctx.db, paymentLinksModel: ctx.links, provider, devisModel: ctx.devis, now: NOW, ...spies() });

test('rule 67 — with the provider connected, the poll deactivates the orphan links of deleted stays (the 13/14/16/18/20 case)', async () => {
  const ctx = seed();
  const ids = [922299, 922300].map((missing) => ctx.owe(missing, 'orphan'));
  const provider = fakeProvider();
  const summary = await run(ctx, provider);
  assert.deepEqual(provider.calls.filter((c) => c[0] === 'cancelLink').length, 2);
  assert.deepEqual(summary.results.map((r) => r.status), ['deactivated', 'deactivated']);
  for (const id of ids) assert.equal(ctx.links.findById(id).remoteCancelPendingAt, null);
  assert.deepEqual(ctx.links.listOwedDeactivations(), []);
});

test('rule 67 — every path that owes a deactivation is listed, with the stay it points to or its absence', () => {
  const ctx = seed();
  const ids = REASONS.map((reason) => ctx.owe(reason === 'orphan' ? 922299 : ctx.stay, reason));
  const lapsed = addLink(ctx.links, ctx.db, ctx.stay);
  ctx.db.prepare("UPDATE payment_links SET status = 'expired', cancelReason = 'validity', remoteCancelPendingAt = ? WHERE id = ?").run(NOW.toISOString(), lapsed.id);
  const noProviderId = ctx.owe(ctx.stay, 'operator', { providerLinkId: null });
  const paid = addLink(ctx.links, ctx.db, ctx.stay, { status: 'paid' });

  const owed = ctx.links.listOwedDeactivations();
  assert.deepEqual(owed.map((l) => l.id), [...ids, lapsed.id]);
  assert.ok(!owed.some((l) => l.id === noProviderId || l.id === paid.id), 'nothing to deactivate without a provider id; a paid link is not owed');
  assert.equal(owed.find((l) => l.cancelReason === 'orphan').stayMissing, true);
  assert.equal(owed.find((l) => l.cancelReason === 'settled').stayMissing, false);
});

test('rule 67 — not connected: listed as urgent with the action; connected: listed as being deactivated; settled: gone', async () => {
  const ctx = seed();
  ctx.owe(922299, 'orphan');
  ctx.owe(922300, 'orphan');

  const offline = owedDeactivations(ctx.links, { active: () => null, declared: () => null });
  assert.equal(offline.links.length, 2);
  assert.equal(offline.retrying, 0);
  assert.equal(offline.links[0].providerLabel, 'Qonto');
  const offlineSummary = CORE_SUMMARIES['payment-deactivations'](offline);
  assert.deepEqual(offlineSummary, {
    count: 2, title: 'Liens de paiement encore actifs', detail: 'À désactiver depuis Qonto, ou en rétablissant la connexion', severity: 'urgent',
  });

  const provider = fakeProvider();
  const connected = owedDeactivations(ctx.links, providers(provider));
  assert.equal(connected.retrying, 2);
  const connectedSummary = CORE_SUMMARIES['payment-deactivations'](connected);
  assert.equal(connectedSummary.detail, 'Désactivation en cours chez Qonto');
  assert.equal(connectedSummary.severity, 'todo');
  const inbox = buildAttention([{ key: 'payment-deactivations', rank: 35, summary: offlineSummary, failed: false }]);
  assert.equal(inbox.pinned.length + inbox.items.length, 1);

  await run(ctx, provider);
  assert.equal(CORE_SUMMARIES['payment-deactivations'](owedDeactivations(ctx.links, providers(provider))), null);
});

test('rule 67 — a refused deactivation keeps the link listed and retried', async () => {
  const ctx = seed();
  const id = ctx.owe(922299, 'orphan');
  const provider = fakeProvider({ failCancel: new Error('503 Service Unavailable'), linkStatus: 'open' });
  const summary = await run(ctx, provider);
  assert.equal(summary.results[0].status, 'deactivation-pending');
  assert.deepEqual(ctx.links.listOwedDeactivations().map((l) => l.id), [id]);
});

test('rule 67 — the boot warning no longer tells the operator to deactivate by hand', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.js'), 'utf8');
  assert.ok(!source.includes('to deactivate by hand at the provider'));
  assert.match(source, /payment poll deactivates them while the provider is connected/);
});
