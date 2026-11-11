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

// date-literal-ok: instants around the validity of a fixture link
const LAPSED_AT = new Date('2026-01-01T00:00:00Z');

test('rule 67 — disconnected, before any lifecycle pass: an open link of a missing, cancelled or set-aside stay, or past its validity, is listed', () => {
  const ctx = seed();
  const orphan = addLink(ctx.links, ctx.db, 987654);
  const lapsed = addLink(ctx.links, ctx.db, ctx.stay, { expiresAt: LAPSED_AT });
  // date-literal-ok: stay nights nothing compares with today
  const cancelledStay = addStay(ctx.db, { kind: 'cancelled', startDate: '2027-08-10', endDate: '2027-08-12' });
  const ofCancelled = addLink(ctx.links, ctx.db, cancelledStay);
  // date-literal-ok: stay nights nothing compares with today
  const setAside = addStay(ctx.db, { kind: 'superseded', startDate: '2027-09-10', endDate: '2027-09-12' });
  const ofSetAside = addLink(ctx.links, ctx.db, setAside);
  const live = addLink(ctx.links, ctx.db, ctx.stay, { type: 'balance' });
  const noProviderId = addLink(ctx.links, ctx.db, 987655, { providerLinkId: null });
  const off = { active: () => null, declared: () => null };

  const owed = owedDeactivations(ctx.links, off, NOW);
  assert.deepEqual(owed.links.map((l) => l.id), [orphan.id, lapsed.id, ofCancelled.id, ofSetAside.id]);
  assert.ok(!owed.links.some((l) => l.id === live.id || l.id === noProviderId.id), 'a live link, or one with nothing to deactivate, is not owed');
  assert.equal(owed.links[0].stayMissing, true);
  assert.equal(owed.retrying, 0);
  assert.equal(CORE_SUMMARIES['payment-deactivations'](owed).severity, 'urgent');
});

test('rule 67 — the converted devis branch: an open link of a devis whose stay was cancelled or set aside is listed, a live one is not', () => {
  const ctx = seed();
  const mk = (kind, startDate, endDate) => {
    const devis = addStay(ctx.db, { kind: 'devis', startDate, endDate });
    const stay = addStay(ctx.db, { kind, startDate, endDate });
    ctx.db.prepare('UPDATE reservations SET convertedReservationId = ? WHERE id = ?').run(stay, devis);
    return addLink(ctx.links, ctx.db, devis);
  };
  // date-literal-ok: stay nights nothing compares with today
  const ofCancelled = mk('cancelled', '2027-10-01', '2027-10-03');
  // date-literal-ok: stay nights nothing compares with today
  const ofSetAside = mk('superseded', '2027-11-01', '2027-11-03');
  // date-literal-ok: stay nights nothing compares with today
  const ofLive = mk('reservation', '2027-12-01', '2027-12-03');
  const ids = ctx.links.listOwedDeactivations({ now: NOW }).map((l) => l.id);
  assert.deepEqual(ids, [ofCancelled.id, ofSetAside.id]);
  assert.ok(!ids.includes(ofLive.id));
});

// date-literal-ok: fixed instants around midnight Paris on a fixture arrival day
test('rule 67 — a pre-arrival link lapses at 00:00 Paris on the arrival day: listed from then although its validity is still ahead', () => {
  const ctx = seed();
  // date-literal-ok: fixed instants around midnight Paris on a fixture arrival day
  const arrivalDay = '2026-11-05';
  // date-literal-ok: fixed instants around midnight Paris on a fixture arrival day
  const stay = addStay(ctx.db, { startDate: arrivalDay, endDate: '2026-11-08' });
  const created = new Date(NOW.getTime() - 20 * 60 * 60 * 1000);
  const link = addLink(ctx.links, ctx.db, stay, { createdAt: created, expiresAt: new Date(NOW.getTime() + 16 * 60 * 60 * 1000) });
  const complement = addLink(ctx.links, ctx.db, stay, { type: 'complement', createdAt: created, expiresAt: new Date(NOW.getTime() + 16 * 60 * 60 * 1000) });
  const day = (iso) => ctx.links.listOwedDeactivations({ now: new Date(iso) }).map((l) => l.id);
  // date-literal-ok: fixed instants around midnight Paris on a fixture arrival day
  assert.deepEqual(day('2026-11-04T21:00:00Z'), [], 'the day before the arrival (Paris): nothing yet');
  // date-literal-ok: fixed instants around midnight Paris on a fixture arrival day
  assert.deepEqual(day('2026-11-04T23:30:00Z'), [link.id], 'past midnight in Paris: the pre-arrival link, not the complement');
  // date-literal-ok: fixed instants around midnight Paris on a fixture arrival day
  assert.ok(!day('2026-11-04T23:30:00Z').includes(complement.id));
});

test('rule 67 — each row says what the operator needs to find the link by hand: kind, amount, reference, stay, reason, date', () => {
  const ctx = seed();
  const id = ctx.owe(922299, 'orphan', { type: 'full', amountCents: 76280, providerLinkId: 'pl_ref_13' });
  ctx.db.prepare("UPDATE payment_links SET remoteCancelPendingAt = '2026-10-30T10:00:00.000Z' WHERE id = ?").run(id);
  const lapsed = addLink(ctx.links, ctx.db, ctx.stay, { type: 'deposit', amountCents: 9000, providerLinkId: 'pl_ref_lapsed', expiresAt: new Date('2026-11-01T09:00:00Z') });
  const [orphan, late] = owedDeactivations(ctx.links, { active: () => null, declared: () => null }, NOW).links;
  assert.equal(orphan.id, id);
  assert.deepEqual(
    { kind: orphan.kindLabel, amount: orphan.amountLabel, reference: orphan.reference, stay: orphan.stayLabel, url: orphan.stayUrl, reason: orphan.reasonLabel, since: orphan.sinceLabel, provider: orphan.providerLabel },
    { kind: 'Paiement total', amount: '762,80\u00a0€', reference: 'pl_ref_13', stay: 'Séjour n° 922299', url: null, reason: 'Séjour supprimé', since: 'le 30/10/2026', provider: 'Qonto' },
  );
  assert.equal(late.id, lapsed.id);
  assert.deepEqual({ kind: late.kindLabel, reason: late.reasonLabel, since: late.sinceLabel, url: late.stayUrl }, { kind: 'Acompte', reason: 'Validité dépassée', since: 'le 01/11/2026', url: `/reservations/${ctx.stay}` });
});

test('rule 67 — the card\'s list is served at GET /api/dashboard/payment-deactivations, admin only', () => {
  const router = require('../routes/dashboard');
  const layer = router.stack.find((l) => l.route && l.route.path === '/payment-deactivations');
  assert.ok(layer && layer.route.methods.get);
  const enforceRoleAccess = require('../middleware/enforceRoleAccess');
  const call = (roles) => {
    const req = { user: { roles }, method: 'GET', path: '/dashboard/payment-deactivations' };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
    let passed = false;
    enforceRoleAccess(req, res, () => { passed = true; });
    return passed;
  };
  assert.equal(call(['reception']), false);
  assert.equal(call(['admin']), true);
});
