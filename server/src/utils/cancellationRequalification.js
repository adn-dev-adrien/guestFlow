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
 * strictly better than emitting an avoir that does not sum to the money kept. Since rule 55's reading of
 * 2026-11-02 the cancellation hands such an acompte the stored-money split the export booked it on
 * (utils/storedMoneySplit), so that line is left for a caller with no split at all.
 */
function requalificationLines(depositTtc, depositBuckets, vatRate) {
  const buckets = depositBuckets || {};
  const entries = ['accommodation', 'options', 'resources']
    .map((bucket) => ({ bucket, amountTtc: round2(buckets[bucket]) }))
    .filter((line) => line.amountTtc > 0);
  const sum = round2(entries.reduce((total, line) => total + line.amountTtc, 0));

  if (entries.length === 0 || Math.abs(sum - depositTtc) > 0.02) {
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

  // Rule 55 reading of 2026-11-02 — contribs a cent or two off the acompte (the rounding of their capture) snap
  // their last bucket onto it: the avoir never reverses more, or less, than the acompte collected.
  const last = entries[entries.length - 1];
  last.amountTtc = round2(last.amountTtc + depositTtc - sum);
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
 * The avoir lines of the installments collected under a plan (specs/direct-installments.md rule 46). Each was
 * booked on its own split (rule 47): the revenue per bucket at the sales VAT rate, split HT / VAT installment
 * by installment, plus its share of the tourist tax at 0 % (rule 39). The avoir reverses each installment's
 * buckets on a line of their own, « Hébergement — échéance 1/3 », so the export can split every line the way
 * its encaissement was split and each account nets to the cent. The tax carries no VAT: one line.
 */
function installmentLines(amountTtc, touristTaxTtc, installments, vatRate) {
  const tax = Math.min(round2(touristTaxTtc), amountTtc);
  const lines = [];
  for (const installment of installments || []) {
    const stay = round2(installment.accommodation + installment.options + installment.resources);
    if (stay <= 0) continue;
    const suffix = ` — échéance ${installment.number}/${installment.count}`;
    for (const line of requalificationLines(stay, installment, vatRate)) lines.push({ ...line, label: `${line.label}${suffix}` });
  }
  if (tax > 0) {
    lines.push({ lineKey: 'touristTax', label: 'Taxe de séjour', bucket: 'touristTax', quantity: null, unitPrice: null, amountTtc: tax, vatRate: 0 });
  }
  return lines;
}

const NETTED_BUCKETS = ['accommodation', 'options', 'resources', 'touristTax'];

// Takes `cents` off the lines, the largest first (the later one on a tie), and returns what none could hold.
function absorb(lines, cents) {
  let left = cents;
  const order = lines.map((line, index) => ({ line, index })).sort((a, b) => b.line.cents - a.line.cents || b.index - a.index);
  for (const { line } of order) {
    if (left <= 0) break;
    const taken = Math.min(left, line.cents);
    line.cents -= taken;
    left -= taken;
  }
  return left;
}

// A bucket the acompte credited nothing on, which the avoir now requalifies out of the paid solde (rule 55 reading of
// 2026-11-02). `unitPrice` 0: the acompte booked nothing there.
function soldeLine(bucket, vatRate) {
  return bucket === 'touristTax'
    ? { lineKey: 'touristTax', label: 'Taxe de séjour', bucket, quantity: null, unitPrice: null, amountTtc: 0, vatRate: 0, origin: 'deposit' }
    : { lineKey: bucket, label: BUCKET_LABELS[bucket], bucket, quantity: null, unitPrice: 0, amountTtc: 0, vatRate, origin: 'deposit' };
}

/**
 * specs/payment-schedule-and-cancellation.md rule 55 — a book refund made before the cancellation already took its
 * money out of the revenue, the VAT or the tax account: the cancellation keeps only what is left.
 *
 * A paid solde (`saleCollected`, what it collected per bucket) absorbs the earlier refunds first, the order rule 48
 * gives back a cancelled stay's money, and it is ONE sum: the acompte loses only what the whole solde could not hold,
 * Σ given − Σ collected. Per bucket, a refund beyond what the solde collected there comes off the bucket's
 * requalified lines, the largest line first (what a bucket cannot hold comes off the other lines); the solde money
 * of the other buckets that covered it is requalified in its place, on those buckets, so each bucket of the avoir
 * reverses what the books still hold there and the sale money left is the solde's own, bucket by bucket.
 *
 * An adjusted line keeps the TTC it was booked on as `unitPrice` (0 for a bucket the acompte never credited),
 * `quantity` being the share kept, so the export can mirror its split to the cent.
 */
function netOfEarlierRefunds(lines, givenBack, saleCollected) {
  const given = givenBack || {};
  const sale = saleCollected || {};
  const cents = (value) => Math.round(Number(value || 0) * 100);
  const work = lines.map((line) => ({ line, cents: cents(line.amountTtc) }));
  const excess = {};
  const spare = {};
  for (const bucket of NETTED_BUCKETS) {
    excess[bucket] = Math.max(0, cents(given[bucket]) - cents(sale[bucket]));
    spare[bucket] = Math.max(0, cents(sale[bucket]) - cents(given[bucket]));
  }
  const total = (map) => NETTED_BUCKETS.reduce((sum, bucket) => sum + map[bucket], 0);
  let cover = Math.min(total(excess), total(spare));
  let spill = 0;
  for (const bucket of NETTED_BUCKETS) spill += absorb(work.filter((entry) => entry.line.bucket === bucket), excess[bucket]);
  absorb(work, spill);
  const vatRate = (lines.find((line) => line.bucket !== 'touristTax') || {}).vatRate || 0;
  for (const bucket of NETTED_BUCKETS) {
    const added = Math.min(spare[bucket], cover);
    if (added <= 0) continue;
    cover -= added;
    const own = work.filter((entry) => entry.line.bucket === bucket).sort((x, y) => y.cents - x.cents)[0];
    if (own) own.cents += added;
    else work.push({ line: soldeLine(bucket, vatRate), cents: added });
  }
  return work.filter((entry) => entry.cents > 0).map(({ line, cents: kept }) => {
    if (kept === cents(line.amountTtc)) return line;
    const amountTtc = kept / 100;
    if (line.unitPrice == null) return { ...line, amountTtc };
    const booked = cents(line.amountTtc);
    return { ...line, amountTtc, unitPrice: line.amountTtc, quantity: booked > 0 ? Math.round((kept / booked) * 10000) / 10000 : null };
  });
}

/**
 * @param {object} input
 * @param {object} input.reservation      row with id, propertyId, propertyName, platform, firstName,
 *                                        lastName, startDate, endDate, finalPrice, depositAmount,
 *                                        depositPaid
 * @param {object} [input.depositBuckets] `{ accommodation, options, resources }` TTC shares of the acompte
 * @param {object} [input.installmentsRetained] `{ amountTtc, touristTaxTtc, installments }` — what the
 *                                        installments of a plan collected, the tourist tax inside it, and per
 *                                        paid installment `{ number, count, accommodation, options, resources }`
 *                                        the TTC it was booked on
 * @param {object} [input.givenBack]    `{ accommodation, options, resources, touristTax }` TTC the book refunds made
 *                                        before the cancellation gave back (payment-schedule spec rule 55)
 * @param {object} [input.saleCollected] the same buckets, TTC collected outside the requalified money (a paid solde):
 *                                        it absorbs those refunds first
 * @param {string} input.cancellationDate YYYY-MM-DD — the day the requalification is booked
 * @param {number} input.vatRate          the sales VAT rate the acompte was booked at
 * @param {string} [input.reason]         operator's cancellation reason, carried on both records
 * @returns {{retainedTtc:number, depositTtc:number, installmentsTtc:number, refund:object, compensation:object}|null}
 *          null when there is no collected acompte nor installment to requalify — a cancellation then
 *          books nothing (rule 27).
 */
function buildCancellationRequalification({
  reservation,
  depositBuckets = null,
  installmentsRetained = null,
  givenBack = null,
  saleCollected = null,
  cancellationDate,
  vatRate = 0,
  reason = '',
} = {}) {
  const row = reservation || {};
  const grossDepositTtc = Number(row.depositPaid) ? Math.max(0, round2(row.depositAmount)) : 0;
  const grossInstallmentsTtc = Math.max(0, round2(installmentsRetained && installmentsRetained.amountTtc));
  if (round2(grossDepositTtc + grossInstallmentsTtc) <= 0) return null;

  const label = grossInstallmentsTtc > 0 ? 'Annulation — échéances conservées' : 'Annulation — acompte conservé';
  const note = String(reason || '').trim();
  const rate = Number(vatRate) || 0;
  const gross = [
    ...(grossDepositTtc > 0 ? requalificationLines(grossDepositTtc, depositBuckets, rate).map((line) => ({ ...line, origin: 'deposit' })) : []),
    ...(grossInstallmentsTtc > 0
      ? installmentLines(grossInstallmentsTtc, installmentsRetained.touristTaxTtc, installmentsRetained.installments, rate).map((line) => ({ ...line, origin: 'installments' }))
      : []),
  ];
  const lines = netOfEarlierRefunds(gross, givenBack, saleCollected);
  // Rule 55 reading of 2026-11-02 — what is kept is the money collected minus what the earlier refunds took from it,
  // per origin: an installment split a cent short of its amount keeps the gap where it always was, off the lines.
  const takenOf = (origin) => {
    const before = round2(gross.filter((line) => line.origin === origin).reduce((total, line) => total + line.amountTtc, 0));
    const after = round2(lines.filter((line) => line.origin === origin).reduce((total, line) => total + line.amountTtc, 0));
    return round2(before - after);
  };
  const depositTtc = Math.max(0, round2(grossDepositTtc - takenOf('deposit')));
  const installmentsTtc = Math.max(0, round2(grossInstallmentsTtc - takenOf('installments')));
  const retainedTtc = round2(depositTtc + installmentsTtc);
  if (retainedTtc <= 0 || lines.length === 0) return null;

  return {
    retainedTtc,
    depositTtc,
    installmentsTtc,
    refund: {
      reservationId: Number(row.id),
      refundDate: cancellationDate,
      method: 'retained',
      reason: note ? `${label} : ${note}` : label,
      lines: lines.map(({ origin, ...line }) => line),
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
      receivedAmount: retainedTtc,
      receivedDate: cancellationDate,
      origin: 'retained_deposit',
      notes: note,
    },
  };
}

module.exports = { buildCancellationRequalification, __test: { requalificationLines, installmentLines, netOfEarlierRefunds, round2 } };
