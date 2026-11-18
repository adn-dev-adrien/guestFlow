/**
 * useResourceBookingPreview — the price of a booking draft as the server answers it
 * (specs/resource-supplements-total-server-side.md rules 10-14), on the SDK's `useLatestPreview`.
 *
 *   draft   — `resourceBookingDraft(...)`, or `null` while the range is incomplete (no request)
 *   enabled — false when the dialog is closed
 *
 * Returns `{ price, pending, failed, error, refusal, fresh, retry }`. `price` is the latest answer, kept
 * (dimmed by the caller) while a newer one is pending, null once a request failed (`failed`) until a new answer (loop t23 S23-1). `refusal` is the server's 400/409 message — the
 * range is refused, not the price unavailable; `error` is any other failure (network, 5xx).
 */
import { useCallback } from 'react';
import { api, useLatestPreview } from '../sdk';

const REFUSAL_STATUSES = [400, 409];

export default function useResourceBookingPreview({ draft, enabled }) {
  const fetcher = useCallback((body, options) => api.previewResourceBooking(body, options), []);
  const {
    data, pending, error, failed, fresh, retry,
  } = useLatestPreview({
    fetcher, draft, enabled: Boolean(enabled && draft), resetKey: enabled ? 'open' : 'closed',
  });
  const refused = Boolean(error) && REFUSAL_STATUSES.includes(error.status);
  return {
    price: refused ? null : data,
    pending,
    failed,
    error: refused ? null : error,
    refusal: refused ? error.message : null,
    fresh,
    retry,
  };
}
