// specs/payment-link-lifecycle.md rule 49 — a closure over a devis that holds no open link warns
// (« Devis en cours sur ces dates. », one « Ouvrir » per devis) and saves: there is nothing to withdraw.
const test = require('node:test');
const assert = require('node:assert/strict');

const { seedClosures, stay, call, inDays, addLink, dayLabel } = require('./closureConflictsFixture');

const fmt = (iso) => dayLabel(iso, inDays(29));

test('rule 49: a devis without a link is listed by GET conflicts, shaped for its warning line', () => {
  const { db, controller } = seedClosures();
  const devis = stay(db, { kind: 'devis', from: 30, to: 32, number: 'D-2026-121' });
  const res = call(controller.conflicts, { query: { propertyId: '1', startDate: inDays(29), endDate: inDays(31) } });
  assert.deepEqual(res.body.reservations, []);
  assert.deepEqual(res.body.requests, []);
  assert.deepEqual(res.body.devis, [{
    reservationId: devis,
    label: 'Devis D-2026-121 · Ana Test',
    detail: `Gite · ${fmt(inDays(30))} → ${fmt(inDays(32))} · aucun lien en cours`,
    url: `/reservations/new?mode=devis&devisId=${devis}`,
  }]);
});

test('rule 49: the closure over it saves', () => {
  const { db, controller } = seedClosures();
  stay(db, { kind: 'devis', from: 30, to: 32 });
  const res = call(controller.create, { body: { propertyId: 1, startDate: inDays(30), endDate: inDays(31) } });
  assert.equal(res.statusCode, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM establishment_closures').get().n, 1);
});

test('rule 49: a devis whose link lapsed or was withdrawn warns only; one with an open link is a request instead', () => {
  const { db, links, controller } = seedClosures();
  const lapsed = stay(db, { kind: 'devis', from: 40, to: 42 });
  addLink(links, db, lapsed, { status: 'expired' });
  const open = stay(db, { kind: 'devis', from: 40, to: 42 });
  addLink(links, db, open);
  const res = call(controller.conflicts, { query: { startDate: inDays(40), endDate: inDays(41) } });
  assert.deepEqual(res.body.devis.map((d) => d.reservationId), [lapsed]);
  assert.deepEqual(res.body.requests.map((r) => r.reservationId), [open]);
});

test('rule 49: a converted devis and a devis on another logement give no warning', () => {
  const { db, controller } = seedClosures();
  stay(db, { kind: 'devis', from: 50, to: 52, devisStatus: 'converted' });
  stay(db, { kind: 'devis', from: 50, to: 52, propertyId: 2 });
  const res = call(controller.conflicts, { query: { propertyId: '1', startDate: inDays(50), endDate: inDays(52) } });
  assert.deepEqual(res.body.devis, []);
});
