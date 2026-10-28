/**
 * The accounting split of ONE installment, frozen the moment it is collected
 * (specs/direct-installments.md rule 47, specs/accounting-books-the-money-collected.md rule 14).
 *
 * An installment of a past month is money the accountant may already have imported: its entry must
 * never move. Derived live, it did — the tourist-tax share is a proportion of the whole plan and the
 * revenue a pro rata of the fiche's lines, so a later save (one guest more, a line added) rewrote it.
 * The split is therefore computed once, here, and stored on the installment row (`paidSplit`, JSON):
 *
 *   { taxCents, accommodationCents, optionsCents, resourcesCents }   — they add up to `amountCents`
 *
 * Same rules as the export's stored-money path: the tax share is the plan's proportional share (0 when
 * the tax is collected on arrival), the rest is spread over what is collected before arrival — the
 * accommodation and the non-forced, non-offered lines — pro rata, the accommodation taking the cents.
 */

const { taxShares } = require('./installmentPlan');
const { TAX_ON_ARRIVAL_SQL } = require('./touristTaxFreeze');

const cents = (euros) => Math.round(Number(euros || 0) * 100);

function computeInstallmentPaidSplit(db, installmentId) {
  const installment = db.prepare('SELECT id, reservationId, amountCents FROM reservation_installments WHERE id = ?').get(Number(installmentId));
  if (!installment) return null;
  const stay = db.prepare(`SELECT r.finalPrice, r.touristTaxTotal, ${TAX_ON_ARRIVAL_SQL} AS taxOnArrival
    FROM reservations r WHERE r.id = ?`).get(installment.reservationId);
  if (!stay) return null;
  const plan = db.prepare('SELECT id, amountCents FROM reservation_installments WHERE reservationId = ? ORDER BY number')
    .all(installment.reservationId);
  const taxCents = stay.taxOnArrival ? 0 : cents(stay.touristTaxTotal);
  const shares = taxShares(taxCents, plan.map((p) => Number(p.amountCents)));
  const share = shares[plan.findIndex((p) => p.id === installment.id)] || 0;
  const revenueCents = Math.max(0, Number(installment.amountCents) - share);

  const lines = [
    ...db.prepare(`SELECT totalPrice AS total, COALESCE(offered, 0) AS offered, COALESCE(inComplement, 0) AS forced, 0 AS resource
      FROM reservation_options WHERE reservationId = ?`).all(installment.reservationId),
    ...db.prepare(`SELECT CASE WHEN COALESCE(offered, 0) = 1 THEN 0 ELSE amount END AS total, COALESCE(offered, 0) AS offered,
      COALESCE(inComplement, 0) AS forced, 0 AS resource FROM reservation_custom_options WHERE reservationId = ?`).all(installment.reservationId),
    ...db.prepare(`SELECT totalPrice AS total, COALESCE(offered, 0) AS offered, COALESCE(inComplement, 0) AS forced, 1 AS resource
      FROM reservation_resources WHERE reservationId = ?`).all(installment.reservationId),
  ];
  const linesCents = lines.reduce((sum, l) => sum + cents(l.total), 0);
  const preArrival = (resource) => lines
    .filter((l) => Number(l.resource) === resource && Number(l.offered) !== 1 && Number(l.forced) !== 1)
    .reduce((sum, l) => sum + Math.max(0, cents(l.total)), 0);
  const base = { accommodation: Math.max(0, cents(stay.finalPrice) - linesCents), options: preArrival(0), resources: preArrival(1) };
  const baseTotal = base.accommodation + base.options + base.resources;
  const optionsCents = baseTotal > 0 ? Math.round((revenueCents * base.options) / baseTotal) : 0;
  const resourcesCents = baseTotal > 0 ? Math.round((revenueCents * base.resources) / baseTotal) : 0;
  return {
    taxCents: share,
    accommodationCents: revenueCents - optionsCents - resourcesCents,
    optionsCents,
    resourcesCents,
  };
}

function parsePaidSplit(raw) {
  if (!raw) return null;
  try {
    const split = JSON.parse(raw);
    const keys = ['taxCents', 'accommodationCents', 'optionsCents', 'resourcesCents'];
    return split && keys.every((k) => Number.isInteger(split[k])) ? split : null;
  } catch {
    return null;
  }
}

module.exports = { computeInstallmentPaidSplit, parsePaidSplit };
