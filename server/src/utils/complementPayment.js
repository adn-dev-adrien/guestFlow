/**
 * Pure resolver for a complement's payment state from a payment-toggle payload
 * (specs/cash-complement-and-endofstay-finance.md §3.2). Shared by the arrival complement and the
 * end-of-stay complement in `reservationsController.updatePayment`.
 *
 * Rules:
 *   - « payé en liquide » (cash) IMPLIES paid;
 *   - an unpaid complement can't be cash (cash forced to 0 when not paid);
 *   - when paid, the existing paid date is preserved (Q2) unless an explicit date is provided,
 *     falling back to `today` when there was none.
 *
 * Inputs are the raw request fields (any may be undefined = "not provided") + the previous stored
 * row values. Returns `{ paid: 0|1, cash: 0|1, date: string|null }` ready to persist.
 */
function resolveComplementPayment({
  paidInput, cashInput, dateInput,
  prevPaid = 0, prevCash = 0, prevDate = null,
  today,
} = {}) {
  let paid = paidInput !== undefined ? Boolean(paidInput) : (Number(prevPaid || 0) === 1);
  let cash = cashInput !== undefined ? (cashInput ? 1 : 0) : (Number(prevCash || 0) === 1 ? 1 : 0);
  // Explicitly turning « caisse interne » ON implies paid. (Inherited cash must NOT resurrect a
  // payment the caller is explicitly clearing — so this only fires on an explicit cashInput=true.)
  if (cashInput === true) paid = true;
  if (!paid) cash = 0;              // unpaid can't be in the caisse interne
  const date = paid ? (dateInput || prevDate || today) : null;
  return { paid: paid ? 1 : 0, cash, date };
}

module.exports = { resolveComplementPayment };
