/**
 * specs/shell-and-home-day-first.md §3.B — the home's attention payload: summaries, order, pinned
 * subjects, total, failing sources, and the plugin subjects declared with ctx.attention.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { payloadOf } = require('../utils/handlerPayload');
const { CORE_SUMMARIES, buildAttention, PINNABLE_KEYS } = require('../utils/dashboardAttention');
const { buildController, livePluginSources } = require('../controllers/dashboardAttentionController');
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');

const gate = require('../plugins/gate-access/attention');
const linen = require('../plugins/linen/attention');
const recipes = require('../plugins/tariff-recipes/attention');
const gdf = require('../plugins/gites-de-france-intake/attention');
const booking = require('../plugins/booking-intake/attention');
const site = require('../plugins/website-booking/attention');

const fakeRes = () => {
  const res = { body: undefined, statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

test('rule 7: payloadOf returns the JSON a handler answers, sync or async, with the caller session', async () => {
  const req = { session: { user: { id: 3 } }, query: { a: '1' } };
  assert.deepEqual(await payloadOf((r, res) => res.json({ who: r.session.user.id }), req), { ok: true, body: { who: 3 } });
  assert.deepEqual(await payloadOf(async (r, res) => { await null; res.json({ q: r.query }); }, req, { query: { b: '2' } }), { ok: true, body: { q: { a: '1', b: '2' } } });
  assert.deepEqual(req.query, { a: '1' }, 'the caller request is left untouched');
});

test('rule 20: payloadOf reports a failure — error status, throw, next() or no answer — with its reason', async () => {
  assert.deepEqual(await payloadOf((r, res) => res.status(500).json({ error: 'DB_DOWN' }), {}), { ok: false, reason: 'HTTP 500 DB_DOWN' });
  assert.deepEqual(await payloadOf(() => { throw new Error('boom'); }, {}), { ok: false, reason: 'boom' });
  assert.deepEqual(await payloadOf(async () => { throw new Error('late boom'); }, {}), { ok: false, reason: 'late boom' });
  assert.deepEqual(await payloadOf((r, res, next) => next(new Error('x')), {}), { ok: false, reason: 'x' });
  assert.deepEqual(await payloadOf(() => {}, {}), { ok: false, reason: 'no answer' });
});

test('rule 6: payment deadlines — count, « N en retard · M à demander », worst row severity', () => {
  const rows = [
    { state: 'deposit_overdue', severity: 'warning' },
    { state: 'cancel_due', severity: 'error' },
    { state: 'deposit_to_request', severity: 'info' },
  ];
  assert.deepEqual(CORE_SUMMARIES['payment-deadlines']({ rows }), {
    count: 3, title: 'Échéances de paiement', detail: '2 en retard · 1 à demander', severity: 'urgent', pinned: true,
  });
  assert.equal(CORE_SUMMARIES['payment-deadlines']({ rows: [{ state: 'balance_to_request', severity: 'info' }] }).detail, '1 à demander');
  assert.equal(CORE_SUMMARIES['payment-deadlines']({ rows: [{ state: 'balance_to_request', severity: 'info' }] }).severity, 'info');
  assert.equal(CORE_SUMMARIES['payment-deadlines']({ rows: [] }), null);
});

test('rule 21: payment deadlines are pinned only while a line is truly late; a missing amount is not « en retard »', () => {
  const pay = CORE_SUMMARIES['payment-deadlines'];
  ['deposit_overdue', 'balance_overdue', 'cancel_due', 'unpaid_at_arrival', 'platform_payout_overdue'].forEach((state) => {
    assert.equal(pay({ rows: [{ state, severity: 'warning' }] }).pinned, true, state);
  });
  const todo = pay({ rows: [{ state: 'deposit_to_request', severity: 'info' }, { state: 'platform_amount_missing', severity: 'warning' }] });
  assert.equal(todo.pinned, false);
  assert.equal(todo.detail, '1 à demander · 1 montant à saisir');
  const out = buildAttention([{ key: 'payment-deadlines', rank: 20, summary: todo }]);
  assert.deepEqual(out.pinned, []);
  assert.deepEqual(out.items.map((x) => x.key), ['payment-deadlines']);
  assert.equal(out.total, 2);
  assert.equal(pay({ rows: [{ state: 'platform_amount_missing', severity: 'warning' }, { state: 'platform_amount_missing', severity: 'warning' }] }).detail, '2 montants à saisir');
});

test('rule 6: core subjects — titles, plurals and severities come from the server', () => {
  assert.deepEqual(CORE_SUMMARIES['ical-date-drift']({ alerts: [{}, {}] }),
    { count: 2, title: 'Dates iCal à valider', detail: '2 changements de dates', severity: 'todo' });
  assert.equal(CORE_SUMMARIES['ical-cancellation']({ alerts: [{}] }).detail, '1 réservation annulée sur la plateforme');
  assert.equal(CORE_SUMMARIES['cancellation-compensations']({ pending: [{}, {}] }).detail, '2 versements attendus');
  assert.equal(CORE_SUMMARIES['repaired-reservation-numbers']({ alerts: [{}] }).count, 1);
  assert.equal(CORE_SUMMARIES['email-readiness']({ soonCount: 3 }).detail, '3 points à compléter avant les prochaines arrivées');
  assert.equal(CORE_SUMMARIES['email-readiness']({ soonCount: 0 }), null);
  assert.equal(CORE_SUMMARIES['new-reservations']({ alerts: [{}] }).severity, 'info');
  assert.equal(CORE_SUMMARIES['email-pending']([{ clientEmail: 'a@b.fr' }, { clientEmail: '' }]).detail, '2 messages à envoyer · 1 client sans adresse');
  assert.equal(CORE_SUMMARIES['email-pending']([{ clientEmail: 'a@b.fr' }]).detail, '1 message à envoyer');
  assert.equal(CORE_SUMMARIES['email-pending']([]), null);
});

test('rules 6, 8: an update shows unless postponed or running; the 2FA nudge follows the server', () => {
  const info = { updateAvailable: true, latest: '3.11.0', current: '3.10.0', dismissedVersion: null, updateInProgress: false };
  assert.deepEqual(CORE_SUMMARIES['update-available'](info),
    { count: 1, title: 'GuestFlow 3.11.0 disponible', detail: 'Version installée : 3.10.0', severity: 'info' });
  assert.equal(CORE_SUMMARIES['update-available']({ ...info, dismissedVersion: '3.11.0' }), null);
  assert.equal(CORE_SUMMARIES['update-available']({ ...info, updateInProgress: true }), null);
  assert.equal(CORE_SUMMARIES['update-available']({ ...info, updateAvailable: false }), null);
  assert.equal(CORE_SUMMARIES['two-factor']({ nudge: true }).title, 'Second code de connexion');
  assert.equal(CORE_SUMMARIES['two-factor']({ nudge: false }), null);
});

test('rules 3, 5: order by severity then rank; gate keys and payments pinned; total counts the box only', () => {
  const s = (count, severity, title = 'T') => ({ count, severity, title, detail: '' });
  const out = buildAttention([
    { key: 'email-pending', rank: 30, summary: s(2, 'info') },
    { key: 'new-reservations', rank: 10, summary: s(1, 'info') },
    { key: 'ical-cancellation', rank: 20, summary: s(1, 'todo') },
    { key: 'linen-shortage', rank: 30, summary: s(4, 'urgent') },
    { key: 'payment-deadlines', rank: 20, summary: s(2, 'todo') },
    { key: 'gate-keys', rank: 10, summary: s(1, 'urgent') },
    { key: 'ical-date-drift', rank: 10, summary: s(3, 'todo') },
    { key: 'nothing', rank: 1, summary: null },
    { key: 'zero', rank: 1, summary: s(0, 'urgent') },
  ]);
  assert.deepEqual(out.pinned.map((x) => x.key), ['gate-keys', 'payment-deadlines']);
  assert.deepEqual(out.items.map((x) => x.key), ['linen-shortage', 'ical-date-drift', 'ical-cancellation', 'new-reservations', 'email-pending']);
  assert.equal(out.total, 4 + 3 + 1 + 1 + 2);
  assert.deepEqual(Object.keys(out.items[0]).sort(), ['count', 'detail', 'key', 'severity', 'title']);
  assert.deepEqual([...PINNABLE_KEYS].sort(), ['gate-keys', 'payment-deadlines']);
  assert.deepEqual(out.unavailable, []);
  // A key that may not be pinned stays in the box even when its summary asks.
  assert.deepEqual(buildAttention([{ key: 'linen-shortage', rank: 1, summary: { ...s(1, 'urgent'), pinned: true } }]).pinned, []);
});

test('rules 4, 20: the controller reads every source; a failing one is logged and named, the others stay', async () => {
  const warnings = [];
  const controller = buildController({
    logger: { warn: (line) => warnings.push(line) },
    coreSources: () => [
      { key: 'ical-date-drift', rank: 10, handler: (req, res) => res.json({ alerts: [{}, {}] }) },
      { key: 'ical-cancellation', rank: 20, handler: () => { throw new Error('db down'); } },
      { key: 'new-reservations', rank: 10, handler: (req, res) => res.status(500).json({}) },
      { key: 'two-factor', rank: 50, handler: (req, res) => res.json({ nudge: true }), skip: (req) => req.session.user.isSupport },
      {
        key: 'cancellation-compensations',
        rank: 30,
        handler: (req, res) => res.json({ pending: req.query.month === '10' ? [{}] : [] }),
        query: () => ({ month: '10', year: '2026' }),
      },
    ],
    pluginSources: () => [
      { key: 'site-requests', rank: 20, handler: (req, res) => res.json({ alerts: [{}] }), summarize: site.summarize },
      { key: 'gate-keys', rank: 10, handler: (req, res) => res.status(503).json({ error: 'SOWEL' }), summarize: gate.summarize },
    ],
  });
  const res = fakeRes();
  await controller.attention({ session: { user: { id: 1, isSupport: false } }, query: {} }, res);
  assert.deepEqual(res.body.items.map((x) => x.key), ['ical-date-drift', 'cancellation-compensations', 'site-requests', 'two-factor']);
  assert.equal(res.body.total, 5);
  assert.deepEqual(res.body.unavailable.sort(), ['ical-cancellation', 'new-reservations']);
  assert.equal(res.body.unavailableLabel, '2 sujets indisponibles');
  // The gate keys cannot be read: still pinned, urgent, and saying so.
  assert.deepEqual(res.body.pinned, [{ key: 'gate-keys', severity: 'urgent', count: 1, title: 'Clés portail', detail: 'Lecture des clés impossible' }]);
  assert.deepEqual(res.body.declared.sort(), ['cancellation-compensations', 'gate-keys', 'ical-cancellation', 'ical-date-drift', 'new-reservations', 'site-requests', 'two-factor']);
  assert.deepEqual(warnings.sort(), [
    '[attention] source gate-keys failed: HTTP 503 SOWEL',
    '[attention] source ical-cancellation failed: db down',
    '[attention] source new-reservations failed: HTTP 500',
  ]);

  const support = fakeRes();
  await controller.attention({ session: { user: { id: 1, isSupport: true } }, query: {} }, support);
  assert.ok(!support.body.items.some((x) => x.key === 'two-factor'), 'a support session gets no 2FA nudge');
});

test('rule 20: one unavailable subject reads « 1 sujet indisponible »', () => {
  const out = buildAttention([{ key: 'email-pending', rank: 30, failed: true, summary: null }]);
  assert.deepEqual(out.unavailable, ['email-pending']);
  assert.equal(out.unavailableLabel, '1 sujet indisponible');
  assert.equal(buildAttention([]).unavailableLabel, '');
});

test('rule 9: ctx.attention declares a plugin subject; only live plugins contribute', () => {
  registry.reset();
  registry.configure({ isActive: (id) => id === 'p-live', allows: () => true });
  const handler = (req, res) => res.json({});
  createContext('p-live', {}).attention({ key: 'k-live', rank: 5, handler, summarize: () => null });
  createContext('p-off', {}).attention({ key: 'k-off', rank: 5, handler, summarize: () => null });
  assert.deepEqual(livePluginSources(registry).map((s) => s.key), ['k-live']);
  assert.throws(() => createContext('p-live', {}).attention({ key: 'k-off', handler, summarize: () => null }), /already declared/);
  assert.throws(() => createContext('p-live', {}).attention({ key: 'x', handler }), /summarize/);
  registry.reset();
});

test('rule 6: plugin subjects — gate keys, linen, recipes, Gîtes de France, Booking, site', () => {
  assert.deepEqual(gate.summarize({ failures: [{}, {}], stale: true }),
    { count: 3, title: 'Clés portail', detail: 'Sowel ne lit plus les clés · 2 clés en échec', severity: 'urgent' });
  assert.equal(gate.summarize({ failures: [], stale: false }), null);
  const now = new Date('2026-10-19T10:00:00Z');
  assert.equal(linen.summarize({ shortagesByType: [{ firstShortageDate: '2026-10-23' }, { firstShortageDate: '2026-10-21' }] }, now).detail,
    '2 types en rupture à partir du 21 octobre');
  assert.equal(linen.summarize({ shortagesByType: [{ firstShortageDate: '2027-01-04' }] }, now).detail,
    '1 type en rupture à partir du 4 janvier 2027');
  assert.equal(linen.summarize({ shortagesByType: [] }), null);
  assert.equal(recipes.summarize({ runs: [{ blocking: 0 }], missingEvents: [] }).severity, 'info');
  assert.equal(recipes.summarize({ runs: [{ blocking: 1 }], missingEvents: [] }).severity, 'todo');
  assert.equal(recipes.summarize({ runs: [], missingEvents: [{}] }).detail, '1 point à relire');
  assert.equal(gdf.summarize({ items: [{}, {}] }).detail, '2 mails');
  const pending = [{ urgent: true }, { urgent: false }, { urgent: false }];
  assert.deepEqual(booking.summarizeUrgent(pending),
    { count: 1, title: 'Réservations Booking à compléter, arrivée proche', detail: '1 fiche à compléter', severity: 'urgent' });
  assert.equal(booking.summarizeLater(pending).count, 2);
  assert.equal(booking.summarizeLater([]), null);
  assert.equal(site.summarize({ alerts: [{}, {}, {}] }).detail, '3 devis en attente');
});
