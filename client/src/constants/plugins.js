// Client mirror of server/src/constants/plugins.js (ids only — the server owns the catalogue and the
// states; the client only hides what `user.enabledPlugins` does not list).
// specs/plugin-engine-backport.md rules 4 and 11. The plugins branch's version of this file replaces it
// when that branch merges.

export const GITES_DE_FRANCE_INTAKE = 'gites-de-france-intake';

export const PLUGIN_IDS = Object.freeze([GITES_DE_FRANCE_INTAKE]);

export function isPluginEnabled(user, id) {
  return Boolean(user && Array.isArray(user.enabledPlugins) && user.enabledPlugins.includes(id));
}
