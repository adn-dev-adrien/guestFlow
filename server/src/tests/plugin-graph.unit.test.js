// specs/plugin-dependencies.md rules 1–5 and 7 — the pure graph shared by the controller, the
// reconciler, the loader and the console: edge statuses and their French labels, dependants, the
// ordered closures, the cycles.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createGraph, postOrder, cycleLabel } = require('../utils/pluginGraph');
const { validateManifest } = require('../plugins/manifest');
const { PLUGIN_CATALOG } = require('../constants/plugins');

const m = (id, requires = []) => ({ id, name: `Nom ${id}`, requires: requires.map((r) => (typeof r === 'string' ? { id: r, range: '^1.0.0' } : r)) });
const nameOf = (id) => `Nom ${id}`;

function graphOf(manifests, { states = {}, versions = {}, allows, labels } = {}) {
  return createGraph({
    manifests: Object.fromEntries(manifests.map((x) => [x.id, x])),
    states,
    versions: Object.fromEntries(Object.keys(states).map((id) => [id, versions[id] || '1.2.0'])),
    allows,
    nameOf,
    labels,
  });
}

test('rule 1: the manifest `requires` is the only declaration — { id, range } and nothing more', () => {
  const base = {
    id: 'aa', name: 'A', version: '1.0.0', description: 'd', icon: 'extension', surfaces: ['s'], guestflow: '>=3.9.0', sdk: '^2.0.0', changelog: { '1.0.0': ['x'] },
  };
  assert.deepEqual(validateManifest({ ...base, requires: [{ id: 'bb', range: '^1.0.0' }] }), []);
  assert.notDeepEqual(validateManifest({ ...base, requires: [{ id: 'bb', range: 'not a range' }] }), []);
  const keys = new Set(PLUGIN_CATALOG.flatMap((p) => (p.requires || []).map((r) => Object.keys(r).sort().join())));
  assert.deepEqual([...keys].filter((k) => k !== 'id,range'), []);
});

test('rule 2: dependants and requirements come from the manifests in play, not from a stored edge', () => {
  const g = graphOf([m('a', ['b']), m('b'), m('c')], { states: { a: 'active', b: 'active', c: 'active' } });
  assert.deepEqual(g.dependantsOf('b'), ['a']);
  assert.deepEqual(g.dependantsOf('c'), []);
  assert.deepEqual(g.requirementsOf('a').map((e) => e.id), ['b']);
  // An offer's own manifest can stand in for the one in play.
  assert.deepEqual(g.requirementsOf('c', m('c', ['a'])).map((e) => e.id), ['a']);
});

test('rule 3: a requirement is ok, inactive, missing, outOfRange or outOfPlan, and the server writes the label', () => {
  const a = m('a', [{ id: 'b', range: '^1.7.1' }]);
  const status = (opts) => graphOf([a, m('b')], opts).requirementsOf('a')[0];
  assert.deepEqual([status({ states: { b: 'active' }, versions: { b: '1.8.0' } }).status, status({ states: { b: 'active' }, versions: { b: '1.8.0' } }).label], ['ok', null]);
  assert.deepEqual([status({ states: { b: 'inactive' }, versions: { b: '1.8.0' } }).status, status({ states: { b: 'inactive' }, versions: { b: '1.8.0' } }).label], ['inactive', 'inactif']);
  assert.deepEqual([status({ states: {} }).status, status({ states: {} }).label], ['missing', 'non installé']);
  assert.deepEqual([status({ states: { b: 'active' }, versions: { b: '1.8.0' }, allows: () => false }).status, status({ states: { b: 'active' }, versions: { b: '1.8.0' }, allows: () => false }).label], ['outOfPlan', 'hors forfait']);
  const old = status({ states: { b: 'active' }, versions: { b: '1.6.0' } });
  assert.equal(old.status, 'outOfRange');
  assert.equal(old.label, 'version 1.6.0 — 1.7.1 ou plus récente requise');
});

test('rule 3: the console can word a status its own way, and a requirement not installed and not licensed is out of plan', () => {
  const g = graphOf([m('a', ['b']), m('b')], { states: { b: 'inactive' }, labels: { inactive: 'éteint' } });
  assert.equal(g.requirementsOf('a')[0].label, 'éteint');
  const unlicensed = graphOf([m('a', ['b']), m('b')], { states: {}, allows: (id) => id !== 'b' });
  assert.equal(unlicensed.requirementsOf('a')[0].status, 'outOfPlan');
});

test('rule 4: closures are transitive and ordered — requirements deepest first, dependants deepest first', () => {
  const g = graphOf([m('a', ['b']), m('b', ['c']), m('c'), m('d', ['b'])], { states: { a: 'active', b: 'active', c: 'active', d: 'active' } });
  assert.deepEqual(g.requirementClosure('a'), ['c', 'b']);
  assert.deepEqual(g.activeDependantClosure('c'), ['a', 'd', 'b']);
  assert.deepEqual(g.activeDependantClosure('a'), []);
});

test('rule 4: only active, licensed dependants follow a switch-off; an inactive or out-of-plan one does not', () => {
  const manifests = [m('a', ['b']), m('b'), m('c', ['b'])];
  const off = graphOf(manifests, { states: { a: 'inactive', b: 'active', c: 'active' } });
  assert.deepEqual(off.activeDependantClosure('b'), ['c']);
  assert.deepEqual(off.dependantsOf('b'), ['a', 'c']);
  const unlicensed = graphOf(manifests, { states: { a: 'active', b: 'active', c: 'active' }, allows: (id) => id !== 'c' });
  assert.deepEqual(unlicensed.activeDependantClosure('b'), ['a']);
});

test('rule 4: postOrder visits an id once, so a loop ends', () => {
  const next = { a: ['b'], b: ['a'] };
  assert.deepEqual(postOrder(['a'], (id) => next[id]), ['b', 'a']);
  assert.deepEqual(postOrder(['a', 'b'], (id) => next[id], ['a']), ['a', 'b'], 'a walk restricted to a set does not follow an edge out of it');
});

test('rule 5: a cycle is returned as an ordered list of ids, one per group, a plugin requiring itself included', () => {
  const g = graphOf([m('a', ['b']), m('b', ['c']), m('c', ['a']), m('d', ['d']), m('e', ['a']), m('f')]);
  assert.deepEqual(g.cycles(), [['a', 'b', 'c'], ['d']]);
  assert.deepEqual(g.cycleOf('b'), ['a', 'b', 'c']);
  assert.equal(g.cycleOf('e'), null, 'a plugin that only needs a cycle is not part of it');
  assert.equal(g.cycleOf('f'), null);
  assert.equal(graphOf([m('a', ['b']), m('b')]).cycles().length, 0);
});

test('rule 5: the cycle is worded with names, and closed on its first member', () => {
  assert.equal(cycleLabel(['a', 'b'], nameOf), 'Nom a → Nom b → Nom a');
});

test('rule 7: used-by lists the installed dependants with their state', () => {
  const g = graphOf([m('a', ['b']), m('b'), m('c', ['b']), m('d', ['b'])], { states: { a: 'active', b: 'active', c: 'inactive' } });
  assert.deepEqual(g.usedBy('b'), [{ id: 'a', name: 'Nom a', state: 'active' }, { id: 'c', name: 'Nom c', state: 'inactive' }]);
});
