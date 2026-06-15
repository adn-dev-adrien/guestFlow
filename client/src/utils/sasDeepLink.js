/**
 * SAS deep-link parsing for push notifications (specs/pwa-push-notifications.md §3.3 rule 10).
 *
 * An arrival/departure push targets `/planning?sas=arrival|departure&reservationId=:id`. The Planning
 * page reads these params on mount and opens the matching SAS. This helper validates + extracts them.
 *
 * @param {URLSearchParams} searchParams
 * @returns {{ mode: 'arrival'|'departure', reservationId: number } | null} null when absent/invalid.
 */
export function readSasDeepLink(searchParams) {
  if (!searchParams || typeof searchParams.get !== 'function') return null;
  const mode = searchParams.get('sas');
  const reservationId = Number(searchParams.get('reservationId'));
  if ((mode === 'arrival' || mode === 'departure') && Number.isFinite(reservationId) && reservationId > 0) {
    return { mode, reservationId };
  }
  return null;
}
