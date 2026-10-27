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
 * `enabled` (default true): App passes « the user is an admin ». `GET /api/settings` is admin-only,
 * so any other role (and the login page) would only log a 403/401 in the console on every page —
 * seen at the 2026-10-27 spec review on every reception page, the arrival SAS included
 * (specs/reception-role-checkin-only.md rule 14). Those users keep the default favicon; in
 * production the server already serves the logo on `/favicon.ico`.
 *
 * Failure modes:
 *   - GET /api/settings returns 401 / 403 → we silently fall through (the bundled default favicon
 *     stays).
 *   - Network error → same, silent fall-through. A broken favicon endpoint must NEVER block
 *     the app.
 */

import { useEffect } from 'react';
import api from '../api';
import { setFavicon } from '../utils/setFavicon';

export function useDynamicFavicon({ refreshKey, enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
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
  }, [refreshKey, enabled]);
}

export default useDynamicFavicon;
