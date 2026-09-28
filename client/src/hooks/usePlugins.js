import { useAuth } from './useAuth';
import { isPluginEnabled } from '../constants/plugins';

/**
 * `usePlugin(id)` → true while the plugin is active for this database
 * (specs/plugins-phase-0-foundation.md rule 14). Reads the list `/api/auth/me` carries; the Plugins
 * page refreshes it after each change.
 */
export function usePlugin(id) {
  const { user } = useAuth();
  return isPluginEnabled(user, id);
}
