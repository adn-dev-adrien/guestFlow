// A resource sold by the hour is offered only while its plugin is live
// (specs/plugins-phase-3c-hourly-resources.md rules 18–20 — decision P14).

const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../plugins/sdk/registry');
const resourceOffer = require('../utils/resourceOffer');
const resourcesController = require('../controllers/resourcesController');
const { liveHourlyResources, withdrawHourlyResources } = require('./hourlyResourcesFixture');
const { seed } = require('../plugins/hourly-resources/tests/hourlySchedulingFixture');

test.afterEach(() => registry.reset());

const BATH = { id: 2, name: 'Bain nordique', priceType: 'per_hour' };
const BED = { id: 1, name: 'Lit bébé', priceType: 'per_stay' };

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('rule 18: the lists hide the resources sold by the hour while the plugin is off', () => {
  withdrawHourlyResources();
  assert.deepEqual(resourceOffer.hideUnoffered([BATH, BED]), [BED]);
  liveHourlyResources();
  assert.deepEqual(resourceOffer.hideUnoffered([BATH, BED]), [BATH, BED]);
});

test('rule 18: off, the resource URLs answer like a missing resource and the price type is refused', () => {
  withdrawHourlyResources();
  const model = { list: () => [BATH, BED], findById: (id) => [BATH, BED].find((r) => r.id === Number(id)) || null, insert: () => 9 };
  const c = resourcesController.buildController(model);

  const list = fakeRes();
  c.list({ query: {} }, list);
  assert.deepEqual(list.body, [BED]);

  const one = fakeRes();
  c.getOne({ params: { id: 2 } }, one);
  assert.equal(one.statusCode, 404);

  const created = fakeRes();
  c.create({ body: { name: 'Sauna', quantity: 1, price: 20, priceType: 'per_hour' } }, created);
  assert.equal(created.statusCode, 400);
  assert.equal(created.body.error, 'Le prix à l’heure demande le plugin Ressources à l’heure.');

  liveHourlyResources();
  const back = fakeRes();
  c.getOne({ params: { id: 2 } }, back);
  assert.equal(back.statusCode, 200, 'back with its settings when the plugin is live again (rule 20)');
});

test('rule 18: off, nothing new is sold by the hour', () => {
  const ctx = seed({ hoursSold: 0 });
  withdrawHourlyResources();
  const gate = resourceOffer.gateResources({ db: ctx.db, bookingId: 500, selectedResources: [{ resourceId: ctx.resourceId, quantity: 2 }] });
  assert.equal(gate.error.status, 422);
  assert.equal(gate.error.code, 'RESOURCE_NOT_OFFERED');
});

test('rule 18: off, a sold line is kept as stored — removal, hours, « offert » and lock ignored', () => {
  const sessions = [{ date: '2026-09-12', start: '20:00', end: '21:00' }];
  const ctx = seed({ hoursSold: 3, sessions });
  withdrawHourlyResources();

  const removed = resourceOffer.gateResources({ db: ctx.db, bookingId: 500, selectedResources: [], lockedResourceLines: [] });
  assert.deepEqual(removed.selectedResources, [{ resourceId: ctx.resourceId, quantity: 3, offered: false, inComplement: false, sessions }]);
  assert.equal(removed.lockedResourceLines.length, 1);
  assert.equal(removed.lockedResourceLines[0].totalPrice, 90, 'the stored lock, whatever the body sent');

  const changed = resourceOffer.gateResources({
    db: ctx.db, bookingId: 500,
    selectedResources: [{ resourceId: ctx.resourceId, quantity: 5, offered: true }],
    lockedResourceLines: [{ resourceId: ctx.resourceId, quantity: 5, unitPrice: 1, billedUnits: 5, totalPrice: 5 }],
  });
  assert.equal(changed.selectedResources[0].quantity, 3);
  assert.equal(changed.selectedResources[0].offered, false);
  assert.equal(changed.lockedResourceLines[0].totalPrice, 90);
});

test('rule 18: off, the fiche lists the sold line under frozenResources, read-only', () => {
  const ctx = seed({ hoursSold: 2 });
  withdrawHourlyResources();
  const [frozen] = resourceOffer.frozenResources(ctx.db, 500);
  assert.equal(frozen.id, ctx.resourceId);
  assert.equal(frozen.readOnly, true);
  assert.equal(frozen.readOnlyReason, 'Lecture seule : plugin Ressources à l’heure inactif');
  liveHourlyResources();
  assert.deepEqual(resourceOffer.frozenResources(ctx.db, 500), []);
});

test('rule 18: live, the gate steps aside', () => {
  const ctx = seed({ hoursSold: 2 });
  liveHourlyResources();
  const selectedResources = [{ resourceId: ctx.resourceId, quantity: 4 }];
  assert.deepEqual(resourceOffer.gateResources({ db: ctx.db, bookingId: 500, selectedResources }), { selectedResources, lockedResourceLines: undefined });
});
