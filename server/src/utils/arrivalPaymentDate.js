/**
 * The collection date of a single arrival payment (specs/single-payment-from-the-fiche.md rule 3bis).
 *
 * The operator chooses it, because the guest may have paid at the door days before anyone recorded
 * it. That date is not cosmetic: the accounting exports each entry in the month of its paid date, and
 * the group's own date is what folds the entries into one card. So it is validated, and the client's
 * value is never trusted — the field only proposes it.
 *
 * Two dates are refused, in opposite directions:
 *   - the FUTURE: the money has not been received, and the entry would book into a month nobody is
 *     looking at yet;
 *   - BEFORE the booking existed: the collection cannot predate what it pays for.
 *
 * Pure — no DB access. Returns the reason rather than throwing, so the API and the date field can say
 * exactly the same thing to the operator.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string} date      the proposed date, `YYYY-MM-DD`
 * @param {object} ctx
 * @param {string} ctx.today          today, `YYYY-MM-DD`
 * @param {string} [ctx.bookedAt]     the day the reservation was created, `YYYY-MM-DD` (optional:
 *                                    a row with no creation date only gets the future check)
 * @returns {{ok: true, date: string} | {ok: false, reason: string}}
 */
function validateArrivalPaymentDate(date, { today, bookedAt } = {}) {
  const value = String(date || '').slice(0, 10);
  if (!ISO_DATE_RE.test(value)) {
    return { ok: false, reason: 'Date d\'encaissement invalide.' };
  }
  // A real calendar day: the regex accepts 2026-02-31, the Date constructor does not keep it.
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { ok: false, reason: 'Date d\'encaissement invalide.' };
  }
  const now = String(today || '').slice(0, 10);
  if (ISO_DATE_RE.test(now) && value > now) {
    return { ok: false, reason: 'Un encaissement ne peut pas être daté dans le futur.' };
  }
  const booked = String(bookedAt || '').slice(0, 10);
  if (ISO_DATE_RE.test(booked) && value < booked) {
    return { ok: false, reason: `La réservation n'existait pas encore le ${value.split('-').reverse().join('/')}.` };
  }
  return { ok: true, date: value };
}

module.exports = { validateArrivalPaymentDate };
