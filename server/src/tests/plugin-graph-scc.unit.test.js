// specs/plugin-dependencies.md rule 21 (audit round 2, N5) — `cycleOf` answers for EVERY member of a
// strongly connected group, not only those on the one cycle `cycles()` reports; the loader leaves them all
// unloaded as circular and `activate` refuses them all.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGraph } = require('../utils/pluginGraph');
const loader = require('../plugins/loader');
const h = require('./pluginPackagesFixture');

const graphOf = (edges) => {
  const ids = Object.keys(edges);
  const manifests = Object.fromEntries(ids.map((id) => [id, { id, requires: edges[id].map((r) => ({ id: r, range: '^1.0.0' })) }]));
  return { g: createGraph({ manifests }), manifests };
};

test('rule 21: a member of a group off the reported path still has a cycle through it', () => {
  const { g } = graphOf({ a: ['b'], b: ['a', 'c'], c: ['b'] });
  assert.deepEqual(g.cycles(), [['a', 'b']]);
  assert.deepEqual(g.cycleOf('c'), ['c', 'b']);
  assert.deepEqual(g.cycleOf('a'), ['a', 'b'], 'a member on the reported cycle keeps that cycle');
});

test('rule 21: property — over random graphs, cycleOf is a real cycle through id exactly when id is in one', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let t = 0; t < 400; t += 1) {
    const n = 1 + Math.floor(rnd() * 7);
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const edges = Object.fromEntries(ids.map((id) => [id, ids.filter(() => rnd() < 0.25)]));
    const { g } = graphOf(edges);
    const reach = (from, to) => {
      const seen = new Set();
      const stack = [...edges[from]];
      while (stack.length) {
        const x = stack.pop();
        if (x === to) return true;
        if (!seen.has(x)) { seen.add(x); stack.push(...edges[x]); }
      }
      return false;
    };
    ids.forEach((id) => {
      const cycle = g.cycleOf(id);
      if (!reach(id, id)) { assert.equal(cycle, null, `${id} is in no cycle`); return; }
      assert.ok(cycle && cycle.includes(id), `${id} must be in its cycle ${JSON.stringify(edges)}`);
      cycle.forEach((member, i) => assert.ok(edges[member].includes(cycle[(i + 1) % cycle.length]), 'every hop is a real requirement'));
    });
  }
});

test('rule 21: activating any member of a group is refused REQUIREMENT_CYCLE, the one off the reported path included', async () => {
  const r = (id) => ({ id, range: '^1.0.0' });
  const a = h.manifest('xa', '1.0.0', { requires: [r('xb')] });
  const b = h.manifest('xb', '1.0.0', { requires: [r('xa'), r('xc')] });
  const c = h.manifest('xc', '1.0.0', { requires: [r('xb')] });
  const { ctrl, model } = h.setup({ bundled: [a, b, c], installed: [a, b, c].map((m) => ({ id: m.id, version: '1.0.0', source: 'bundled', manifest: m })) });
  ['xa', 'xb', 'xc'].forEach((id) => model.setEnabled(id, false));
  for (const id of ['xa', 'xb', 'xc']) {
    const res = await h.call(ctrl.activate, { params: { id }, body: { withRequirements: ['xa', 'xb', 'xc'].filter((x) => x !== id) } });
    assert.equal(res.statusCode, 409, id);
    assert.equal(res.body.error, 'REQUIREMENT_CYCLE', id);
  }
  assert.deepEqual(['xa', 'xb', 'xc'].map((id) => model.get(id).enabled), [false, false, false]);
});

test('rule 21: the loader leaves every member of a group unloaded as circular, and what needs them as missing', () => {
  const r = (id) => ({ id, range: '^1.0.0' });
  const mk = (id, requires) => h.manifest(id, '1.0.0', { requires: requires.map(r) });
  const all = [mk('xa', ['xb']), mk('xb', ['xa', 'xc']), mk('xc', ['xb']), mk('xd', ['xc'])];
  const s = h.setup({ bundled: all, installed: all.map((m) => ({ id: m.id, version: '1.0.0', source: 'bundled', manifest: m })) });
  const out = loader.loadPackages({
    store: s.host.store(), rows: s.model.list(), order: all.map((m) => m.id), env: { coreVersion: '3.9.0', sdkVersion: '2.14.0' },
  });
  ['xa', 'xb', 'xc'].forEach((id) => assert.equal(out.incompatible[id].code, 'REQUIREMENT_CYCLE', id));
  assert.equal(out.incompatible.xd.code, 'REQUIREMENT_MISSING');
});
