// specs/plugin-dependencies.md rule 23 (audit r3, N-R3-2) — a plugin outside a cycle whose requirement closure
// touches a cycle member is refused like the member itself: `REQUIREMENT_CYCLE` on activate, and on the card.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./pluginPackagesFixture');

const r = (id) => ({ id, range: '^1.0.0' });
function cycleWithDependant() {
  const a = h.manifest('xa', '1.0.0', { requires: [r('xb')] });
  const b = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const d = h.manifest('xd', '1.0.0', { requires: [r('xa')] });
  const s = h.setup({ bundled: [a, b, d], installed: [a, b, d].map((m) => ({ id: m.id, version: '1.0.0', source: 'bundled', manifest: m })) });
  ['xa', 'xb', 'xd'].forEach((id) => s.model.setEnabled(id, false));
  return s;
}

test('rule 23: activating a dependant of a cycle member is refused REQUIREMENT_CYCLE, nothing switched on', async () => {
  const { ctrl, model } = cycleWithDependant();
  const res = await h.call(ctrl.activate, { params: { id: 'xd' }, body: {} });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_CYCLE');
  const confirmed = await h.call(ctrl.activate, { params: { id: 'xd' }, body: { withRequirements: ['xb', 'xa'] } });
  assert.equal(confirmed.body.error, 'REQUIREMENT_CYCLE');
  assert.deepEqual(['xa', 'xb', 'xd'].map((id) => model.get(id).enabled), [false, false, false]);
});

test('rule 23: the card of the dependant says why, and offers no cascade', async () => {
  const { ctrl } = cycleWithDependant();
  const list = await h.call(ctrl.list, { params: {}, query: {} });
  const xd = list.body.find((p) => p.id === 'xd');
  assert.match(xd.actions.activate.blockedBy, /Dépendance circulaire/);
  assert.equal(xd.actions.activate.allowed, false);
  assert.deepEqual(xd.actions.activate.alsoActivates, []);
});
