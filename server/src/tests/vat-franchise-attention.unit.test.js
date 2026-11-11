// specs/vat-optional-mode.md rules 42 and 43 — the home's attention line for the franchise threshold,
// and the follow-up as a read-only source.

const test = require('node:test');
const assert = require('node:assert/strict');

const { franchiseDb, insert, TODAY } = require('./vatFranchiseFixture');
const { CORE_SUMMARIES, buildAttention } = require('../utils/dashboardAttention');
const { buildController } = require('../controllers/dashboardAttentionController');
const { attentionSummary } = require('../utils/vatFranchise');

const payload = (level, collected, projected, threshold = 10000) => ({ applies: true, level, collected, projected, threshold });
const summary = CORE_SUMMARIES['vat-franchise'];

test('rule 42: « Seuil proche » and « Projection » are to do, « Seuil dépassé » is urgent', () => {
  assert.deepEqual(summary(payload('near', 8400, 9000)), { count: 1, title: 'Seuil de franchise', detail: '84 % atteint', severity: 'todo' });
  assert.deepEqual(summary(payload('projected_over', 5000, 10400)), { count: 1, title: 'Seuil de franchise', detail: 'Projection : 104 %', severity: 'todo' });
  assert.deepEqual(summary(payload('over', 11240, 12000)), { count: 1, title: 'Seuil de franchise', detail: 'Dépassé de 1 240 €', severity: 'urgent' });
});

test('rule 42: nothing to say below the threshold, without one, or outside the franchise', () => {
  assert.equal(summary(payload('ok', 1000, 2000)), null);
  assert.equal(summary({ applies: true, level: null, collected: 1000, threshold: null }), null);
  assert.equal(summary({ applies: false }), null);
  assert.equal(summary(null), null);
});

test('rule 42: the line is never pinned — it sits in the box, urgent first', () => {
  const attention = buildAttention([
    { key: 'vat-franchise', rank: 25, summary: summary(payload('over', 11240, 12000)), failed: false },
    { key: 'ical-date-drift', rank: 10, summary: { count: 2, title: 'Dates iCal à valider', detail: '2 changements de dates', severity: 'todo' }, failed: false },
  ]);
  assert.deepEqual(attention.pinned, []);
  assert.deepEqual(attention.items.map((i) => i.key), ['vat-franchise', 'ical-date-drift']);
  assert.equal(attention.total, 3);
});

test('rule 42: a failed read is named in `unavailable`, like every source', async () => {
  const warnings = [];
  const controller = buildController({
    coreSources: () => [{ key: 'vat-franchise', rank: 25, handler: () => { throw new Error('boom'); } }],
    pluginSources: () => [],
    logger: { warn: (m) => warnings.push(m) },
  });
  const res = { body: null, json(b) { this.body = b; return this; } };
  await controller.attention({}, res);
  assert.deepEqual(res.body.unavailable, ['vat-franchise']);
  assert.match(warnings[0], /vat-franchise/);
});

test('rule 43: the follow-up reads and writes nothing', () => {
  const { db, model } = franchiseDb({ threshold: 1000 });
  insert(db, { startDate: '2026-03-01', endDate: '2026-03-04', finalPrice: 900, balanceAmount: 900, balancePaid: 1, balancePaidDate: '2026-03-04' });
  const before = db.prepare('SELECT total_changes() AS n').get().n;
  const first = model.getFollowUp({ today: TODAY });
  const second = model.getFollowUp({ today: TODAY });
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
  assert.deepEqual(first, second);
  assert.equal(attentionSummary(first).severity, 'todo');
});
