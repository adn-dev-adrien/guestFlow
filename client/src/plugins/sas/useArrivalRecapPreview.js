/**
 * useArrivalRecapPreview — the arrival recap as the server prices it
 * (specs/sas-arrival-total-server-side.md rules 17-21), on the generic `useLatestPreview`.
 *
 *   reservationId — the stay
 *   draft         — the arrival draft (`buildArrivalDraft`), the very body the commit will send
 *   enabled       — true on the pages that show money (recap, breakfast mornings, restauration)
 *   resetKey      — anything that identifies one run of the wizard; a new value forgets the last answer
 *   delay         — quiet time before a request (200 ms); the first request of a page leaves at once
 *
 * Returns `{ recap, pending, error, fresh, retry }`.
 */
import { useCallback } from 'react';
import { api, useLatestPreview } from '../sdk';

export default function useArrivalRecapPreview({
  reservationId, draft, enabled, resetKey, delay = 200,
}) {
  const fetcher = useCallback(
    (body, options) => api.previewArrivalSas(reservationId, body, options),
    [reservationId],
  );
  const { data, pending, error, fresh, retry } = useLatestPreview({
    fetcher, draft, enabled: Boolean(enabled && reservationId), scope: reservationId, resetKey, delay,
  });
  return { recap: data, pending, error, fresh, retry };
}
