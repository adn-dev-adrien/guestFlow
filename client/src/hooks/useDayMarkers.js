import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSlot } from '../plugins/sdk/useSlot';

/**
 * `useDayMarkers()` — what plugin modules draw on a calendar day (slot `calendar.dayMarkers`,
 * specs/plugins-phase-1-sdk.md rule 13), e.g. the A/B/C school-holiday zones. The calendars only
 * draw dots; which dot means what belongs to the plugin.
 *
 * Returns:
 *   markersFor(dateStr) → [{ key, color, title }]   empty until the plugins' data has loaded
 *   legend              → [{ key, color, label }]    the dots to explain beside the grid
 *   captions            → [string]                   short names for a one-line legend
 *
 * A load that fails draws nothing: markers are a cosmetic overlay.
 */
export default function useDayMarkers() {
  const contributions = useSlot('calendar.dayMarkers');
  const [loaded, setLoaded] = useState({});
  const ids = contributions.map((c) => `${c.pluginId}:${c.key}`).join(',');

  useEffect(() => {
    let cancelled = false;
    setLoaded({});
    contributions.forEach((c) => {
      Promise.resolve(c.load())
        .then((fn) => { if (!cancelled && typeof fn === 'function') setLoaded((prev) => ({ ...prev, [c.key]: fn })); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const markersFor = useCallback(
    (dateStr) => contributions.flatMap((c) => (loaded[c.key] ? loaded[c.key](dateStr) : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, ids],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const legend = useMemo(() => contributions.flatMap((c) => c.legend || []), [ids]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const captions = useMemo(() => contributions.map((c) => c.legendCaption).filter(Boolean), [ids]);

  return { markersFor, legend, captions };
}
