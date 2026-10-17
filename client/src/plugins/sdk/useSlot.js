import { useMemo } from 'react';
import { usePlugin } from '../../hooks/usePlugins';
import PLUGIN_MODULES from '../index';
import { allContributions } from './registry';

/**
 * `useSlot(name)` → the contributions active plugins made to a slot, in order
 * (specs/plugins-phase-1-sdk.md rule 13). For slots that carry data (routes, steps, tokens) rather
 * than a component to drop in place — those use `<Slot>`.
 *
 * The module list does not change once the app renders (a production build fills it from the
 * plugin bundles before, specs/plugins-phase-4-registry.md rule 18), so asking `usePlugin` once per
 * module keeps the number of hooks constant from one render to the next.
 */
export function useSlot(name) {
  const MODULE_IDS = PLUGIN_MODULES.map((mod) => mod.id);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const active = MODULE_IDS.map((id) => usePlugin(id));
  const key = active.map((on) => (on ? '1' : '0')).join('');
  return useMemo(() => {
    const on = new Set(MODULE_IDS.filter((_, i) => active[i]));
    return allContributions(name)
      .filter((c) => on.has(c.pluginId))
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);
}
