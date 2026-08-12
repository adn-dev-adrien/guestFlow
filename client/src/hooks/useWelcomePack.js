import { useEffect, useState } from 'react';
import api from '../api';

/**
 * useWelcomePack — the option lines the rate already covers for a brand-new own-channel reservation
 * (specs/welcome-pack-auto-options.md §4.2).
 *
 * Every decision is the server's: what the pack contains, whether the platform qualifies, whether
 * the free units cover the party, which day is the first morning. The hook re-asks whenever that
 * context changes (platform, property, dates, guests) and returns `[]` for every non-eligible case,
 * including a failed request — a pack that cannot be fetched must never block the form (rule: soft
 * fail). `enabled` is what keeps it off saved reservations, devis and iCal-imported fiches (rules
 * 4-5): when false the hook fires no request at all.
 */
export default function useWelcomePack({ enabled = false, propertyId, ...context } = {}) {
  const [lines, setLines] = useState([]);
  const {
    platform, startDate, endDate, checkInTime, checkOutTime, adults, children, teens,
  } = context;

  useEffect(() => {
    if (!enabled || !propertyId) {
      setLines((prev) => (prev.length === 0 ? prev : []));
      return undefined;
    }
    let active = true;
    (async () => {
      try {
        const res = await api.getWelcomePack(propertyId, {
          platform, startDate, endDate, checkInTime, checkOutTime, adults, children, teens,
        });
        if (!active) return;
        setLines(Array.isArray(res?.lines) ? res.lines : []);
      } catch {
        if (active) setLines([]);
      }
    })();
    return () => { active = false; };
  }, [enabled, propertyId, platform, startDate, endDate, checkInTime, checkOutTime, adults, children, teens]);

  return lines;
}
