import { useEffect, useState } from 'react';
import api from '../api';
import { dateWindowMessage } from '../utils/dateHorizon';
import { localIsoToday } from '../utils/isoDay';

/**
 * useWelcomePack — the option lines the rate already covers for a brand-new own-channel reservation
 * (specs/welcome-pack-auto-options.md §4.2).
 *
 * Every decision is the server's: what the pack contains, whether the platform qualifies, whether
 * the free units cover the party, which day is the first morning. The hook re-asks whenever that
 * context changes (platform, property, dates, guests) and returns `[]` for every non-eligible case,
 * including a failed request — a pack that cannot be fetched must never block the form (rule: soft
 * fail). `enabled` is what keeps it off saved reservations, devis and iCal-imported fiches (rules
 * 4-5): when false the hook fires no request at all. Nor is a date outside the window of
 * specs/reservations-backend-mvc.md rule 13 (today ± 5 years) ever sent: the fiche refuses it anyway. `today` is the
 * server's day the fiche knows, the device's otherwise.
 */
export default function useWelcomePack({ enabled = false, propertyId, today = localIsoToday(), ...context } = {}) {
  const [lines, setLines] = useState([]);
  const {
    platform, startDate, endDate, checkInTime, checkOutTime, adults, children, teens,
  } = context;

  useEffect(() => {
    if (!enabled || !propertyId || dateWindowMessage(startDate, today) || dateWindowMessage(endDate, today)) {
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
  }, [enabled, propertyId, today, platform, startDate, endDate, checkInTime, checkOutTime, adults, children, teens]);

  return lines;
}
