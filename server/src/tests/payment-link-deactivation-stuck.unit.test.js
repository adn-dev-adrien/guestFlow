// specs/payment-link-lifecycle.md rules 18, 20, 21 — a lapsed link the provider refuses to deactivate keeps
// its marker and is retried at every pass; after 24 hours of failures the admin is told once, in the
// plugins-phase-3a rule 9 wording; a rate limit stops the pass and the rest waits.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink, fakeProvider, rateLimited, spies, HOUR } = require('./paymentLinkLifecycleFixture');
const { runLinkLifecycle } = require('../utils/paymentPollRunner');
const { buildNotificationService } = require('../utils/notificationService');
const { DEACTIVATION_ALERT_AFTER_HOURS } = require('../constants/paymentLinks');

const LAPSE = new Date('2026-11-03T20:00:00Z');
const at = (hours) => new Date(LAPSE.getTime() + hours * HOUR);
const down = () => fakeProvider({ failCancel: new Error('503 Service Unavailable') });

function setup(count = 1) {
  const { db, links, devis } = seedDb();
  const stay = addStay(db);
  const created = new Date(LAPSE.getTime() - 36 * HOUR);
  const ids = Array.from({ length: count }, (_, i) => addLink(links, db, stay, { type: i ? 'balance' : 'deposit', createdAt: created, expiresAt: LAPSE }).id);
  const s = spies();
  const run = (provider, now) => runLinkLifecycle({ database: db, paymentLinksModel: links, provider, devisModel: devis, now, ...s });
  return { db, links, stay, ids, s, run };
}

test('rule 18 — a refused deactivation keeps the marker: the link stays expired and owed, retried next pass', async () => {
  const { links, ids, run } = setup();
  const summary = await run(down(), at(0.1));
  const row = links.findById(ids[0]);
  assert.equal(row.status, 'expired');
  assert.ok(row.remoteCancelPendingAt);
  assert.equal(summary.results[0].status, 'deactivation-pending');

  const back = fakeProvider();
  await run(back, at(1));
  assert.deepEqual(back.calls.map((c) => c[0]), ['cancelLink', 'getPayment']);
  assert.equal(links.findById(ids[0]).remoteCancelPendingAt, null);
});

test('rule 20 — one alert after 24 hours of failures, never before, never twice', async () => {
  assert.equal(DEACTIVATION_ALERT_AFTER_HOURS, 24);
  const { db, ids, s, run } = setup();
  await run(down(), at(0));
  await run(down(), at(23.9));
  assert.deepEqual(s.stuck, [], 'under 24 h: nothing yet');

  await run(down(), at(24));
  assert.deepEqual(s.stuck, [[ids[0], { providerLabel: 'Qonto' }]]);
  assert.ok(db.prepare('SELECT deactivationAlertedAt FROM payment_links WHERE id = ?').get(ids[0]).deactivationAlertedAt);

  await run(down(), at(48));
  assert.equal(s.stuck.length, 1, 'stamped: sent once');
});

test('rule 20 — no alert for a withdrawn link: plugins-phase-3a rule 8 handles it as before', async () => {
  const { db, links, s, run } = setup();
  const stay = addStay(db, { kind: 'cancelled' });
  const withdrawn = addLink(links, db, stay);
  await run(down(), at(0));
  db.prepare('UPDATE payment_links SET remoteCancelPendingAt = ? WHERE id = ?').run(at(-30).toISOString(), withdrawn.id);
  await run(down(), at(30));
  assert.equal(s.stuck.filter(([id]) => id === withdrawn.id).length, 0);
});

test('rule 20 — the alert reads « Lien de paiement encore actif chez Qonto : à désactiver depuis Qonto. », with the fiche', async () => {
  const { db, links, stay, ids } = setup();
  const sent = [];
  const pushes = [];
  const service = buildNotificationService({
    db,
    settingsModel: {
      notificationSettings: () => ({ enabled: true, recipientEmail: 'admin@example.test', publicUrl: 'https://gf.example.test' }),
      smtpConfigured: () => true,
      decryptedSmtpSettings: () => ({}),
    },
    emailServiceFactory: () => ({ isConfigured: true, send: async (m) => { sent.push(m); } }),
    pushService: { sendToPref: async (_pref, payload) => { pushes.push(payload); } },
    logger: { warn() {} },
  });

  const res = await service.notifyDeactivationStuck(links.findById(ids[0]), { providerLabel: 'Qonto' });

  assert.equal(res.sent, true);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].body, 'Lien de paiement encore actif chez Qonto : à désactiver depuis Qonto.');
  assert.equal(pushes[0].url, `/reservations/${stay}`);
  assert.match(sent[0].subject, /^Lien de paiement encore actif chez Qonto — 90,00/);
  assert.match(sent[0].text, /^Lien de paiement encore actif chez Qonto : à désactiver depuis Qonto\./);
  assert.match(sent[0].text, new RegExp(`Ouvrir la réservation : https://gf\\.example\\.test/reservations/${stay}`));
});

test('rules 18, 21 — a rate limit stops the pass: the next link waits for the next run', async () => {
  const { links, ids, run } = setup(2);
  const limited = fakeProvider({ failCancel: rateLimited() });
  const summary = await run(limited, at(0.1));
  assert.equal(summary.stoppedBy, 'rate-limit');
  assert.deepEqual(limited.calls.map((c) => c[0]), ['cancelLink'], 'the second link was not asked');
  ids.forEach((id) => assert.ok(links.findById(id).remoteCancelPendingAt));
});

test('rule 21 — a rate limit on the read after the deactivation keeps the marker too', async () => {
  const { links, ids, run } = setup();
  const summary = await run(fakeProvider({ failPayment: rateLimited() }), at(0.1));
  assert.equal(summary.stoppedBy, 'rate-limit');
  assert.ok(links.findById(ids[0]).remoteCancelPendingAt, 'the payment was not read: the pair is retried');
});
