// The contributions of the plugin modules, by slot (specs/plugins-phase-1-sdk.md rules 13-15).
// A contribution is kept only while its plugin is active for the signed-in user's database.

import PLUGIN_MODULES from '../index';
import { isPluginEnabled } from '../../constants/plugins';

/** Every contribution to `slot`, active or not, each tagged with its plugin id. Build-time list. */
export function allContributions(slot, modules = PLUGIN_MODULES) {
  return modules.flatMap((mod) => ((mod.contributes && mod.contributes[slot]) || [])
    .map((c) => ({ ...c, pluginId: mod.id })));
}

/** The contributions to `slot` of the plugins active for `user`, sorted by `order`. */
export function contributionsFor(slot, user, modules = PLUGIN_MODULES) {
  return allContributions(slot, modules)
    .filter((c) => isPluginEnabled(user, c.pluginId))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
