/**
 * Pure validators for cancellation compensations (specs/cancellation-compensation.md §3.5).
 *
 * Shared by the two write surfaces so a compensation created from the Dashboard approval and one
 * created by hand from Comptabilité obey the exact same rules:
 *   - `validateApprovalCompensation` — the small `{ expectedAmount, expectedDate, notes }` block
 *     posted alongside an iCal cancellation approval (the rest is snapshotted from the reservation);
 *   - `validateDraft` — the full manual create/update payload;
 *   - `validateReceipt` — the amount + date of the actual bank movement.
 *
 * Every validator is pure (today's date is injected) and returns
 *   { ok: true, value } | { ok: false, error: 'CODE', field }
 * so the controller only maps codes to HTTP statuses.
 */

const { asText, isOptionalText, positiveId } = require('./bodyText');
const { isRealIsoDay, dateWindowMessage, dateBeforeHorizon, PAST_HORIZON_MESSAGE, ENTRY_DATE_INVALID_MESSAGE } = require('./stayDates');

// The ceiling is a sanity guard, not a business rule: a cancellation indemnity is a fraction of a
// stay, so anything above it is a typo (a stray extra digit), never a real payment.
const MAX_AMOUNT = 100000;
const isValidIsoDate = isRealIsoDay;

const { roundMoneyStrict: round2 } = require('./pricing/money');

// `positive: false` accepts 0 — an expected amount the platform hasn't announced yet.
function parseAmount(value, { positive }) {
  if (value === '' || value === null || value === undefined) return positive ? NaN : 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  if (n < 0 || n > MAX_AMOUNT) return NaN;
  if (positive && n <= 0) return NaN;
  return round2(n);
}

function parseOptionalDate(value) {
  if (value === '' || value === null || value === undefined) return null;
  return isValidIsoDate(value) ? value : undefined; // undefined = present but invalid
}

/**
 * The first refusal among `fields` of `value` (each a parsed date or null) outside the date window
 * (specs/reservations-backend-mvc.md rule 13, reading of 2026-11-02) — the French message as `error` —
 * or null. A date equal to the `stored` row's is never re-judged.
 */
function windowRefusal(value, fields, { stored = null, today } = {}) {
  for (const field of fields) {
    if (!value[field] || (stored && stored[field] === value[field])) continue;
    const outside = dateWindowMessage(value[field], today);
    if (outside) return { ok: false, error: outside, field };
  }
  return null;
}

/**
 * The compensation block of an approval. Returns `{ ok: true, value: null }` when no compensation
 * is declared — the plain "just delete the reservation" path.
 */
function validateApprovalCompensation(input, { today } = {}) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'object') return { ok: false, error: 'INVALID_COMPENSATION', field: 'compensation' };
  if (!isOptionalText(input.notes)) return { ok: false, error: 'INVALID_FIELD', field: 'notes' };
  const expectedAmount = parseAmount(input.expectedAmount, { positive: false });
  if (Number.isNaN(expectedAmount)) return { ok: false, error: 'INVALID_AMOUNT', field: 'expectedAmount' };
  const expectedDate = parseOptionalDate(input.expectedDate);
  if (expectedDate === undefined) return { ok: false, error: 'INVALID_DATE', field: 'expectedDate' };
  const outside = windowRefusal({ expectedDate }, ['expectedDate'], { today });
  if (outside) return outside;
  return {
    ok: true,
    value: { expectedAmount, expectedDate, notes: String(input.notes || '').trim() },
  };
}

const SNAPSHOT_TEXTS = ['propertyName', 'clientFirstName', 'clientLastName', 'notes'];
const isAbsentId = (value) => value == null || value === '';

/**
 * Full create/update payload. The snapshot fields are free text on purpose: they describe a
 * reservation that no longer exists, so nothing can be joined to validate them. Its dates lie in the
 * date window unless equal to the `stored` row's (an update keeping them).
 */
function validateDraft(input, { stored = null, today } = {}) {
  const body = input || {};
  const expectedAmount = parseAmount(body.expectedAmount, { positive: false });
  if (Number.isNaN(expectedAmount)) return { ok: false, error: 'INVALID_AMOUNT', field: 'expectedAmount' };
  const expectedDate = parseOptionalDate(body.expectedDate);
  if (expectedDate === undefined) return { ok: false, error: 'INVALID_DATE', field: 'expectedDate' };
  const startDate = parseOptionalDate(body.startDate);
  if (startDate === undefined) return { ok: false, error: 'INVALID_DATE', field: 'startDate' };
  const endDate = parseOptionalDate(body.endDate);
  if (endDate === undefined) return { ok: false, error: 'INVALID_DATE', field: 'endDate' };
  const platform = asText(body.platform).trim();
  if (!platform) return { ok: false, error: 'PLATFORM_REQUIRED', field: 'platform' };
  const notText = SNAPSHOT_TEXTS.find((key) => !isOptionalText(body[key]));
  if (notText) return { ok: false, error: 'INVALID_FIELD', field: notText };
  if (!isAbsentId(body.propertyId) && positiveId(body.propertyId) === null) return { ok: false, error: 'INVALID_FIELD', field: 'propertyId' };
  const cancelledStayAmount = body.cancelledStayAmount === '' || body.cancelledStayAmount == null
    ? null
    : parseAmount(body.cancelledStayAmount, { positive: false });
  if (Number.isNaN(cancelledStayAmount)) return { ok: false, error: 'INVALID_AMOUNT', field: 'cancelledStayAmount' };
  const outside = windowRefusal({ startDate, endDate, expectedDate }, ['startDate', 'endDate', 'expectedDate'], { stored, today });
  if (outside) return outside;
  return {
    ok: true,
    value: {
      propertyId: isAbsentId(body.propertyId) ? null : positiveId(body.propertyId),
      propertyName: String(body.propertyName || '').trim(),
      platform,
      clientFirstName: String(body.clientFirstName || '').trim(),
      clientLastName: String(body.clientLastName || '').trim(),
      startDate,
      endDate,
      cancelledStayAmount,
      expectedAmount,
      expectedDate,
      notes: String(body.notes || '').trim(),
    },
  };
}

/**
 * The actual bank movement. `todayIso` is injected so the rule "you can't bank money that hasn't
 * arrived yet" stays testable without freezing the clock.
 */
function validateReceipt(input, todayIso) {
  const body = input || {};
  const receivedAmount = parseAmount(body.receivedAmount, { positive: true });
  if (Number.isNaN(receivedAmount)) return { ok: false, error: 'INVALID_AMOUNT', field: 'receivedAmount' };
  // The French message is what the card shows (`error`); the code stays for the callers (`code`).
  const refuse = (code, error) => ({ ok: false, error, code, field: 'receivedDate' });
  const receivedDate = parseOptionalDate(body.receivedDate);
  if (!receivedDate) return refuse('INVALID_DATE', ENTRY_DATE_INVALID_MESSAGE);
  if (receivedDate > todayIso) return refuse('RECEIVED_DATE_IN_FUTURE', 'La date ne peut pas être dans le futur.');
  // A bank movement before the date window (today − 5 years) is certainly a mistyped year (2025 → 2015).
  if (dateBeforeHorizon(receivedDate, todayIso)) return refuse('RECEIVED_DATE_TOO_OLD', PAST_HORIZON_MESSAGE);
  return { ok: true, value: { receivedAmount, receivedDate } };
}

module.exports = {
  MAX_AMOUNT,
  isValidIsoDate,
  validateApprovalCompensation,
  validateDraft,
  validateReceipt,
};
