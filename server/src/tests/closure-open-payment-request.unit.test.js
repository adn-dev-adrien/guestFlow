// specs/payment-link-lifecycle.md rules 40 and 41 — a closure is refused over a reservation, and over an open
// payment request (a devis or fiche with an open link on its nights), with the stays listed for the dialog; the
// `conflicts` endpoint answers the same checks before Save.
const test = require('node:test');
const assert = require('node:assert/strict');

const { seedClosures, stay, call, inDays, addLink, dayLabel } = require('./closureConflictsFixture');

const closure = (from, to, propertyId = 1) => ({ propertyId, label: 'Travaux', startDate: inDays(from), endDate: inDays(to) });

test('rule 40: a closure over a reservation is refused, worded short, with every stay listed and linked', () => {
  const { db, controller } = seedClosures();
  const first = stay(db, { from: 30, to: 33, number: '22341' });
  const second = stay(db, { from: 34, to: 36, number: '22342' });
  const res = call(controller.create, { body: closure(29, 40) });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RESERVATION_OVERLAP');
  assert.equal(res.body.error, 'Réservation sur ces dates : fermeture impossible.');
  assert.deepEqual(res.body.reservations.map((r) => [r.id, r.url]), [[first, `/reservations/${first}`], [second, `/reservations/${second}`]]);
  const [d1, d2] = [inDays(30), inDays(33)].map((iso) => dayLabel(iso, inDays(29)));
  assert.equal(res.body.reservations[0].label, `22341 · Ana Test · ${d1} → ${d2}`);
  assert.equal(res.body.reservations[0].detail, 'Gite');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM establishment_closures').get().n, 0);
});

test('rule 41: an open link on a devis refuses the closure with its request listed', () => {
  const { db, links, controller } = seedClosures();
  const devis = stay(db, { kind: 'devis', from: 40, to: 44, number: 'D-2026-118' });
  const link = addLink(links, db, devis, { type: 'full', amountCents: 84000, expiresAt: new Date(Date.now() + 30 * 3600 * 1000) });
  const res = call(controller.create, { body: closure(41, 42) });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'OPEN_PAYMENT_REQUEST');
  assert.equal(res.body.error, 'Demande de paiement en cours sur ces dates : la retirer avant d’enregistrer la fermeture.');
  const [request] = res.body.requests;
  assert.equal(request.reservationId, devis);
  assert.equal(request.linkId, link.id);
  assert.equal(request.kind, 'devis');
  assert.equal(request.label, 'Devis D-2026-118 · Ana Test');
  assert.equal(request.amountLabel, '840,00\u00a0€');
  assert.match(request.validUntilLabel, /^lien valable jusqu’au \d{2}\/\d{2}(\/\d{4})? à \d{2}:\d{2}$/);
  assert.equal(request.detail, `840,00\u00a0€ · ${request.validUntilLabel}`);
  assert.equal(request.url, `/reservations/new?mode=devis&devisId=${devis}`);
});

test('rule 41: once the link is withdrawn the same closure saves', () => {
  const { db, links, controller } = seedClosures();
  const devis = stay(db, { kind: 'devis', from: 40, to: 44, number: 'D-1' });
  const link = addLink(links, db, devis, { type: 'deposit' });
  assert.equal(call(controller.create, { body: closure(40, 41) }).statusCode, 409);
  links.cancelIfOpen(link.id, { reason: 'operator' });
  const res = call(controller.create, { body: closure(40, 41) });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.id);
});

test('rule 41: order of the checks — INVALID_RANGE, INVALID_PROPERTY, RESERVATION_OVERLAP, OPEN_PAYMENT_REQUEST, CLOSURE_OVERLAP', () => {
  const { db, links, controller } = seedClosures();
  assert.equal(call(controller.create, { body: { ...closure(10, 12), propertyId: 99, endDate: inDays(5) } }).body.code, 'INVALID_RANGE');
  assert.equal(call(controller.create, { body: { ...closure(10, 12), propertyId: 99 } }).body.code, 'INVALID_PROPERTY');
  assert.equal(call(controller.create, { body: closure(50, 52) }).statusCode, 200);
  stay(db, { from: 50, to: 51 });
  const devis = stay(db, { kind: 'devis', from: 50, to: 52 });
  addLink(links, db, devis);
  assert.equal(call(controller.create, { body: closure(50, 52) }).body.code, 'RESERVATION_OVERLAP');
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE kind = 'reservation'").run();
  assert.equal(call(controller.create, { body: closure(50, 52) }).body.code, 'OPEN_PAYMENT_REQUEST');
  db.prepare("UPDATE payment_links SET status = 'cancelled'").run();
  assert.equal(call(controller.create, { body: closure(50, 52) }).body.code, 'CLOSURE_OVERLAP');
});

