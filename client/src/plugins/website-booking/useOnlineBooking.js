import { useCallback, useEffect, useState } from 'react';
import { api } from '../sdk';

// The CGV page renders the slot twice — its alerts at the top, its card below — and both show the
// same server view: flipping the switch in the card clears the alert at once.
const listeners = new Set();
let inflight = null;

function publish(view) {
  listeners.forEach((listener) => listener(view));
  return view;
}

function load() {
  if (!inflight) {
    inflight = api.getOnlineBooking()
      .then(publish)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * The « Réservation en ligne » view (GET /api/terms/online-booking): the switch, the last plugin
 * version seen and the two verdicts, all computed by the server. Reloaded when the published CGV
 * version changes, since « no published version » is one of those verdicts.
 */
export function useOnlineBooking(currentVersion) {
  const [view, setView] = useState(null);
  // A failed read is said, with « Réessayer »: the emergency switch must never vanish silently.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const listener = (next) => { setFailed(false); setView(next); };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const reload = useCallback(() => {
    setFailed(false);
    load().catch(() => setFailed(true));
  }, []);

  useEffect(reload, [currentVersion, reload]);

  const setEnforcement = useCallback(
    async (value) => publish(await api.updateTermsEnforcement(value)),
    [],
  );

  return { view, failed, reload, setEnforcement };
}
