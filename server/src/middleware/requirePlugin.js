/**
 * `requirePlugin(id)` — the routes of an inactive plugin answer as if they did not exist
 * (specs/plugins-phase-0-foundation.md rule 15): 404 `{ error: 'PLUGIN_INACTIVE', plugin }`.
 * `isActive` is injectable for tests; production reads the plugins model.
 */

function requirePlugin(id, { isActive } = {}) {
  const check = isActive || ((pluginId) => require('../models/pluginsModel').isActive(pluginId));
  return function requirePluginMiddleware(req, res, next) {
    if (check(id)) return next();
    return res.status(404).json({ error: 'PLUGIN_INACTIVE', plugin: id });
  };
}

module.exports = requirePlugin;
