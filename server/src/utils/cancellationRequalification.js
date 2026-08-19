/**
 * Requalifying a retained acompte (specs/payment-schedule-and-cancellation.md §3.6).
 *
 * When a stay is cancelled because the solde never came, the acompte we already cashed stops being a
 * payment for a séjour and becomes an **indemnité** — legally outside the scope of VAT (CJUE Société
 * thermale d'Eugénie-les-Bains, C-277/05), exactly like the compensation a platform pays after a
 * cancellation. But the money was booked, on its payment date, as a séjour encaissement with
 * hébergement VAT, in a month that may already be at the accountant's. That entry must not move.
 *
 * So the cancellation books the requalification in ITS OWN month, as two mirrored entries:
 *   - an **avoir** (method `retained`: book money, no bank movement) that credits the client account
 *     and debits back the revenue + VAT the acompte had credited;
 *   - an **indemnité** born `received`, which debits the client account and credits the « produits
 *     divers » account VAT-free.
 * Client account nets to zero, cash position unchanged, revenue reclassified. That is the whole point.
 *
 * Pure: no DB, no clock. The caller reads the reservation and the acompte's per-bucket contributions
 * (the same columns accounting uses to build the deposit entry) and injects them.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const BUCKET_LABELS = {
  accommodation: 'Hébergement',
  options: 'Options',
  resources: 'Équipements',
};

/**
 * Split the retained acompte into avoir lines. The per-bucket acompte contributions are the exact
 * shares accounting credited when the acompte was cashed, so reversing them line by line mirrors the
 * original entry. When they are absent (a reservation predating the contrib capture) or when they
 * disagree with the acompte actually stored, a single accommodation line carries the whole amount:
 * the total and the VAT reversed stay exact — only the 70xxx sub-account is approximated, which is
 * strictly better than emitting an avoir that does not sum to the money kept.
 */
function requalificationLines(depositTtc, depositBuckets, vatRate) {
  const buckets = depositBuckets || {};
  const entries = ['accommodation', 'options', 'resources']
    .map((bucket) => ({ bucket, amountTtc: round2(buckets[bucket]) }))
    .filter((line) => line.amountTtc > 0);
  const sum = round2(entries.reduce((total, line) => total + line.amountTtc, 0));

  if (entries.length === 0 || Math.abs(sum - depositTtc) > 0.01) {
    return [{
      lineKey: 'accommodation',
      label: BUCKET_LABELS.accommodation,
      bucket: 'accommodation',
      quantity: 1,
      unitPrice: depositTtc,
      amountTtc: depositTtc,
      vatRate,
    }];
  }

  return entries.map((line) => ({
    lineKey: line.bucket,
    label: BUCKET_LABELS[line.bucket],
    bucket: line.bucket,
    quantity: 1,
    unitPrice: line.amountTtc,
    amountTtc: line.amountTtc,
    vatRate,
  }));
}

/**
 * @param {object} input
 * @param {object} input.reservation      row with id, propertyId, propertyName, platform, firstName,
 *                                        lastName, startDate, endDate, finalPrice, depositAmount,
 *                                        depositPaid
 * @param {object} [input.depositBuckets] `{ accommodation, options, resources }` TTC shares of the acompte
 * @param {string} input.cancellationDate YYYY-MM-DD — the day the requalification is booked
 * @param {number} input.vatRate          the sales VAT rate the acompte was booked at
 * @param {string} [input.reason]         operator's cancellation reason, carried on both records
 * @returns {{depositTtc:number, refund:object, compensation:object}|null} null when there is no
 *          collected acompte to requalify — a cancellation then books nothing (rule 27).
 */
function buildCancellationRequalification({
  reservation,
  depositBuckets = null,
  cancellationDate,
  vatRate = 0,
  reason = '',
} = {}) {
  const row = reservation || {};
  const depositTtc = round2(row.depositAmount);
  if (!Number(row.depositPaid) || depositTtc <= 0) return null;

  const label = 'Annulation — acompte conservé';
  const note = String(reason || '').trim();

  return {
    depositTtc,
    refund: {
      reservationId: Number(row.id),
      refundDate: cancellationDate,
      method: 'retained',
      reason: note ? `${label} : ${note}` : label,
      lines: requalificationLines(depositTtc, depositBuckets, Number(vatRate) || 0),
    },
    compensation: {
      reservationId: Number(row.id),
      propertyId: row.propertyId == null ? null : Number(row.propertyId),
      propertyName: row.propertyName || '',
      platform: row.platform || 'direct',
      clientFirstName: row.firstName || '',
      clientLastName: row.lastName || '',
      startDate: row.startDate || null,
      endDate: row.endDate || null,
      cancelledStayAmount: round2(row.finalPrice),
      receivedAmount: depositTtc,
      receivedDate: cancellationDate,
      origin: 'retained_deposit',
      notes: note,
    },
  };
}

module.exports = { buildCancellationRequalification, __test: { requalificationLines, round2 } };
