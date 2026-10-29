/**
 * The plugin dependency graph (specs/plugin-dependencies.md rules 2–5). Pure: it takes the manifests
 * in play and the stored states and answers who needs whom; the space's controller, the reconciler,
 * the loader and the console all read it, none recomputes an edge.
 *
 *   createGraph({ manifests, states, versions, allows, nameOf, labels })
 *     manifests  id → manifest   the installed row's manifest when there is one, else the catalogue's
 *     states     id → 'active' | 'inactive'   an installed plugin; absent = not installed
 *     versions   id → installed version
 *     allows     (id) → boolean  the licence
 *     nameOf     (id) → display name
 *     labels     overrides of the French status labels (the console says « éteint »)
 *
 * An edge is { id, name, range, status, label, installedVersion }; `status` is one of `ok`,
 * `inactive`, `missing`, `outOfRange`, `outOfPlan` (rule 3) and `label` the French words of an unmet
 * one (null when `ok`).
 */

const LABELS = Object.freeze({
  inactive: 'inactif',
  missing: 'non installé',
  outOfPlan: 'hors forfait',
});

/**
 * Post-order walk: every id of `ids` after the ids `next(id)` names (restricted to `ids` when
 * `within` is given). An id is visited once, so a cycle ends instead of looping.
 */
function postOrder(ids, next, within = null) {
  const seen = new Set();
  const out = [];
  const walk = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    next(id).filter((n) => !within || within.includes(n)).forEach(walk);
    out.push(id);
  };
  ids.forEach(walk);
  return out;
}

function createGraph({
  manifests, states = {}, versions = {}, allows = () => true, nameOf = (id) => id, labels = {},
}) {
  const words = { ...LABELS, ...labels };
  const requiresOf = (id, manifest) => ((manifest || manifests[id] || {}).requires || []);
  const installed = (id) => Object.prototype.hasOwnProperty.call(states, id);
  const ids = Object.keys(manifests);

  function edge(req) {
    // Loaded here: the CI script reads the cycles only, and runs with no node_modules.
    const { satisfies, floorLabel } = require('./semverRange');
    const name = nameOf(req.id);
    const base = { id: req.id, name, range: req.range, installedVersion: versions[req.id] || null };
    if (!installed(req.id)) {
      return allows(req.id)
        ? { ...base, status: 'missing', label: words.missing }
        : { ...base, status: 'outOfPlan', label: words.outOfPlan };
    }
    if (!allows(req.id)) return { ...base, status: 'outOfPlan', label: words.outOfPlan };
    const version = versions[req.id];
    if (version && !satisfies(version, req.range)) {
      return { ...base, status: 'outOfRange', label: `version ${version} — ${floorLabel(req.range) || req.range} ou plus récente requise` };
    }
    if (states[req.id] !== 'active') return { ...base, status: 'inactive', label: words.inactive };
    return { ...base, status: 'ok', label: null };
  }

  /** Rules 3, 6 — what `id` requires, each with its status. `manifest` overrides the one in play (an offer). */
  const requirementsOf = (id, manifest) => requiresOf(id, manifest).map(edge);

  /**
   * The installed plugins that require `id`. `activeOnly` keeps those that are switched on and that
   * the licence allows: one out of plan is not live, so it neither blocks nor follows a switch-off.
   */
  const dependantsOf = (id, { activeOnly = false } = {}) => ids
    .filter((other) => other !== id && installed(other) && (!activeOnly || (states[other] === 'active' && allows(other))))
    .filter((other) => requiresOf(other).some((r) => r.id === id));

  /** Rule 7 — the installed plugins that use `id`, with their state. */
  const usedBy = (id) => dependantsOf(id).map((other) => ({ id: other, name: nameOf(other), state: states[other] }));

  /** Rule 4 — every plugin `id` needs, transitively, deepest first (the order to switch them on). */
  const requirementClosure = (id, manifest) => postOrder(
    requiresOf(id, manifest).map((r) => r.id),
    (other) => requiresOf(other).map((r) => r.id),
  ).filter((other) => other !== id);

  /** Rule 4 — the active plugins that need `id`, transitively, deepest first (the order to switch them off). */
  const activeDependantClosure = (id) => postOrder(
    dependantsOf(id, { activeOnly: true }),
    (other) => dependantsOf(other, { activeOnly: true }),
  ).filter((other) => other !== id);

  // Rule 5 — one cycle per strongly connected group of two or more plugins (or a plugin requiring itself).
  function cyclicGroups() {
    const next = (id) => requiresOf(id).map((r) => r.id).filter((n) => manifests[n]);
    const index = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    const groups = [];
    let counter = 0;
    const connect = (id) => {
      index.set(id, counter);
      low.set(id, counter);
      counter += 1;
      stack.push(id);
      onStack.add(id);
      next(id).forEach((n) => {
        if (!index.has(n)) {
          connect(n);
          low.set(id, Math.min(low.get(id), low.get(n)));
        } else if (onStack.has(n)) {
          low.set(id, Math.min(low.get(id), index.get(n)));
        }
      });
      if (low.get(id) !== index.get(id)) return;
      const group = [];
      let top;
      do {
        top = stack.pop();
        onStack.delete(top);
        group.push(top);
      } while (top !== id);
      groups.push(group);
    };
    [...ids].sort().forEach((id) => { if (!index.has(id)) connect(id); });
    return {
      next,
      groups: groups.filter((group) => group.length > 1 || next(group[0]).includes(group[0])),
    };
  }

  // The shortest path leaving `start` and coming back to it inside its group.
  function cycleThrough(group, start, next) {
    const parent = new Map([[start, null]]);
    const queue = [start];
    let last = null;
    while (queue.length && last === null) {
      const id = queue.shift();
      next(id).filter((n) => group.includes(n)).forEach((n) => {
        if (n === start && last === null) last = id;
        else if (!parent.has(n)) { parent.set(n, id); queue.push(n); }
      });
    }
    const path = [];
    for (let id = last; id !== null; id = parent.get(id)) path.unshift(id);
    return path;
  }

  // Rule 5 — one cycle per strongly connected group (reported from its smallest id).
  function cycles() {
    const { next, groups } = cyclicGroups();
    return groups
      .map((group) => cycleThrough(group, [...group].sort()[0], next))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  /** A cycle through `id` (every member of a strongly connected group has one), or null. */
  function cycleOf(id) {
    const { next, groups } = cyclicGroups();
    const group = groups.find((g) => g.includes(id));
    if (!group) return null;
    const reported = cycleThrough(group, [...group].sort()[0], next);
    return reported.includes(id) ? reported : cycleThrough(group, id, next);
  }

  /** Every member of the strongly connected group `id` belongs to (itself included), or an empty list. */
  const groupOf = (id) => cyclicGroups().groups.find((g) => g.includes(id)) || [];

  return {
    requirementsOf, dependantsOf, usedBy, requirementClosure, activeDependantClosure, cycles, cycleOf, groupOf, nameOf,
  };
}

/** « A → B → A » — the words of a cycle (rule 5). */
const cycleLabel = (cycle, nameOf = (id) => id) => [...cycle, cycle[0]].map(nameOf).join(' → ');

module.exports = { createGraph, postOrder, cycleLabel, LABELS };
