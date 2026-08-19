/**
 * Payment schedule — the single source of truth for a reservation's three dates
 * (specs/payment-schedule-and-cancellation.md §3.1 to §3.3).
 *
 *   acompte  → due when the guest BOOKS: `bookingDate + property.depositDueDays` (default 7),
 *              then FROZEN forever. It records a commitment taken on the booking day, so no
 *              later edit (dates moved, price changed, engine recompute) may push it around.
 *   solde    → due `property.balanceDaysBefore` days before arrival (30), clamped so it can
 *              never fall before the booking date — a stay booked 3 days out owes both at once.
 *   annulation → `balanceDueDate + property.cancelAfterBalanceDueDays` (7). Computed on read,
 *              never stored: it is a consequence of the solde deadline, not a separate promise.
 *
 * Pure (no DB, no clock): every input is injected, so the whole schedule is unit-testable and the
 * pricing engine keeps its "no clock" property — callers pass the booking date they already hold.
 */

const { addDaysToIsoDate } = require('./devisHelpers');

const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

// A stored date may carry a time part (`createdAt` is a datetime); only the day matters here.
function toIsoDay(value) {
  if (!value) return null;
  const day = String(value).slice(0, 10);
  return isIsoDate(day) ? day : null;
}

// An absent value (null / undefined / '') means "no setting", not zero — `Number(null)` is 0, which
// would silently turn a missing column into a same-day deadline. A real 0 stays 0.
const positiveDays = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};

/**
 * Acompte due date (rules 3-6).
 *
 * @param {object}  input
 * @param {string}  input.kind                   'reservation' | 'devis'
 * @param {boolean} input.hasDeposit             false → no acompte to collect (disabled, 0 €, platform)
 * @param {string}  input.bookingDate            YYYY-MM-DD (or a datetime) — when the stay was booked
 * @param {string}  input.validUntil             devis validity date (devis only)
 * @param {string}  input.existingDepositDueDate the stored date, when the reservation already has one
 * @param {number}  input.depositDueDays         property setting, days after booking
 * @returns {string|null}
 */
function resolveDepositDueDate({
  kind = 'reservation',
  hasDeposit = true,
  bookingDate = null,
  validUntil = null,
  existingDepositDueDate = null,
  depositDueDays = 7,
} = {}) {
  if (!hasDeposit) return null;
  // A devis promises the dates until its validity date — that IS its acompte deadline (rule 5).
  if (String(kind) === 'devis') return toIsoDay(validUntil);
  // Frozen at creation: once stored, nothing recomputes it (rule 4).
  const existing = toIsoDay(existingDepositDueDate);
  if (existing) return existing;
  const booked = toIsoDay(bookingDate);
  if (!booked) return null;
  return addDaysToIsoDate(booked, positiveDays(depositDueDays, 7));
}

/**
 * Solde due date (rules 7-10): `startDate − balanceDaysBefore`, never before the booking day.
 */
function resolveBalanceDueDate({
  hasBalance = true,
  startDate = null,
  bookingDate = null,
  balanceDaysBefore = 30,
} = {}) {
  if (!hasBalance) return null;
  const start = toIsoDay(startDate);
  if (!start) return null;
  const derived = addDaysToIsoDate(start, -positiveDays(balanceDaysBefore, 30));
  if (!derived) return null;
  const booked = toIsoDay(bookingDate);
  return booked && derived < booked ? booked : derived;
}

/**
 * Cancellation deadline (rule 11) — the day from which an unpaid solde may cost the stay.
 */
function resolveCancelOn({ balanceDueDate = null, cancelAfterBalanceDueDays = 7 } = {}) {
  const due = toIsoDay(balanceDueDate);
  if (!due) return null;
  return addDaysToIsoDate(due, positiveDays(cancelAfterBalanceDueDays, 7));
}

/** Whole-day difference, `null` when either date is unusable. Negative = `from` is in the future. */
function daysBetween(from, to) {
  const a = toIsoDay(from);
  const b = toIsoDay(to);
  if (!a || !b) return null;
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

module.exports = {
  resolveDepositDueDate,
  resolveBalanceDueDate,
  resolveCancelOn,
  daysBetween,
  toIsoDay,
};
