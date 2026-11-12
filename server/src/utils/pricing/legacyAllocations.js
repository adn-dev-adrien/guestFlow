/**
 * LEGACY ALLOCATIONS — which payment covered which line, read from what a stay stored before `payment_allocations`
 * existed (specs/pricing-components.md §3 rules 36, 74, §5 « Backfill »).
 *
 * A payment is split over the lines it covered only where the stay kept that truth:
 *
 *   deposit / balance      the contribs captured at the flip (line columns, the stay's accommodation and tax columns,
 *                          the contribs of paid lines since removed), when they add up to the bucket
 *   complement             the frozen split (`complementPaidSplit`), when its lines add up to its options and resources
 *   end of stay            the detail lines, when they add up to the amount
 *   mid-stay note          the note's lines, when they add up to its total
 *   installment            its frozen `paidSplit`, when its lines add up
 *   settlement             what it RECEIVED (due minus the reste or the geste), books and caisse interne apart, on the
 *                          stay as a whole: a settlement names a bucket, not a line (rule 50 pools several buckets)
 *
 * A bucket the stay holds no per-line truth for gets no row here unless `stayLevel` is given: then it gets its stay-level
 * rows (`lineRef` NULL, the tourist tax on the stay's tax line where the legacy routing puts it, through
 * `legacyBucketSplit`), so Σ allocations of a paid bucket is the bucket. A bucket a live settlement covers is read from the
 * settlement only, never twice. A line the
 * stay no longer holds (a paid line since removed) is money on the stay with no line: `lineRef` NULL.
 * No amount is rewritten (rule 36). Pure: no DB, no clock, no settings.
 *
 *   legacyAllocations({ reservation, lines, stayLines, removed, complementSplit, endOfStayDetail, notes, installments, settlements, stayLevel })
 *     → [{ paymentRef, lineRef, amountCents, at, books }]   `books` 1 = the books, 0 = the caisse interne
 *   `lines`: [{ ref, key, acompteContribTtc, soldeContribTtc }]; `stayLines`: { accommodation, touristTax } refs or null;
 *   `removed`: [{ key, acompteContribTtc, soldeContribTtc }]; `installments`: [{ id, paid, paidDate, amountCents, paidSplit }];
 *   `stayLevel`: null, or { taxRoutedToComplement } (the legacy routing of the tourist tax, read by the caller);
 *   `settlements`: [{ id, targetKind, targetKey, paidDate, dueCents, shortfallCents, parts: [{ kind }], tenders: [{ amountCents, internal }] }]
 */
const { toCents: cents } = require('./money');
const { extraLineKey } = require('./storedLines');
const { computeTaxTtcForKind } = require('../accounting/legacyBucketSplit');

const TOLERANCE_CENTS = 2;
const nz = (value) => (value == null ? 0 : Number(value));

const BUCKETS = {
  deposit: { flag: 'depositPaid', cash: 'depositPaidCash', date: 'depositPaidDate', amount: 'depositAmount' },
  balance: { flag: 'balancePaid', cash: 'balancePaidCash', date: 'balancePaidDate', amount: 'balanceAmount' },
  complement: { flag: 'complementPaid', cash: 'complementPaidCash', date: 'complementPaidDate', amount: 'complementAmount' },
  endOfStayComplement: { flag: 'endOfStayComplementPaid', cash: 'endOfStayComplementPaidCash', date: 'endOfStayComplementPaidDate', amount: 'endOfStayComplementAmount' },
};

