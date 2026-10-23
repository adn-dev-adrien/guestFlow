// specs/sas-arrival-total-server-side.md rules 10-12 — the arrival preview bills a plugin's lines
// through its `sasCommit` hook, exactly as the commit does: the evening supplement shows once, the
// hook's `write` never runs on a preview, and a stale block is refused before « Valider ».

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { seed } = require('./hourlySchedulingFixture');
const { createSasStep } = require('../sasStep');

require('../../sdk/registry').configure({ isActive: () => true, allows: () => true });

const NOW = new Date('2026-09-01T09:00:00Z');
const DAY_AND_EVENING = [
  { date: '2026-09-12', start: '17:00', end: '18:00' },
  { date: '2026-09-12', start: '20:00', end: '21:00' },
];

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function preview(ctx, body, t) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const realModel = require('../../../models/reservationsModel').create(ctx.db);
  const writes = [];
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getByIdWithDetails') return () => ({ ...ctx.reservation, options: [], resources: [] });
    if (k === 'resolveSasArrivalItems') return (id, draft) => realModel.resolveSasArrivalItems(Number(id), draft);
    if (k === 'planArrivalSas') return (id, input) => realModel.planArrivalSas(Number(id), input, { withExistingLines: false });
    if (k === 'getSasUpsellOptions') return () => ({ cleaning: {}, bathLinen: {} });
    return () => null;
  } });
  const step = createSasStep({ scheduling: () => ctx.scheduling, reservations: reservationsModelMock });
  require('../../sdk/registry').ensure('hourly-resources').sasCommits = [{
    ...step.hook,
    write: (...args) => { writes.push(args); return step.hook.write(...args); },
  }];
  const hooks = require('../../../utils/sasCommitHooks');
  const mocks = {
    '../../models/reservationsModel': reservationsModelMock,
    '../../utils/sasCommitHooks': { prepare: (args) => hooks.prepare({ ...args, db: ctx.db }) },
    '../../models/linenItemsModel': { list: () => [] },
    '../../models/settingsModel': { read: () => ({}) },
    '../../models/breakfastModel': { getForReservation: () => ({ applicable: false }) },
    '../../models/repairAmountsModel': { list: () => [] },
    '../../models/optionsModel': { listForProperty: () => [] },
  };
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    return origRequire.call(this, id);
  };
  let controller;
  try {
    delete require.cache[require.resolve('../../sas/controller')];
    controller = require('../../sas/controller');
  } finally { Module.prototype.require = origRequire; }
  const res = fakeRes();
  controller.previewArrival({ params: { id: '500' }, body, user: { id: 1, roles: ['admin'] } }, res);
  return { res, writes };
}

const blocks = (ctx, list) => ({
  resourceScheduling: { blocks: list.map((b) => ({ ...b, resourceId: ctx.resourceId })), resourceIds: [ctx.resourceId] },
});

test('rule 10 — the evening hour placed on the step is billed once, as a plugin line of the preview', (t) => {
  const ctx = seed({ hoursSold: 2 });
  const { res, writes } = preview(ctx, { pluginSteps: blocks(ctx, DAY_AND_EVENING) }, t);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const plugin = res.body.lines.filter((l) => l.group === 'plugin');
  assert.deepEqual(plugin.map((l) => [l.label, l.real, l.offerable]), [['Bain nordique — supplément soirée', 20, false]]);
  assert.equal(res.body.arrivalComplementTotal, 20);
  // rule 11 — a preview never runs the hook's write.
  assert.equal(writes.length, 0);
});

test('rule 12 — a block that no longer fits is refused by the preview, as the commit would', (t) => {
  const ctx = seed({ hoursSold: 2 });
  const { res } = preview(ctx, { pluginSteps: blocks(ctx, [{ date: '2026-09-20', start: '17:00', end: '18:00' }]) }, t);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'SLOT_CONFLICT');
});
