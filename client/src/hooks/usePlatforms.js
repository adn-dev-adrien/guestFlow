import { useEffect, useState } from 'react';
import api from '../api';
import { PLATFORMS } from '../constants/platforms';

/**
 * usePlatforms — fetches the canonical platform-name list from `GET /api/platforms` (built-in
 * well-known platforms ∪ everything stored in the `platforms` table, which is topped up from iCal
 * sources + reservations). This is what makes a platform added in a logement's iCal imports appear
 * in the reservation-form and iCal-form dropdowns. specs/ical-platforms-in-dropdowns.md.
 *
 * Returns a string[] of names ('direct' first). Falls back to the static `PLATFORMS` constant until
 * the request resolves (and if it ever fails) so the dropdowns are never empty.
 */
export default function usePlatforms() {
  const [platforms, setPlatforms] = useState(PLATFORMS);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getPlatforms();
        const list = Array.isArray(res?.platforms) ? res.platforms : null;
        if (active && list && list.length > 0) setPlatforms(list);
      } catch {
        // keep the static fallback
      }
    })();
    return () => { active = false; };
  }, []);

  return platforms;
}