function legacyAllocations({
  reservation, lines = [], stayLines = {}, removed = [], complementSplit = null, endOfStayDetail = [], notes = [], installments = [], settlements = [],
  stayLevel = null,
}) {
  const row = reservation || {};
  const rows = new Map();
  const add = (paymentRef, lineRef, amountCents, at, books) => {
    if (!Number.isInteger(amountCents) || amountCents === 0) return;
    const key = `${paymentRef}|${lineRef || ''}|${books}`;
    const held = rows.get(key);
    if (held) held.amountCents += amountCents;
    else rows.set(key, { paymentRef, lineRef: lineRef || null, amountCents, at: at || null, books });
  };
  const refOfKey = (key) => {
    if (key === 'accommodation') return stayLines.accommodation || null;
    if (key === 'touristTax') return stayLines.touristTax || null;
    const matches = lines.filter((line) => line.key === key);
    return matches.length === 1 ? matches[0].ref : null;
  };
  const paid = (kind) => Number(row[BUCKETS[kind].flag]) === 1;

  // Settlements first: the buckets, notes and installments a live one covers are read from it alone.
  const coveredBuckets = new Set();
  const coveredNotes = new Set();
  const coveredInstallments = new Set();
  for (const settlement of settlements) {
    const parts = (settlement.parts || []).map((part) => part.kind);
    const live = settlement.targetKind === 'midStayNote'
      ? notes.some((note) => String(note && note.id) === String(settlement.targetKey))
      : settlement.targetKind === 'installment'
        ? installments.some((installment) => String(installment.id) === String(settlement.targetKey) && Number(installment.paid) === 1)
        : parts.length > 0 && parts.every((kind) => BUCKETS[kind] && paid(kind));
    if (!live) continue;
    if (settlement.targetKind === 'midStayNote') coveredNotes.add(String(settlement.targetKey));
    else if (settlement.targetKind === 'installment') coveredInstallments.add(String(settlement.targetKey));
    else parts.forEach((kind) => coveredBuckets.add(kind));
    const received = Math.max(0, Number(settlement.dueCents || 0) - Number(settlement.shortfallCents || 0));
    const internal = Math.min(received, (settlement.tenders || []).filter((t) => Number(t.internal) === 1).reduce((sum, t) => sum + Number(t.amountCents || 0), 0));
    add(`settlement:${settlement.id}`, null, received - internal, settlement.paidDate, 1);
    add(`settlement:${settlement.id}:caisse`, null, internal, settlement.paidDate, 0);
  }

  // Deposit and balance: the contribs captured at the flip, when they describe the paid entry.
  for (const [kind, contribColumn, accommodationColumn, taxColumn] of [
    ['deposit', 'acompteContribTtc', 'accommodationAcompteContribTtc', 'touristTaxAcompteContribTtc'],
    ['balance', 'soldeContribTtc', 'accommodationSoldeContribTtc', 'touristTaxSoldeContribTtc'],
  ]) {
    if (!paid(kind) || coveredBuckets.has(kind)) continue;
    const held = [...lines, ...removed];
    const described = cents(nz(row[accommodationColumn]) + nz(row[taxColumn]) + held.reduce((sum, line) => sum + nz(line[contribColumn]), 0));
    if (Math.abs(described - cents(row[BUCKETS[kind].amount])) > TOLERANCE_CENTS) continue;
    const spec = BUCKETS[kind];
    const books = Number(row[spec.cash]) === 1 ? 0 : 1;
    const ref = `bucket:${kind}`;
    add(ref, stayLines.accommodation, cents(row[accommodationColumn]), row[spec.date], books);
    add(ref, stayLines.touristTax, cents(row[taxColumn]), row[spec.date], books);
    for (const line of lines) add(ref, line.ref, cents(line[contribColumn]), row[spec.date], books);
    for (const line of removed) add(ref, null, cents(line[contribColumn]), row[spec.date], books);
  }

  // The arrival complement: its frozen split, when the lines it names add up.
  if (paid('complement') && !coveredBuckets.has('complement') && complementSplit
      && (complementSplit.lines || []).reduce((sum, line) => sum + line.cents, 0) === complementSplit.optionsCents + complementSplit.resourcesCents) {
    const spec = BUCKETS.complement;
    const books = Number(row[spec.cash]) === 1 ? 0 : 1;
    add('bucket:complement', stayLines.accommodation, complementSplit.accommodationCents, row[spec.date], books);
    add('bucket:complement', stayLines.touristTax, complementSplit.taxCents, row[spec.date], books);
    for (const line of complementSplit.lines || []) add('bucket:complement', refOfKey(line.key), line.cents, row[spec.date], books);
  }

  // The end-of-stay complement: its detail lines, when they add up to it.
  if (paid('endOfStayComplement') && !coveredBuckets.has('endOfStayComplement')) {
    const spec = BUCKETS.endOfStayComplement;
    const detail = (endOfStayDetail || []).map((line) => ({ key: line.key || extraLineKey(line), cents: cents(line.amount) })).filter((line) => line.cents > 0);
    if (detail.length && Math.abs(detail.reduce((sum, line) => sum + line.cents, 0) - cents(row[spec.amount])) <= TOLERANCE_CENTS) {
      const books = Number(row[spec.cash]) === 1 ? 0 : 1;
      for (const line of detail) add('bucket:endOfStay', refOfKey(line.key), line.cents, row[spec.date], books);
    }
  }

  // The mid-stay notes: each note's lines, when they add up to its total.
  for (const note of notes) {
    if (!note || coveredNotes.has(String(note.id))) continue;
    const noteLines = (note.lines || []).map((line) => ({ key: line.key || extraLineKey(line), cents: cents(line.amount) })).filter((line) => line.cents > 0);
    if (!noteLines.length || Math.abs(noteLines.reduce((sum, line) => sum + line.cents, 0) - cents(note.total)) > TOLERANCE_CENTS) continue;
    for (const line of noteLines) add(`note:${note.id}`, refOfKey(line.key), line.cents, note.paidDate, Number(note.paidCash) === 1 ? 0 : 1);
  }

  // The paid installments: their frozen split.
  for (const installment of installments) {
    const split = installment.paidSplit;
    if (Number(installment.paid) !== 1 || coveredInstallments.has(String(installment.id)) || !split) continue;
    if ((split.lines || []).reduce((sum, line) => sum + line.cents, 0) !== nz(split.optionsCents) + nz(split.resourcesCents)) continue;
    const ref = `installment:${installment.id}`;
    add(ref, stayLines.accommodation, nz(split.accommodationCents), installment.paidDate, 1);
    add(ref, stayLines.touristTax, nz(split.taxCents), installment.paidDate, 1);
    for (const line of split.lines || []) add(ref, refOfKey(line.key), line.cents, installment.paidDate, 1);
  }

  if (stayLevel) addStayLevel();

  return [...rows.values()];

  // Every paid bucket, settled note and paid installment the rows above do not hold gets its stay-level rows: the tourist tax
  // where the legacy routing books it, the rest on no line. A plan replaces the deposit and the balance (the accounting reads
  // none of them), a settlement already holds what it covers.
  function addStayLevel() {
    const held = (ref) => [...rows.values()].some((r) => r.paymentRef === ref);
    const hasPlan = installments.length > 0;
    for (const kind of ['deposit', 'balance', 'complement', 'endOfStayComplement']) {
      const spec = BUCKETS[kind];
      const ref = kind === 'endOfStayComplement' ? 'bucket:endOfStay' : `bucket:${kind}`;
      const amount = cents(row[spec.amount]);
      if (!paid(kind) || coveredBuckets.has(kind) || held(ref) || amount <= 0) continue;
      if (hasPlan && (kind === 'deposit' || kind === 'balance')) continue;
      const books = Number(row[spec.cash]) === 1 ? 0 : 1;
      const tax = kind === 'endOfStayComplement' ? 0
        : Math.min(amount, cents(computeTaxTtcForKind(row, kind, stayLevel.taxRoutedToComplement, amount / 100)));
      add(ref, stayLines.touristTax, tax, row[spec.date], books);
      add(ref, null, amount - tax, row[spec.date], books);
    }
    for (const note of notes) {
      if (!note || coveredNotes.has(String(note.id)) || held(`note:${note.id}`)) continue;
      add(`note:${note.id}`, null, cents(note.total), note.paidDate, Number(note.paidCash) === 1 ? 0 : 1);
    }
    for (const installment of installments) {
      if (Number(installment.paid) !== 1 || coveredInstallments.has(String(installment.id)) || held(`installment:${installment.id}`)) continue;
      add(`installment:${installment.id}`, null, Number(installment.amountCents || 0), installment.paidDate, 1);
    }
  }
}

module.exports = { legacyAllocations };
