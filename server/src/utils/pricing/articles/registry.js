/**
 * Article-family registry (specs/pricing-components.md §3 rule 47) — strategy + registry: one generic formula per
 * pricing family, registered once by id.
 *
 * Contract:
 *   register(id, family, { owner, isLive })   `owner` 'core' (default) or a plugin id; `isLive()` tells whether the owner
 *                                             is live. A second registration of an id throws DUPLICATE_FAMILY, except a
 *                                             plugin registering its own id again (activation after deactivation).
 *   get(id)                                   the family when registered AND live, else null (FAMILY_UNAVAILABLE upstream)
 *   ids()                                     the registered ids, in registration order
 *   reset()                                   forget every family (tests)
 *
 * A family is `{ id, configSchema, validate, price, describe }`. Plain objects, no class hierarchy (rule 56).
 */
const MEMBERS = ['validate', 'price', 'describe'];
const records = new Map();

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function register(id, family, { owner = 'core', isLive = () => true } = {}) {
  if (typeof id !== 'string' || !id) throw fail('INVALID_FAMILY', 'a family id is required');
  if (!family || family.id !== id) throw fail('INVALID_FAMILY', `family "${id}" must declare id "${id}"`);
  if (!Array.isArray(family.configSchema)) throw fail('INVALID_FAMILY', `family "${id}" lacks a configSchema`);
  for (const member of MEMBERS) {
    if (typeof family[member] !== 'function') throw fail('INVALID_FAMILY', `family "${id}" lacks "${member}"`);
  }
  const existing = records.get(id);
  if (existing && (existing.owner !== owner || owner === 'core')) throw fail('DUPLICATE_FAMILY', `family "${id}" is already registered by ${existing.owner}`);
  records.set(id, { family, owner, isLive });
  return family;
}

function get(id) {
  const record = records.get(id);
  return record && record.isLive() ? record.family : null;
}

const ids = () => [...records.keys()];

function reset() {
  records.clear();
}

module.exports = {
  register, get, ids, reset,
};
