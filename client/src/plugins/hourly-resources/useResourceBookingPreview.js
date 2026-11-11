/**
 * useResourceBookingPreview — the price of a booking draft as the server answers it
 * (specs/resource-supplements-total-server-side.md rules 10-14), on the SDK's `useLatestPreview`.
 *
 *   draft   — `resourceBookingDraft(...)`, or `null` while the range is incomplete (no request)
 *   enabled — false when the dialog is closed
 *
 * Returns `{ price, pending, error, refusal, fresh, retry }`. `price` is the latest answer, kept
 * (dimmed by the caller) while a newer one is pending. `refusal` is the server's 400/409 message — the
 * range is refused, not the price unavailable; `error` is any other failure (network, 5xx).
 */
import { useCallback } from 'react';
import { api, useLatestPreview } from '../sdk';

const REFUSAL_STATUSES = [400, 409];

export default function useResourceBookingPreview({ draft, enabled }) {
  const fetcher = useCallback((body, options) => api.previewResourceBooking(body, options), []);
  const {
    data, pending, error, fresh, retry,
  } = useLatestPreview({
    fetcher, draft, enabled: Boolean(enabled && draft), resetKey: enabled ? 'open' : 'closed',
  });
  const refused = Boolean(error) && REFUSAL_STATUSES.includes(error.status);
  return {
    price: refused ? null : data,
    pending,
    error: refused ? null : error,
    refusal: refused ? error.message : null,
    fresh,
    retry,
  };
}
