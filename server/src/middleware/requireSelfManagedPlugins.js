/**
 * The plugin lifecycle exists only where the plugins are the administrator's
 * (specs/plugin-operator-provisioning.md rules 1, 4, 30): on an operator-managed space every route behind
 * this guard answers exactly what an unknown `/api` path answers — for every role, a support session
 * included — so neither the route nor the reason is revealed. Runs before the controller.
 * `isHidden(req)` tells the support audit (which runs earlier) to let such a request through
 * untouched: it would otherwise answer 403, and log it, on the two routes it forbids to a support
 * session.
 */

const { isOperatorManaged } = require('../utils/pluginGovernance');
const { normalizePath } = require('../utils/supportSessionPolicy');

// Byte for byte the fallback of index.js.
const NOT_FOUND = Object.freeze({ error: 'API route not found' });

const LIFECYCLE = [
  ['GET', /^\/plugins\/(status|page)$/],
  ['POST', /^\/plugins\/(refresh|update-all)$/],
  ['POST', /^\/plugins\/[^/]+\/(install|update|rollback|activate|deactivate)$/],
  ['DELETE', /^\/plugins\/[^/]+$/],
];

function isLifecycle(method, rawPath) {
  const upper = String(method || '').toUpperCase();
  const verb = upper === 'HEAD' ? 'GET' : upper;
  const path = normalizePath(rawPath);
  return LIFECYCLE.some(([m, re]) => m === verb && re.test(path));
}

function create({ operatorManaged = isOperatorManaged } = {}) {
  return (req, res, next) => (operatorManaged() ? res.status(404).json({ ...NOT_FOUND }) : next());
}

const isHidden = (req) => isLifecycle(req.method, req.path) && isOperatorManaged();

module.exports = create();
module.exports.create = create;
module.exports.isLifecycle = isLifecycle;
module.exports.isHidden = isHidden;
