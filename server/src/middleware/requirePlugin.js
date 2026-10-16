/**
 * `requirePlugin(id)` — the routes of an inactive plugin answer as if they did not exist
 * (specs/plugins-phase-0-foundation.md rule 15): 404 `{ error: 'PLUGIN_INACTIVE', plugin }`.
 * `isActive` is injectable for tests; production asks the plugin registry, which also answers false
 * for a plugin module that failed to register (specs/plugins-phase-1-sdk.md rule 4).
 */

function requirePlugin(id, { isActive } = {}) {
  const check = isActive || ((pluginId) => require('../plugins/sdk/registry').isLive(pluginId));
  return function requirePluginMiddleware(req, res, next) {
    if (check(id)) return next();
    return res.status(404).json({ error: 'PLUGIN_INACTIVE', plugin: id });
  };
}

module.exports = requirePlugin;
