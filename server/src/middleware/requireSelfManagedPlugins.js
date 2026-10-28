/**
 * The plugin lifecycle exists only where the plugins are the administrator's
 * (specs/plugin-operator-provisioning.md rules 1, 4): on an operator-managed space every route behind
 * this guard answers exactly what an unknown `/api` path answers — for every role, a support session
 * included — so neither the route nor the reason is revealed. Runs before the controller.
 */

const { isOperatorManaged } = require('../utils/pluginGovernance');

// Byte for byte the fallback of index.js.
const NOT_FOUND = Object.freeze({ error: 'API route not found' });

function create({ operatorManaged = isOperatorManaged } = {}) {
  return (req, res, next) => (operatorManaged() ? res.status(404).json({ ...NOT_FOUND }) : next());
}

module.exports = create();
module.exports.create = create;
