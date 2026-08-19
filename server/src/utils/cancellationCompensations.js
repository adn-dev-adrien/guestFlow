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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The ceiling is a sanity guard, not a business rule: a cancellation indemnity is a fraction of a
// stay, so anything above it is a typo (a stray extra digit), never a real payment.
const MAX_AMOUNT = 100000;
// A bank movement older than this is certainly a mistyped year (2025 → 2015).
const MAX_BACKDATE_YEARS = 5;

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

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
 * The compensation block of an approval. Returns `{ ok: true, value: null }` when no compensation
 * is declared — the plain "just delete the reservation" path.
 */
function validateApprovalCompensation(input) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'object') return { ok: false, error: 'INVALID_COMPENSATION', field: 'compensation' };
  const expectedAmount = parseAmount(input.expectedAmount, { positive: false });
  if (Number.isNaN(expectedAmount)) return { ok: false, error: 'INVALID_AMOUNT', field: 'expectedAmount' };
  const expectedDate = parseOptionalDate(input.expectedDate);
  if (expectedDate === undefined) return { ok: false, error: 'INVALID_DATE', field: 'expectedDate' };
  return {
    ok: true,
    value: { expectedAmount, expectedDate, notes: String(input.notes || '').trim() },
  };
}

/**
 * Full create/update payload. The snapshot fields are free text on purpose: they describe a
 * reservation that no longer exists, so nothing can be joined to validate them.
 */
function validateDraft(input) {
  const body = input || {};
  const expectedAmount = parseAmount(body.expectedAmount, { positive: false });
  if (Number.isNaN(expectedAmount)) return { ok: false, error: 'INVALID_AMOUNT', field: 'expectedAmount' };
  const expectedDate = parseOptionalDate(body.expectedDate);
  if (expectedDate === undefined) return { ok: false, error: 'INVALID_DATE', field: 'expectedDate' };
  const startDate = parseOptionalDate(body.startDate);
  if (startDate === undefined) return { ok: false, error: 'INVALID_DATE', field: 'startDate' };
  const endDate = parseOptionalDate(body.endDate);
  if (endDate === undefined) return { ok: false, error: 'INVALID_DATE', field: 'endDate' };
  const platform = String(body.platform || '').trim();
  if (!platform) return { ok: false, error: 'PLATFORM_REQUIRED', field: 'platform' };
  const cancelledStayAmount = body.cancelledStayAmount === '' || body.cancelledStayAmount == null
    ? null
    : parseAmount(body.cancelledStayAmount, { positive: false });
  if (Number.isNaN(cancelledStayAmount)) return { ok: false, error: 'INVALID_AMOUNT', field: 'cancelledStayAmount' };
  return {
    ok: true,
    value: {
      propertyId: body.propertyId == null || body.propertyId === '' ? null : Number(body.propertyId),
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
  const receivedDate = parseOptionalDate(body.receivedDate);
  if (!receivedDate) return { ok: false, error: 'INVALID_DATE', field: 'receivedDate' };
  if (receivedDate > todayIso) return { ok: false, error: 'RECEIVED_DATE_IN_FUTURE', field: 'receivedDate' };
  const floor = `${Number(todayIso.slice(0, 4)) - MAX_BACKDATE_YEARS}${todayIso.slice(4)}`;
  if (receivedDate < floor) return { ok: false, error: 'RECEIVED_DATE_TOO_OLD', field: 'receivedDate' };
  return { ok: true, value: { receivedAmount, receivedDate } };
}

module.exports = {
  MAX_AMOUNT,
  isValidIsoDate,
  validateApprovalCompensation,
  validateDraft,
  validateReceipt,
};
