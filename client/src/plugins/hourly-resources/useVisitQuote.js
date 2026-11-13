/**
 * useVisitQuote — the visit of an outside client as the server quotes it for the draft the operator keeps editing
 * (specs/outside-booking-sas.md §4.3, rules 4, 12): the lines, the totals, the VAT rows and the refusals of what is being added, written nowhere.
 * Built on the SDK's `useLatestPreview` like `useResourceBookingPreview`: only the latest request counts, the screen renders the answer and never estimates.
 *
 *   bookingId — the booking being opened
 *   draft     — `{ offeredMinutes?, sessionOffered?, extras: [{ articleRef, quantity, offered }] }`, or `null` while there is nothing to ask (no request)
 *   enabled   — false when the dialog is closed
 *   version   — the document's version: a change made elsewhere (a line offered, a link minted) asks the same draft again
 *
 * Returns `{ visit, refusals, pending, fresh, error, refusal, retry }`. `visit` is the latest payload (kept, dimmed by the caller, while a newer one is
 * pending); `refusals` are `[{ field, code, error }]` — the draft's own refusals (a quantity out of bounds, an offered time that exceeds the slot);
 * `refusal` is a refusal of the whole request (400 / 409), `error` any other failure.
 */
import { useCallback } from 'react';
import { api, useLatestPreview } from '../sdk';

const REFUSAL_STATUSES = [400, 409];

export default function useVisitQuote({
  bookingId, draft, enabled, version = 0,
}) {
  const fetcher = useCallback((body, options) => api.quoteResourceVisit(bookingId, body, options), [bookingId]);
  const {
    data, pending, error, fresh, retry,
  } = useLatestPreview({
    fetcher, draft, enabled: Boolean(enabled && draft && bookingId), scope: `${bookingId}:${version}`, resetKey: enabled ? `open:${bookingId}` : 'closed',
  });
  const refused = Boolean(error) && REFUSAL_STATUSES.includes(error.status);
  return {
    visit: refused ? null : data,
    refusals: !refused && data && Array.isArray(data.refusals) ? data.refusals : [],
    pending,
    error: refused ? null : error,
    refusal: refused ? error.message : null,
    fresh,
    retry,
  };
}
