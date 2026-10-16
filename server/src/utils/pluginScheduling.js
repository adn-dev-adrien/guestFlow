/**
 * `whenPluginActive(id, pass)` — wraps a scheduled pass so its tick is skipped while the plugin is
 * inactive (specs/plugins-phase-0-foundation.md rule 15). The check runs at every tick, so
 * reactivating a plugin resumes its job without a restart. Always returns a promise, like the
 * async passes it wraps. `isActive` is injectable for tests.
 */

function whenPluginActive(id, pass, { isActive } = {}) {
  const check = isActive || ((pluginId) => require('../plugins/sdk/registry').isLive(pluginId));
  return (...args) => (check(id) ? Promise.resolve().then(() => pass(...args)) : Promise.resolve(undefined));
}

module.exports = { whenPluginActive };
