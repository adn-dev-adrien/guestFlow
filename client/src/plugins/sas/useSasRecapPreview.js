/**
 * useSasRecapPreview — a SAS recap as the server prices it (specs/sas-arrival-total-server-side.md
 * rules 17-21, specs/sas-departure-recap-server-side.md rules 16-17): one hook for both ends, on the
 * SDK's generic `useLatestPreview`.
 *
 *   request       — the preview call of the end being run (`api.previewArrivalSas` / `api.previewDepartureSas`)
 *   reservationId — the stay
 *   draft         — the draft (`buildArrivalDraft` / `buildDepartureDraft`), the very body the commit will send
 *   enabled       — true on the pages that show money (the recap, the pages that sell or bill)
 *   resetKey      — anything that identifies one run of the wizard; a new value forgets the last answer
 *   delay         — quiet time before a request (200 ms); the first request of a page leaves at once
 *
 * Returns `{ recap, pending, error, failed, fresh, retry }`. `recap` is the hook's `last` answer: the recap pages draw their
 * layout from it after a failed request and show every amount « — » and every settlement control disabled while `failed`
 * (loop t23 S23-1).
 */
import { useCallback } from 'react';
import { useLatestPreview } from '../sdk';

export default function useSasRecapPreview({
  request, reservationId, draft, enabled, resetKey, delay = 200,
}) {
  const fetcher = useCallback(
    (body, options) => request(reservationId, body, options),
    [request, reservationId],
  );
  const {
    last, pending, error, failed, fresh, retry, answerKey, draftKey,
  } = useLatestPreview({
    fetcher, draft, enabled: Boolean(enabled && reservationId), scope: reservationId, resetKey, delay,
  });
  return {
    recap: last, pending, error, failed, fresh, retry, answerKey, draftKey,
  };
}