test('rule 41: an establishment-wide closure meets every logement; another logement is never concerned', () => {
  const { db, links, controller } = seedClosures();
  const tent = stay(db, { kind: 'devis', from: 20, to: 22, propertyId: 2 });
  addLink(links, db, tent);
  assert.equal(call(controller.create, { body: closure(20, 21, 1) }).statusCode, 200);
  const res = call(controller.create, { body: closure(20, 21, null) });
  assert.equal(res.body.code, 'OPEN_PAYMENT_REQUEST');
  assert.deepEqual(res.body.requests.map((r) => r.reservationId), [tent]);
});

test('rule 41: the nights decide — a devis leaving the day the closure starts is not on it', () => {
  const { db, links, controller } = seedClosures();
  const before = stay(db, { kind: 'devis', from: 10, to: 14 });
  addLink(links, db, before);
  assert.equal(call(controller.create, { body: closure(14, 16) }).statusCode, 200);
});

test('rule 41: a paid, lapsed or withdrawn link, and a converted devis, are no open request', () => {
  const { db, links, controller } = seedClosures();
  for (const status of ['paid', 'expired', 'cancelled']) addLink(links, db, stay(db, { kind: 'devis', from: 60, to: 62 }), { status });
  addLink(links, db, stay(db, { kind: 'devis', from: 60, to: 62, devisStatus: 'converted' }));
  const res = call(controller.conflicts, { query: { propertyId: '1', startDate: inDays(60), endDate: inDays(61) } });
  assert.deepEqual(res.body.requests, []);
});

test('rule 41: an update is judged the same way, its own closure aside', () => {
  const { db, links, controller } = seedClosures();
  const saved = call(controller.create, { body: closure(70, 72) });
  addLink(links, db, stay(db, { kind: 'devis', from: 73, to: 75 }));
  assert.equal(call(controller.update, { params: { id: saved.body.id }, body: closure(70, 72) }).statusCode, 200);
  const moved = call(controller.update, { params: { id: saved.body.id }, body: closure(72, 74) });
  assert.equal(moved.body.code, 'OPEN_PAYMENT_REQUEST');
});

test('rule 41: GET conflicts answers the reservations and the requests, read-only, without listing a blocking stay twice', () => {
  const { db, links, controller } = seedClosures();
  const resa = stay(db, { from: 80, to: 82, number: '22400' });
  addLink(links, db, resa, { type: 'balance' });
  const devis = stay(db, { kind: 'devis', from: 81, to: 84 });
  addLink(links, db, devis);
  const res = call(controller.conflicts, { query: { propertyId: 'ALL', startDate: inDays(80), endDate: inDays(85) } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.reservations.map((r) => r.id), [resa]);
  assert.deepEqual(res.body.requests.map((r) => r.reservationId), [devis]);
  assert.deepEqual(res.body.devis, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM establishment_closures').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payment_links WHERE status = 'open'").get().n, 2);
});

test('rule 41: GET conflicts refuses an invalid range or an unknown logement', () => {
  const { controller } = seedClosures();
  assert.equal(call(controller.conflicts, { query: { startDate: inDays(5), endDate: inDays(5) } }).body.code, 'INVALID_RANGE');
  assert.equal(call(controller.conflicts, { query: { propertyId: '99', startDate: inDays(5), endDate: inDays(6) } }).body.code, 'INVALID_PROPERTY');
});

test('rule 40: findReservationOverlap (one row, the tariff-recipes plugin) is unchanged next to the list', () => {
  const { db } = seedClosures();
  const model = require('../models/establishmentClosuresModel').create(db);
  const a = stay(db, { from: 90, to: 92 });
  stay(db, { from: 93, to: 95 });
  assert.equal(model.findReservationOverlap(1, inDays(89), inDays(96)).id, a);
  assert.equal(model.findReservationOverlaps(1, inDays(89), inDays(96)).length, 2);
});
