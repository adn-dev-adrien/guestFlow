/**
 * useDynamicFavicon — fetches the public settings once on mount and pushes the configured
 * company logo into the document's `<link rel="icon">` via `utils/setFavicon`. Re-fetches when
 * the supplied `refreshKey` changes (so SettingsPage can trigger an immediate refresh after the
 * admin uploads / clears the logo, without a hard reload).
 *
 * Why client-side: in DEV, CRA's :3000 dev server serves `public/favicon.ico` directly and never
 * proxies it to Node, so the server-side middleware doesn't fire. In PROD the middleware DOES
 * fire on the static `/favicon.ico` request, but the browser caches favicons aggressively — a
 * fresh logo upload wouldn't surface until the tab is force-reloaded. This hook handles both
 * cases at runtime + adds a cache-buster to defeat the favicon cache.
 *
 * Failure modes:
 *   - GET /api/settings returns 401 / 403 (pre-login) → we silently fall through (the bundled
 *     default favicon stays). Settings is fetched again once the user logs in via the
 *     `refreshKey` we feed from the auth state.
 *   - Network error → same, silent fall-through. A broken favicon endpoint must NEVER block
 *     the app.
 */

import { useEffect } from 'react';
import api from '../api';
import { setFavicon } from '../utils/setFavicon';

export function useDynamicFavicon({ refreshKey } = {}) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await api.getSettings();
        if (cancelled) return;
        const logoPath = settings && settings.company && settings.company.logoPath;
        // updatedAt makes the cache-buster move every time settings are saved, which guarantees
        // the browser fetches the new icon even when the path itself didn't change (re-upload).
        const version = settings && settings.updatedAt;
        setFavicon({ href: logoPath || null, version });
      } catch (_) {
        // Pre-login / network error: keep the default favicon. No user feedback needed.
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);
}

export default useDynamicFavicon;
