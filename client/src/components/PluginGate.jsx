import { usePlugin } from '../hooks/usePlugins';

/**
 * PluginGate — renders its children only while a plugin is active
 * (specs/plugins-phase-0-foundation.md rule 16). An inactive plugin leaves no trace: no placeholder,
 * no empty box, and — because the children are not mounted — none of their API calls.
 *
 * Props:
 *   id        string     plugin id (constants/plugins.js)
 *   fallback  ReactNode  optional, rendered instead while the plugin is inactive (default: nothing)
 *   children  ReactNode
 */
export default function PluginGate({ id, fallback = null, children }) {
  return usePlugin(id) ? children : fallback;
}
