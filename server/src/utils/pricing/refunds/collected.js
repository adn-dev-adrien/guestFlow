/**
 * REFUNDS / collected — what each line of a stay collected, in the books or in the caisse interne (rule 72).
 *
 * `collectedByLine` reads the captured contribs, the frozen complement split, the lines removed since and the notes.
 * PR B replaces it with SETTLEMENT's `settledCents`; until then it moves unchanged, legacy fallbacks included.
 * Tie rule of `settleSplitCents`: the cents left over go to the largest remainders, in the order of the lines.
 * Moved from `utils/refunds.js`. Pure. Keeps its own `round2`.
 */

const { readComplementPaidSplit } = require('../../complementPaidSplit');
const { parseDetail, parseNotes, settledByKey } = require('../../midStayExtras');
const { parseRemovedLineContribs } = require('../../removedLineContribs');
const { ACCOMMODATION_KEY, PLAN_BUCKET_LINES, STORED_SPLIT_ROUNDING_TTC, TOURIST_TAX_KEY, billedLineKey, bucketOfKey } = require('./register');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * specs/reservation-refunds.md rule 49 reading of 2026-11-02 — what each line of a stay collected, TTC, keyed like
 * `buildRefundableLines`: the paid acompte's and solde's contribs, plus a paid arrival complement's share (the lines
 * it collects whole, and the growth of the others). The tax share an older acompte captured was booked on its
 * accommodation, and moves to the tax with the solde (accountingModel's reclass). Without contribs that add up to
 * each paid entry, the accommodation and the tax read `booked` and the extras only the lines paid at arrival (0 while
 * the complement is unpaid); `null` when nothing is known: the lines then share the money with no per-line cap.
 * Book money by default; `cash` reads the entries collected in the caisse interne instead (audit R15-L1).
 * Reading of 2026-11-05 (audit R23 N6) — on the books, a paid end-of-stay complement and the notes held their lines too
 * (`collectedAfterArrival`). The caisse interne's stays on no line (review of PR #929, F4).
 */
function collectedByLine({ reservation, options = [], resources = [], booked = null, cash = false, taxOnArrival = true, splitShares = null }) {
  const row = reservation || {};
  const billed = [...options, ...resources].filter((line) => line && Number(line.offered || 0) !== 1);
  const nz = (value) => (value == null ? 0 : Number(value));
  // Rule 48 reading of 2026-11-02 (audit R15-L1) — the book money, or (`cash`) what the caisse interne collected.
  const paid = (flag, cashFlag) => Number(row[flag]) === 1 && (Number(row[cashFlag] || 0) === 1) === Boolean(cash);
  // specs/mixed-method-payments.md rule 46 — a bucket paid with several methods, partly on the books: each reading
  // holds its share of it (`paymentTenders.bucketSharesOf`), never the whole bucket.
  const shareOf = (bucket, flag, cashFlag) => {
    const split = splitShares && splitShares[bucket];
    if (split && Number(row[flag]) === 1 && !Number(row[cashFlag] || 0)) return cash ? split.internal : split.books;
    return paid(flag, cashFlag) ? 1 : 0;
  };
  const depositShare = shareOf('deposit', 'depositPaid', 'depositPaidCash');
  const balanceShare = shareOf('balance', 'balancePaid', 'balancePaidCash');
  const complementShare = shareOf('complement', 'complementPaid', 'complementPaidCash');
  const deposit = depositShare > 0;
  const balance = balanceShare > 0;
  const complement = complementShare > 0;
  // Rule 49 reading of 2026-11-05 (D11) — a paid line since removed still holds what its entries booked.
  const removed = parseRemovedLineContribs(row.removedLineContribs).map((entry) => ({ ...entry, removed: true, totalPrice: 0, isCustom: false }));
  const lines = [...billed, ...removed];
  const keyOf = (line) => (line.removed ? line.key : billedLineKey(line));
  const late = cash ? new Map() : collectedAfterArrival(row, splitShares);
  const lateOf = (key) => (late.has(key) ? late.get(key).amount : 0);
  // Rule 49 reading of 2026-11-05 (audit R22-6a) — what the complement was stamped with at its flip is what it collected.
  const split = complement ? readComplementPaidSplit(row) : null;
  const splitAccommodation = split ? split.accommodationCents / 100 : 0;
  const splitTax = split ? split.taxCents / 100 : 0;
  // A split that pro-rated its money names no line: the lines then read as they do without one.
  const splitLines = split && (split.lines || []).reduce((sum, line) => sum + line.cents, 0) === split.optionsCents + split.resourcesCents ? split.lines || [] : null;
  const splitOf = new Map((splitLines || []).map((line) => [line.key, line.cents / 100]));
  // Contribs describe a paid entry when they add up to it (accountingModel's tolerance); otherwise the export booked
  // it on the stored-money split, which knows no line.
  const describes = (field, lineField, taxField, amount) => Math.abs(round2(nz(row[field]) + nz(row[taxField])
    + lines.reduce((sum, line) => sum + nz(line[lineField]), 0)) - round2(amount)) <= 0.02;
  const known = (deposit || balance)
    && (!deposit || describes('accommodationAcompteContribTtc', 'acompteContribTtc', 'touristTaxAcompteContribTtc', row.depositAmount))
    && (!balance || describes('accommodationSoldeContribTtc', 'soldeContribTtc', 'touristTaxSoldeContribTtc', row.balanceAmount));
  const out = {};
  // Rule 55 (verification R34b-3) — a split's shares are not whole cents: its lines are summed exact and rounded once, at
  // the end (`settleSplitCents`), so they add up to the money received on each side, never a cent short.
  const exact = hasSplitShares(splitShares);
  const cent = (amount) => (exact ? amount : round2(amount));
  const add = (key, amount) => { out[key] = cent((out[key] || 0) + amount); };
  const addLateOffTheFiche = (onTheFiche) => {
    for (const [key, { amount }] of late) if (!onTheFiche.has(key)) add(key, amount);
  };
  if (!known) {
    // Without contribs that describe the money, the extras are known only as a bucket: a line paid at arrival collected
    // its amount once the complement is paid, nothing before. Reading of 2026-11-05 (audit R22-2): a complement alone
    // holds no line paid before arrival, unless a plan's installments hold them. The accommodation and the tax collected
    // what the acompte and the solde were booked on there (`booked`, bookedStayBuckets).
    const preArrivalKnownEmpty = (complement || late.size > 0) && !deposit && !balance && !(nz(row.installmentsPaidAmount) > 0);
    for (const line of billed) {
      const key = keyOf(line);
      if (!key) continue;
      const atDoor = lateOf(key);
      if (Number(line.inComplement || 0) === 1) add(key, atDoor + (!complement ? 0 : complementShare * (splitLines ? nz(splitOf.get(key)) : Math.max(0, round2(line.totalPrice - atDoor)))));
      else if (preArrivalKnownEmpty) add(key, atDoor + complementShare * nz(splitOf.get(key)));
    }
    const depositBuckets = deposit && booked ? booked.deposit : null;
    const soldeBuckets = balance && booked ? booked.solde : null;
    if ((!deposit || depositBuckets) && (!balance || soldeBuckets)) {
      const soldeTax = nz(soldeBuckets && soldeBuckets.touristTax);
      // Reading of 2026-11-05 (R22 verification, L1) — a plan's installments are book money on the accommodation and the
      // tax. Left out, the requalification came off the complement's money alone, whose sale room fell to 0: 42,40 €
      // collected stayed on no line of the register. A plan never sits beside a paid acompte or solde (D2).
      const plan = (!cash && booked && booked.installments) || { accommodation: 0, touristTax: 0, options: 0, resources: 0 };
      out[ACCOMMODATION_KEY] = cent(depositShare * nz(depositBuckets && depositBuckets.accommodation) + balanceShare * nz(soldeBuckets && soldeBuckets.accommodation)
        + plan.accommodation + (!complement ? 0 : complementShare * (split ? splitAccommodation : nz(row.extraGuestComplementSurcharge))));
      out[TOURIST_TAX_KEY] = cent(plan.touristTax + (!complement
        ? balanceShare * soldeTax
        : (split ? balanceShare * soldeTax + complementShare * splitTax
          : complementShare * (balance || taxOnArrival ? round2(row.touristTaxTotal) : nz(row.touristTaxAddedGuestsAmount)))));
      // Reading of 2026-11-05 (audit R23 N5) — what the plan booked on a bucket beyond the lines still naming it: a paid line
      // removed, lowered or moved to the complement since. The cents a split rounds are not a line.
      for (const { bucket, key } of PLAN_BUCKET_LINES) {
        const held = billed.filter((line) => Number(line.inComplement || 0) !== 1 && bucketOfKey(keyOf(line)) === bucket)
          .reduce((sum, line) => sum + Math.max(0, Number(line.totalPrice) || 0), 0);
        const beyond = round2(nz(plan[bucket]) - held);
        if (beyond > STORED_SPLIT_ROUNDING_TTC) out[key] = beyond;
      }
    }
    addLinesOnlyTheSplitNames(out, splitOf, billed, complementShare, cent);
    addLateOffTheFiche(new Set(billed.map(keyOf)));
    takeGesteOff(out, splitShares, cash);
    settleSplitCents(out, exact);
    return Object.keys(out).length ? out : null;
  }
  for (const line of lines) {
    const key = keyOf(line);
    if (!key) continue;
    const atDoor = lateOf(key);
    const total = Math.max(0, round2(line.totalPrice - atDoor));
    let atArrival = 0;
    if (complement && splitLines) atArrival = nz(splitOf.get(key));
    else if (complement && Number(line.inComplement || 0) === 1) atArrival = total;
    else if (complement && balance) atArrival = Math.max(0, round2(total - nz(line.acompteContribTtc) - nz(line.soldeContribTtc)));
    add(key, depositShare * nz(line.acompteContribTtc) + balanceShare * nz(line.soldeContribTtc) + complementShare * atArrival + atDoor);
  }
  const extrasTtc = round2(billed.reduce((sum, line) => sum + Number((line && line.totalPrice) || 0), 0));
  const accommodationTtc = Math.max(0, round2(Number(row.finalPrice || 0) - extrasTtc));
  const acompteTax = nz(row.touristTaxAcompteContribTtc);
  const accommodationContribs = nz(row.accommodationAcompteContribTtc) + nz(row.accommodationSoldeContribTtc);
  let complementAccommodation = 0;
  if (complement) {
    if (split) complementAccommodation = splitAccommodation;
    else complementAccommodation = balance ? Math.max(0, accommodationTtc - accommodationContribs) : nz(row.extraGuestComplementSurcharge);
  }
  out[ACCOMMODATION_KEY] = cent(depositShare * (nz(row.accommodationAcompteContribTtc) + acompteTax)
    + balanceShare * Math.max(0, nz(row.accommodationSoldeContribTtc) - acompteTax)
    + complementShare * complementAccommodation);
  const taxContribs = acompteTax + nz(row.touristTaxSoldeContribTtc);
  let complementTax = 0;
  if (complement) {
    if (split) complementTax = splitTax;
    else complementTax = balance || taxOnArrival ? Math.max(0, round2(row.touristTaxTotal) - taxContribs) : nz(row.touristTaxAddedGuestsAmount);
  }
  out[TOURIST_TAX_KEY] = cent(balanceShare * taxContribs + complementShare * complementTax);
  addLinesOnlyTheSplitNames(out, splitOf, lines, complementShare, cent);
  addLateOffTheFiche(new Set(lines.map(keyOf)));
  takeGesteOff(out, splitShares, cash);
  settleSplitCents(out, exact);
  return out;
}

const hasSplitShares = (splitShares) => Boolean(splitShares) && Object.keys(splitShares).length > 0;

// specs/mixed-method-payments.md rule 52 (audit R34 NEW-3) — the geste commercial of a split payment, its lines read gross
// (`bucketSharesOf`), comes off the accommodation, as the export books it on 70900000. Rule 54 (verification R34b-2): a geste
// the accommodation cannot hold (a complement paid before the solde) comes off the other lines for the rest, the extras
// pro rata, the tax last, so no line answers for more than it collected.
function takeGesteOff(out, splitShares, cash) {
  if (!splitShares) return;
  let geste = Object.values(splitShares).reduce((sum, s) => sum + Number((cash ? s.waivedInternal : s.waivedBooks) || 0), 0);
  if (!(geste > 0)) return;
  const takeFrom = (key, amount) => {
    const taken = Math.min(amount, Math.max(0, out[key] || 0));
    if (taken > 0) out[key] -= taken;
    geste -= taken;
  };
  if (out[ACCOMMODATION_KEY] != null) takeFrom(ACCOMMODATION_KEY, geste);
  const extras = Object.keys(out).filter((key) => key !== ACCOMMODATION_KEY && key !== TOURIST_TAX_KEY && out[key] > 0);
  const held = extras.reduce((sum, key) => sum + out[key], 0);
  if (geste > 0 && held > 0) {
    const share = Math.min(1, geste / held);
    for (const key of extras) takeFrom(key, out[key] * share);
  }
  if (geste > 1e-9 && out[TOURIST_TAX_KEY] != null) takeFrom(TOURIST_TAX_KEY, geste);
}

// Rule 55 (verification R34b-3) — the exact amounts of a split reading, in cents that add up to their exact total:
// each line its whole cents, the cents left to the lines with the largest remainders (largest-remainder rounding). Any
// other reading is in cents per line (a geste spread over the extras, rule 54, included).
function settleSplitCents(out, exact) {
  const keys = Object.keys(out);
  if (!exact) {
    for (const key of keys) out[key] = round2(out[key]);
    return;
  }
  const exactCents = keys.map((key) => Math.max(0, Math.round(Number(out[key]) * 1e8) / 1e6));
  const floors = exactCents.map((c) => Math.floor(c));
  let left = Math.round(exactCents.reduce((sum, c) => sum + c, 0)) - floors.reduce((sum, c) => sum + c, 0);
  const order = keys.map((_, i) => i).sort((a, b) => (exactCents[b] - floors[b]) - (exactCents[a] - floors[a]) || a - b);
  for (const i of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  keys.forEach((key, i) => { out[key] = floors[i] / 100; });
}

// What a stay collected after its arrival on the books, per line key: a paid end-of-stay complement's lines (the excess of
// rule 20 under its own key, booked as a prestation) and the notes. A SAS line with no key names no line of the fiche.
function collectedAfterArrival(row, splitShares = null) {
  const out = new Map();
  const add = (key, label, amount) => {
    if (!key || !(amount > 0)) return;
    const known = out.get(key);
    out.set(key, { label: (known && known.label) || label, amount: round2((known ? known.amount : 0) + amount) });
  };
  if (Number(row.endOfStayComplementPaid) === 1 && !Number(row.endOfStayComplementPaidCash || 0)) {
    // specs/mixed-method-payments.md rule 46 — paid with several methods: only its share on the books.
    const split = splitShares && splitShares.endOfStayComplement;
    const share = split ? split.books : 1;
    for (const line of parseDetail(row.endOfStayComplementDetail)) if (line) add(line.key, line.label, round2(share * (Number(line.amount) || 0)));
  }
  const notes = parseNotes(row.midStaySettledNotes).filter((note) => note && !Number(note.paidCash || 0));
  const labels = new Map(notes.flatMap((note) => note.lines || []).map((line) => [line && line.key, line && line.label]));
  for (const [key, amount] of Object.entries(settledByKey(notes))) add(key, labels.get(key), amount);
  return out;
}

// A line the complement's split names that left the fiche since: what it collected still reads on its key.
function addLinesOnlyTheSplitNames(out, splitOf, lines, share = 1, cent = round2) {
  const onTheFiche = new Set(lines.map((line) => (line.removed ? line.key : billedLineKey(line))));
  for (const [key, amount] of splitOf) {
    if (!onTheFiche.has(key)) out[key] = cent((out[key] || 0) + share * amount);
  }
}

/**
 * Rule 49 reading of 2026-11-05 (D11) — the lines that collected money and are no longer on the fiche: the paid lines
 * removed since, and those a collected complement names. `collected` is `collectedByLine`'s reading of the same stay,
 * book money and caisse interne together.
 */
function collectedLinesGone({ reservation, options = [], resources = [], collected = null, cashCollected = null }) {
  const row = reservation || {};
  const onTheFiche = new Set([...options, ...resources].filter((line) => line && Number(line.offered || 0) !== 1).map(billedLineKey));
  const named = new Map();
  for (const entry of parseRemovedLineContribs(row.removedLineContribs)) named.set(entry.key, entry);
  for (const line of (readComplementPaidSplit(row) || { lines: [] }).lines || []) named.set(line.key, line);
  for (const [key, { label }] of collectedAfterArrival(row)) named.set(key, { label, bucket: bucketOfKey(key) });
  for (const line of PLAN_BUCKET_LINES) named.set(line.key, line);
  const gone = [];
  for (const [key, entry] of named) {
    if (onTheFiche.has(key)) continue;
    const collectedTtc = round2(Number((collected && collected[key]) || 0) + Number((cashCollected && cashCollected[key]) || 0));
    if (collectedTtc > 0) gone.push({ key, label: entry.label || 'Prestation', bucket: entry.bucket === 'resources' ? 'resources' : 'options', collectedTtc });
  }
  return gone;
}

module.exports = {
  collectedByLine,
  hasSplitShares,
  takeGesteOff,
  settleSplitCents,
  collectedAfterArrival,
  addLinesOnlyTheSplitNames,
  collectedLinesGone,
};
