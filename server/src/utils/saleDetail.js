/**
 * saleDetail — the one read model of what a stay sold and what is left to collect (specs/pricing/pricing-components.md §3 rule 31).
 *
 * `buildSaleDetail({ quote, facts, phase, vatClassOf, platformStay, stored })` turns the quote of the stored stay (TOTALS and SETTLEMENT already ran)
 * and the facts of its stored lines into a ready-to-render payload: every amount in cents, every label French. A stored line bills what it
 * stores (`facts[key].storedCents`, its amount before its own discounts, rules 12, 74), and with `stored` (`{ finalCents, touristTaxCents }`, the stay's stored figures) the
 * accommodation is what the stored stay price leaves once its lines are counted: a stay whose engine price drifted since it was sold reads
 * as sold, never as re-priced. The fiche, the SAS
 * recaps and the e-mails render it and sum nothing (CLAUDE.md §6.0).
 *
 *   lines[]   { ref, kind, label, quantity, totalCents (what is due), grossCents, discountCents (own), stayDiscountShareCents,
 *               source, sourceLabel, addedOnReopen, collectAt, momentLabel, moments[], movable, settledCents, paidAt, status, statusLabel, vat: { rate, vatCents, netCents } }
 *             « Hébergement » and « Taxe de séjour » first, then the options, the resources and the custom lines
 *   groups[]  { id, label, count, title, totalCents, refs[] } — the articles sold on several lines (rules 13, 85), for display: a same-price group reads
 *             « Bière locale — 3 × 6,50 € (2 lignes) », otherwise « Bière locale — 3 : 1 × 6,50 € + 2 × 7,00 € », an hourly resource « N séances »;
 *             an offered line stays in its group (struck through by the client), a group never merges two lines
 *   buckets   { plan, arrival, departure } the amount due at each moment, from SETTLEMENT's figures of the quote; with `stored.planCents`,
 *             `stored.arrivalCents` / `stored.departureCents` (a stored stay) the buckets are the stored deposit + balance and complements (rule 93)
 *   totals    { totalCents, settledCents, dueCents, vatByRate: [{ rate, vatCents, netCents }] } — `dueCents` is what the stay still asks: with
 *             `stored.openCents` (a stored stay, `stayOpenCents(row)`) the register's « Reste à percevoir » (its open buckets, net of the
 *             platform commission, credits already off them); otherwise the lines left unsettled
 *   credits[] { ref, bucket, label, paidLabels[], totalCents (< 0) } — rule 104: the money paid on lines since lowered, read where a bucket takes it
 *             (`stored.paidByKey`: what the notes paid on each line key)
 *   phase     the stay clock's answer ('before' | 'during' | 'after'), or null
 * `moments` (optional) the moments a line of this stay can be moved to now (rule 103); without it, `phase` decides (rule 95).
 *
 * `facts[lineKey]` = { lineId, table, source, collectAt, collectAtDefault, soldAt, settledCents, paidAt, discountCents }.
 * A line with no fact is a line being sold (source fiche, nothing paid). Pure: no DB, no clock.
 */
const { toCents, roundMoney } = require('./pricing/money');
const { extraLineKey } = require('./pricing/storedLines');
const { vatOf } = require('./pricing/vat');
const { remainingToPay } = require('./reservationSettlement');

const SOURCE_LABELS = Object.freeze({ fiche: 'Fiche', shop: 'Boutique', sas: 'SAS', intake: 'Plateforme', devis: 'Devis' });
const ARRIVAL_ADJUSTMENT_LABEL = 'Complément d\'arrivée';
const MOMENT_LABELS = Object.freeze({ plan: 'Acompte et solde', platform: 'Prix plateforme', arrival: 'À l’arrivée', departure: 'Au départ' });

const frenchDay = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return match ? `${match[3]}/${match[2]}` : '';
};

// The moment a line is collected when nothing was stored: the quote's routing (rule 18).
function momentOf(line, fact, platformIncluded) {
  if (fact && fact.collectAt) return fact.collectAt;
  if (platformIncluded) return 'platform';
  return Number(line.inComplement || 0) === 1 ? 'arrival' : 'plan';
}

function statusOf({ offered, includedInPlatform, dueCents, settledCents, collectAt, paidAt }) {
  if (offered) return { status: 'offered', statusLabel: 'Offerte' };
  if (includedInPlatform) return { status: 'platform', statusLabel: 'Comprise dans le prix plateforme' };
  if (dueCents > 0 && settledCents >= dueCents) return { status: 'paid', statusLabel: paidAt ? `Payée le ${frenchDay(paidAt)}` : 'Payée' };
  if (collectAt === 'arrival') return { status: 'dueAtArrival', statusLabel: 'À payer à l’arrivée' };
  if (collectAt === 'departure') return { status: 'dueAtDeparture', statusLabel: 'À payer au départ' };
  return { status: 'inPlan', statusLabel: 'Dans l’acompte et le solde' };
}

const eurosText = (cents) => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
const numberText = (n) => String(roundMoney(n)).replace('.', ',');

// Rule 13 — the title of an article sold on several lines. `group` = its lines, in order.
function groupTitle(label, group) {
  if (group.every((line) => line.sessionCount != null)) return `${label} — ${group.reduce((sum, line) => sum + line.sessionCount, 0)} séances`;
  const quantity = group.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const sameUnit = group.every((line) => line.unitCents === group[0].unitCents);
  if (sameUnit) return `${label} — ${numberText(quantity)} × ${eurosText(group[0].unitCents)} (${group.length} lignes)`;
  return `${label} — ${numberText(quantity)} : ${group.map((line) => `${numberText(line.quantity)} × ${eurosText(line.unitCents)}`).join(' + ')}`;
}

// « 1 × 6,50 € + 2 × 7,00 € » — the lines an article already holds, for the sentence of the « Ajouter un produit » dialog (rule 13).
const partsText = (parts) => parts.map(({ quantity, unitCents }) => `${numberText(quantity)} × ${eurosText(unitCents)}`).join(' + ');

// The label of one line inside its group: « 2 × 7,00 € », or « 1 séance » for an hourly line.
const partLabel = (line) => (line.sessionCount != null
  ? `${line.sessionCount} séance${line.sessionCount > 1 ? 's' : ''}`
  : `${numberText(line.quantity)} × ${eurosText(line.unitCents)}`);

function groupsOf(lines) {
  const byArticle = new Map();
  for (const line of lines) {
    if (!line.articleKey) continue;
    if (!byArticle.has(line.articleKey)) byArticle.set(line.articleKey, []);
    byArticle.get(line.articleKey).push(line);
  }
  const several = [...byArticle.entries()].filter(([, group]) => group.length > 1);
  several.forEach(([, group]) => group.forEach((line) => { line.groupLabel = partLabel(line); }));
  return several.map(([articleKey, group]) => ({
    id: articleKey,
    label: group[0].label,
    count: group.length,
    title: groupTitle(group[0].label, group),
    totalCents: group.reduce((sum, line) => sum + line.totalCents, 0),
    refs: group.map((line) => line.ref),
  }));
}

// Rules 37, 95 — the moments a line can be moved to, said by the server (the screen offers them and rebuilds no rule): none for an offered, paid or platform
// line; before the arrival, the arrival only (a stay not started carves nothing out to the departure). `available` (rule 103), when the caller
// knows it, is the stay's own list: the moments the engine routes a line to now (the departure once it carves the extras out, the arrival unless
// its complement is collected).
function momentsOf(line, phase, available = null, beforeClock = false) {
  if (!['option', 'resource', 'custom'].includes(line.kind) || line.offered || line.status === 'paid' || line.status === 'platform') return [];
  // Loop t4 S4-5 (rule 95) — before the stay clock reaches the arrival, the departure is a moment only for a line the sale stamped there (sold
  // after an early arrival complement; `beforeClock` is false for it): a plan or arrival line is never moved to the departure before the arrival.
  if (Array.isArray(available)) return available.filter((moment) => !(beforeClock && moment === 'departure'));
  return phase === 'before' ? ['arrival'] : ['arrival', 'departure'];
}

function lineOf(raw, {
  kind, facts, vatClassOf, platformStay, phase = null, available = null, beforeClock = false,
}) {
  const key = extraLineKey(raw);
  const fact = facts[key] || null;
  const quotedGross = toCents(raw.grossTotalPrice != null ? raw.grossTotalPrice : (raw.originalTotalPrice && raw.offered ? raw.originalTotalPrice : raw.totalPrice));
  const quotedDue = raw.offered ? 0 : toCents(raw.totalPrice);
  // Rule 74 — a stored line bills what it stores (its amount before its discounts, which stay facts of their own); the quote speaks for a line
  // whose stored amount it agrees with, or one no row holds (a derived line). A line the engine would price otherwise today keeps its own.
  const drift = fact && fact.storedCents != null && !raw.offered ? fact.storedCents - quotedGross : 0;
  const due = drift ? Math.max(0, quotedDue + drift) : quotedDue;
  const gross = drift ? fact.storedCents : quotedGross;
  const collectAt = momentOf(raw, fact, platformStay && Number(raw.inComplement || 0) !== 1);
  const includedInPlatform = collectAt === 'platform';
  const settledCents = fact ? Math.max(0, Number(fact.settledCents || 0)) : 0;
  const quantity = raw.displayCount != null ? raw.displayCount : (raw.quantity != null ? raw.quantity : 1);
  const label = String(raw.title || raw.name || raw.description || 'Prestation').trim() || 'Prestation';
  const source = (fact && fact.source) || 'fiche';
  const line = {
    ref: fact && fact.table && fact.lineId != null ? `${fact.table}:${fact.lineId}` : key,
    key,
    kind,
    label,
    quantity,
    // The units the line bills (a per-person-per-night option: persons × nights), as every itemised list « qté × prix » reads them.
    billedUnits: Number(raw.billedUnits || raw.quantity || 1),
    unitCents: toCents(raw.unitPrice),
    ...(kind === 'option' && raw.optionId != null ? { articleKey: `option:${Number(raw.optionId)}` } : {}),
    ...(kind === 'resource' && raw.resourceId != null ? { articleKey: `resource:${Number(raw.resourceId)}` } : {}),
    ...(kind === 'resource' && Array.isArray(raw.sessions) && raw.sessions.length ? { sessionCount: raw.sessions.length } : {}),
    totalCents: due,
    grossCents: gross,
    discountCents: Number(raw.discountCents || 0),
    stayDiscountShareCents: Number(raw.stayDiscountShareCents || 0),
    // What the « Remise » chip says: the line's own discount and its share of the stay's, summed here, never by the screen (end review R3-6).
    discountTotalCents: Number(raw.discountCents || 0) + Number(raw.stayDiscountShareCents || 0),
    offered: Boolean(raw.offered),
    source,
    sourceLabel: SOURCE_LABELS[source] || 'Fiche',
    addedOnReopen: Boolean(fact && fact.addedOnReopen),
    collectAt,
    momentLabel: MOMENT_LABELS[collectAt] || '',
    settledCents,
    paidAt: (fact && fact.paidAt) || null,
    soldAt: (fact && fact.soldAt) || null,
    ...statusOf({ offered: Boolean(raw.offered), includedInPlatform, dueCents: due, settledCents, collectAt, paidAt: fact && fact.paidAt }),
    vatClass: vatClassOf ? vatClassOf(raw, kind) : null,
  };
  const soldForDeparture = collectAt === 'departure' || Boolean(fact && fact.collectAtDefault === 'departure');
  line.moments = momentsOf(line, phase, available, beforeClock && !soldForDeparture);
  line.movable = line.moments.some((moment) => moment !== line.collectAt);
  return line;
}

// Loop t4 S4-6 (rules 31, 103) — the part of an arrival or plan line the engine carved out to the departure (a discount given back once the
// arrival was validated, a line grown after it): `departureByKey` is the stored end-of-stay remainder by line key. The departure lines of a key
// take theirs first; what is left is the line's `departureCents`, which « Ventes du séjour — au départ » lists, as the departure SAS does.
function splitDepartureParts(lines, departureByKey) {
  if (!departureByKey) return;
  const left = { ...departureByKey };
  for (const line of lines) {
    if (line.collectAt === 'departure' && left[line.key] > 0) left[line.key] = Math.max(0, left[line.key] - line.totalCents);
  }
  for (const line of lines) {
    if (!['arrival', 'plan'].includes(line.collectAt) || line.offered || !(left[line.key] > 0)) continue;
    const part = Math.min(left[line.key], Math.max(0, line.totalCents - line.settledCents));
    if (part <= 0) continue;
    line.departureCents = part;
    left[line.key] -= part;
  }
}

function buildSaleDetail({
  quote, facts = {}, phase = null, vatClassOf = null, platformStay = false, stored = null, moments = null, beforeClock = false,
} = {}) {
  const q = quote || {};
  const options = q.optionLines || [];
  const resources = q.resourceLines || [];
  const extraLines = [
    ...options.map((line) => lineOf(line, {
      kind: line.isCustom ? 'custom' : 'option', facts, vatClassOf, platformStay, phase, available: moments, beforeClock,
    })),
    ...resources.map((line) => lineOf(line, {
      kind: 'resource', facts, vatClassOf, platformStay, phase, available: moments, beforeClock,
    })),
  ];
  splitDepartureParts(extraLines, stored && stored.departureByKey);
  const extrasCents = extraLines.reduce((sum, line) => sum + line.totalCents, 0);
  // Rule 91 — the guests added after a platform's price was entered are billed like a line of their own, at the arrival.
  const extraGuestsCents = stored ? Math.max(0, Number(stored.extraGuestsCents || 0)) : 0;
  const extraGuestsOffered = Boolean(stored && stored.extraGuestsOffered);
  const extraGuestsDue = extraGuestsOffered ? 0 : extraGuestsCents;
  const stayCents = Math.max(0, (stored ? Number(stored.finalCents || 0) : toCents(q.finalPrice)) - extrasCents - extraGuestsDue);
  const lines = [
    {
      ref: 'accommodation', key: 'accommodation', kind: 'accommodation', label: 'Hébergement', quantity: Number(q.nights || 0), totalCents: stayCents, grossCents: stayCents,
      discountCents: 0, stayDiscountShareCents: 0, offered: false, source: 'fiche', sourceLabel: SOURCE_LABELS.fiche, collectAt: 'plan',
      momentLabel: MOMENT_LABELS.plan, settledCents: 0, paidAt: null, status: 'inPlan', statusLabel: 'Dans l’acompte et le solde', vatClass: 'accommodation',
    },
  ];
  const tax = stored ? Number(stored.touristTaxCents || 0) : toCents(q.touristTaxTotal);
  // Rule 91 — the part of the tax the arrival complement collects (forced there, collected by us on a platform stay, or the added guests'
  // share) is an arrival line of its own; the rest stays in the plan.
  const taxArrival = stored && stored.touristTaxArrivalCents != null
    ? Math.min(tax, Math.max(0, Number(stored.touristTaxArrivalCents || 0)))
    : (q.touristTaxInComplement ? tax : 0);
  const taxLine = (ref, label, cents, atArrival) => ({
    ref, key: ref, kind: 'touristTax', label, quantity: null, totalCents: cents, grossCents: cents, discountCents: 0,
    stayDiscountShareCents: 0, offered: false, source: 'fiche', sourceLabel: SOURCE_LABELS.fiche, collectAt: atArrival ? 'arrival' : 'plan',
    momentLabel: atArrival ? MOMENT_LABELS.arrival : MOMENT_LABELS.plan, settledCents: 0, paidAt: null,
    status: atArrival ? 'dueAtArrival' : 'inPlan', statusLabel: atArrival ? 'À payer à l’arrivée' : 'Dans l’acompte et le solde',
    vatClass: 'outOfScope',
  });
  if (tax - taxArrival > 0) lines.push(taxLine('touristTax', 'Taxe de séjour', tax - taxArrival, false));
  if (taxArrival > 0) {
    const label = (stored && stored.touristTaxArrivalLabel) || 'Taxe de séjour';
    lines.push(taxLine(taxArrival === tax ? 'touristTax' : 'touristTaxArrival', label, taxArrival, true));
  }
  if (extraGuestsCents > 0) {
    const count = Math.max(1, Number(stored.extraGuestsCount || 1));
    lines.push({
      ref: 'extraGuests', key: 'extraGuests', kind: 'extraGuests', label: 'Voyageurs ajoutés', quantity: count, unitCents: Math.round(extraGuestsCents / count),
      totalCents: extraGuestsDue, grossCents: extraGuestsCents, discountCents: 0, stayDiscountShareCents: 0, offered: extraGuestsOffered, source: 'fiche',
      sourceLabel: SOURCE_LABELS.fiche, collectAt: 'arrival', momentLabel: MOMENT_LABELS.arrival, settledCents: 0, paidAt: null,
      ...statusOf({ offered: extraGuestsOffered, includedInPlatform: false, dueCents: extraGuestsDue, settledCents: 0, collectAt: 'arrival' }),
      vatClass: 'accommodation',
    });
  }
  lines.push(...extraLines);
  // Rule 91 — what the arrival complement collects beyond its listed lines (an operator's adjustment, a figure kept from an earlier
  // routing) is a line of its own, « Complément d’arrivée », as the e-mails have always listed it. A lower complement lists nothing.
  // Rule 93 (loop t2 N-5) — a stored stay's arrival and departure buckets are what it stores, never a re-quote at another moment.
  const storedBucket = (field) => (stored && Number.isFinite(stored[field]) ? stored[field] : null);
  const arrivalBucket = storedBucket('arrivalCents') ?? toCents(q.resolvedComplementAmount != null ? q.resolvedComplementAmount : q.complementAmount);
  const arrivalListed = lines.filter((line) => line.collectAt === 'arrival').reduce((sum, line) => sum + line.totalCents - Number(line.departureCents || 0), 0);
  if (stored && arrivalBucket - arrivalListed > 1) {
    const cents = arrivalBucket - arrivalListed;
    lines.push({
      ref: 'arrivalAdjustment', key: 'arrivalAdjustment', kind: 'adjustment', label: ARRIVAL_ADJUSTMENT_LABEL, quantity: null, totalCents: cents, grossCents: cents,
      discountCents: 0, stayDiscountShareCents: 0, offered: false, source: 'fiche', sourceLabel: SOURCE_LABELS.fiche, collectAt: 'arrival',
      momentLabel: MOMENT_LABELS.arrival, settledCents: 0, paidAt: null, status: 'dueAtArrival', statusLabel: 'À payer à l’arrivée', vatClass: null,
    });
  }

  const credits = creditsOf({
    extraLines,
    lines,
    stored,
    buckets: {
      arrival: arrivalBucket,
      // The departure's mid-stay remainder, without the departure SAS's own charges (they are no line of the detail).
      departure: stored && stored.departureByKey ? Object.values(stored.departureByKey).reduce((sum, cents) => sum + Number(cents || 0), 0) : null,
      plan: storedBucket('planCents'),
    },
  });

  // VAT line by line (rules 51, 62): one rounding per (class, rate) group, shared over its lines by largest remainder.
  const taxable = lines.filter((line) => line.totalCents > 0 && line.vatClass);
  const regime = q.vatRegime || null;
  const vat = taxable.length ? vatOf(taxable.map((line) => ({
    amountCents: line.totalCents, vatClass: line.vatClass || 'options', customerContext: 'hosted', source: { kind: line.kind }, docKey: line.ref,
  })), { regime, settings: null }) : { amounts: [], byRate: [] };
  taxable.forEach((line, index) => {
    const share = vat.amounts[index];
    line.vat = { rate: share.rate, vatCents: share.vatCents, netCents: share.netCents };
  });
  for (const line of lines) if (!line.vat) line.vat = { rate: 0, vatCents: 0, netCents: line.totalCents };

  const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const settledCents = lines.reduce((sum, line) => sum + Math.min(line.settledCents, line.totalCents), 0);
  return {
    phase,
    lines,
    groups: groupsOf(lines),
    buckets: {
      // Loop t3 T3-5 — the plan too: a stored stay's deposit and balance as stored (rule 93), never a live re-quote.
      plan: storedBucket('planCents') ?? toCents(q.preArrivalAmount),
      arrival: arrivalBucket,
      departure: storedBucket('departureCents') ?? toCents(q.endOfStayComplementTotal),
    },
    // Loop t6 UI6-2 — a stored stay's « Reste à payer » is what its buckets still ask (`stored.openCents`, rule 31): the accommodation and the
    // platform-included lines carry no settled share, so the lines alone would count every paid acompte and solde as still due.
    totals: {
      totalCents, settledCents, dueCents: stored && Number.isFinite(stored.openCents) ? stored.openCents : Math.max(0, totalCents - settledCents), vatByRate: vat.byRate || [],
    },
    credits,
  };
}

// Rule 106 c (loop t6 UI6-2; owner 2026-11-16) — what a stored stay still asks, in cents: the acompte, the solde, the installments, the arrival
// and departure complements not collected yet. It IS the payment register's « Reste à percevoir » of the stored fiche (`remainingToPay`, the
// one source the ledger closes on): on a platform stay net of the commission and penalty of each unpaid échéance, on a direct stay the same
// gross figure as before (no commission). A rule-104 credit is already off the bucket it sits in. A cancelled stay asks nothing through its
// sale: its money is the cancellation's (the ledger). Pure.
function stayOpenCents(row) {
  if (!row || row.kind === 'cancelled') return 0;
  return toCents(remainingToPay(row));
}

// Rule 104 (loop t5, S5-3) — the money a note paid on a line since offered, discounted or lowered stays credited to the stay, and it is read as
// what it is: a line of its own in the bucket it comes off, « Déjà réglé : <the paid lines> » −amount, never a price cut of another article.
// Each bucket shows only the credit that explains why it asks less than the lines it lists (arrival, then departure, then the plan — the order
// the engine credits them in); `stored.paidByKey` = what the notes paid on each line key. → [{ ref, bucket, label, paidLabels[], totalCents (< 0) }]
const CREDIT_LABEL = 'Déjà réglé';
function creditsOf({
  extraLines, lines, stored, buckets,
}) {
  const paidByKey = (stored && stored.paidByKey) || {};
  const sources = extraLines
    .map((line) => ({ label: line.label, cents: Math.max(0, Number(paidByKey[line.key] || 0) - Math.max(0, line.totalCents)) }))
    .filter((source) => source.cents > 0);
  let left = sources.reduce((sum, source) => sum + source.cents, 0);
  if (!left) return [];
  const paidLabels = [...new Set(sources.map((source) => source.label))];
  const listed = {
    // A line already settled in full (a card order before the arrival, a complement collected) is no money the bucket still asks.
    arrival: lines.filter((line) => line.collectAt === 'arrival' && !(line.totalCents > 0 && line.settledCents >= line.totalCents))
      .reduce((sum, line) => sum + line.totalCents - Number(line.departureCents || 0), 0),
    departure: lines.reduce((sum, line) => sum + (line.collectAt === 'departure' ? Math.max(0, line.totalCents - line.settledCents) : 0) + Number(line.departureCents || 0), 0),
    plan: lines.filter((line) => line.collectAt === 'plan').reduce((sum, line) => sum + line.totalCents, 0),
  };
  const credits = [];
  for (const bucket of ['arrival', 'departure', 'plan']) {
    if (buckets[bucket] == null) continue;
    const cents = Math.min(left, Math.max(0, listed[bucket] - buckets[bucket]));
    if (cents <= 0) continue;
    left -= cents;
    credits.push({
      ref: `credit:${bucket}`, bucket, label: `${CREDIT_LABEL} (${paidLabels.join(', ')})`, paidLabels, totalCents: -cents,
    });
  }
  return credits;
}

// Rule 32 — the SAS shows what a started stay sold for its departure apart from the total it collects at the door:
// « Ventes du séjour — au départ ». `null` when nothing is due there.
const DEPARTURE_TITLE = 'Ventes du séjour — au départ';
function departureSection(detail) {
  const lines = ((detail && detail.lines) || []).flatMap((line) => {
    if (line.collectAt === 'departure' && line.totalCents > 0) return [line];
    // An arrival or plan line's part carved out to the departure is due there (loop t4 S4-6).
    return line.departureCents > 0
      ? [{ ...line, totalCents: line.departureCents, settledCents: 0, status: 'dueAtDeparture', statusLabel: 'À payer au départ' }]
      : [];
  });
  if (!lines.length) return null;
  // Rule 13: the lines of an article are grouped inside each block — what is left to collect on one side, what is already paid on the other.
  const isPaid = (line) => line.status === 'paid';
  const groups = [['due', lines.filter((line) => !isPaid(line))], ['paid', lines.filter(isPaid)]]
    .flatMap(([block, inBlock]) => groupsOf(inBlock).map((group) => ({ ...group, block })));
  // Loop t5 S5-3 — the rule-104 credit the departure takes is a line of its own under « Déjà payé » (money already received, nothing to collect
  // or offer on it): the section's due sums to what the departure asks.
  const credit = ((detail && detail.credits) || []).find((entry) => entry.bucket === 'departure');
  const shown = lines.map((line) => ({
    ref: line.ref, label: line.label, totalCents: line.totalCents, settledCents: line.settledCents, status: line.status, statusLabel: line.statusLabel,
    sourceLabel: line.sourceLabel, offered: line.offered, groupLabel: line.groupLabel, block: isPaid(line) ? 'paid' : 'due', addedOnReopen: line.addedOnReopen,
  }));
  if (credit) {
    // Loop t6 UI6-3 — money received, no line: nothing to offer on it (`offerable: false`), and its label already says « Déjà réglé ».
    shown.push({
      ref: credit.ref, label: credit.label, totalCents: credit.totalCents, settledCents: 0, status: 'credit', statusLabel: null, sourceLabel: null,
      offered: false, offerable: false, block: 'paid', addedOnReopen: false,
    });
  }
  return {
    title: DEPARTURE_TITLE,
    lines: shown,
    groups,
    totalCents: shown.reduce((sum, line) => sum + line.totalCents, 0),
    dueCents: shown.reduce((sum, line) => sum + (line.status === 'credit' ? line.totalCents : Math.max(0, line.totalCents - line.settledCents)), 0),
  };
}

// Rule 32 — what the stay already collected on its sold lines (« Déjà payé »), whatever their moment: the departure SAS lists them so the
// operator may still offer one (rule 14; the fiche's save then asks to confirm what is owed back, rule 23).
const PAID_TITLE = 'Déjà payé';
function paidSection(detail) {
  const lines = ((detail && detail.lines) || []).filter((line) => ['option', 'resource', 'custom'].includes(line.kind) && line.status === 'paid' && line.totalCents > 0);
  if (!lines.length) return null;
  return {
    title: PAID_TITLE,
    lines: lines.map((line) => ({
      ref: line.ref, label: line.label, totalCents: line.totalCents, settledCents: line.settledCents, status: line.status, statusLabel: line.statusLabel,
      sourceLabel: line.sourceLabel, offered: line.offered, groupLabel: line.groupLabel, block: 'paid', addedOnReopen: line.addedOnReopen,
    })),
    groups: groupsOf(lines).map((group) => ({ ...group, block: 'paid' })),
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    dueCents: 0,
  };
}

// Rule 91 — the arrival complement as the guest e-mails itemise it (« label : qté × prix = total »): the arrival lines left to pay, in the
// e-mail's order (options and custom lines, resources, added guests, tax, then « Complément d'arrivée »), in the shape the e-mail renders.
const ARRIVAL_KIND = Object.freeze({ option: 'option', custom: 'option', resource: 'resource', extraGuests: 'extraGuests', touristTax: 'tax', adjustment: 'remainder' });
const ARRIVAL_RANK = Object.freeze({ option: 0, resource: 1, extraGuests: 2, tax: 3, remainder: 4 });
function arrivalComplementLines(detail, { addedGuestsTaxLabel = null, complementPaid = false } = {}) {
  return ((detail && detail.lines) || [])
    // A line settled by something other than the complement itself (a card order paid before the arrival, end-review V-6) is not money the
    // complement collects; once the complement is paid, its lines are what it collected and stay listed.
    .filter((line) => line.collectAt === 'arrival' && !line.offered && line.totalCents > 0 && ARRIVAL_KIND[line.kind]
      && (complementPaid || !(Number(line.settledCents || 0) >= line.totalCents)))
    // Loop t4 S4-6 — the part carved out to the departure is not the arrival's.
    .map((line) => (line.departureCents > 0 ? { ...line, totalCents: line.totalCents - line.departureCents, billedUnits: 1, unitCents: line.totalCents - line.departureCents } : line))
    .filter((line) => line.totalCents > 0)
    .map((line, index) => ({ line, index, kind: ARRIVAL_KIND[line.kind] }))
    .sort((a, b) => ARRIVAL_RANK[a.kind] - ARRIVAL_RANK[b.kind] || a.index - b.index)
    .map(({ line, kind }) => {
      const whole = kind === 'tax' || kind === 'remainder';
      return {
        kind,
        label: line.label,
        qty: whole ? 1 : Number(line.billedUnits != null ? line.billedUnits : (line.quantity == null ? 1 : line.quantity)),
        unitPrice: (whole ? line.totalCents : Number(line.unitCents || 0)) / 100,
        amount: line.totalCents / 100,
        ...(kind === 'tax' && addedGuestsTaxLabel && line.label === addedGuestsTaxLabel ? { addedGuests: true } : {}),
      };
    })
    // Loop t5 S5-3 — the rule-104 credit the arrival complement takes, last: the lines sum to the amount asked.
    .concat(((detail && detail.credits) || []).filter((credit) => credit.bucket === 'arrival').map((credit) => ({
      kind: 'credit', label: credit.label, paidLabels: credit.paidLabels, qty: 1, unitPrice: credit.totalCents / 100, amount: credit.totalCents / 100,
    })));
}

// The status of a document line as the screens name it (outside-visit spec rule 10): paid, to pay, offered or cancelled.
const DOCUMENT_STATUS_LABELS = Object.freeze({ paid: 'Payée', due: 'À payer', offered: 'Offerte', cancelled: 'Annulée' });

/**
 * saleDetail of a DOCUMENT (a standalone sale, rule 74): the same read model, fed by the document's frozen lines and what SETTLEMENT and
 * REFUNDS made of them. `buildDocumentDetail({ sale, client, lines, settlement, vatByRate })`:
 *   sale        { id, status, version, soldAt, originRef, customerName, customerEmail }
 *   client      { id, label, kind: 'passage' | 'registered' }
 *   lines       the pipeline's lines in sale order, each with its row `id`, `ref` and VAT share
 *   settlement  `settleDocument`'s answer plus `refundOwedCents`
 * → { document, lines[], groups[], totals: { totalCents, paidCents, remainingCents, refundOwedCents }, vatByRate }. Pure: no DB, no clock.
 */
function buildDocumentDetail({
  sale, client, lines, settlement, vatByRate,
}) {
  const statusByRef = new Map(settlement.lines.map((line) => [line.ref, line]));
  const rows = lines.map((line) => {
    const settled = statusByRef.get(line.ref) || { status: 'due', settledCents: 0 };
    return {
      id: line.id == null ? null : line.id,
      ref: line.ref,
      kind: line.fulfilmentRef || line.family === 'hourly' ? 'session' : 'extra',
      articleKey: line.articleRef || null,
      label: line.label,
      detail: line.detail != null ? line.detail : `${numberText(line.quantity)} × ${eurosText(line.unitCents)}${line.offered ? ' · offert' : ''}`,
      quantity: line.quantity,
      unitCents: line.unitCents,
      totalCents: line.offered || line.cancelled ? 0 : line.totalCents,
      catalogueCents: line.catalogueCents == null ? line.totalCents : line.catalogueCents,
      offered: Boolean(line.offered),
      status: settled.status,
      statusLabel: DOCUMENT_STATUS_LABELS[settled.status],
      settledCents: settled.settledCents,
      vatClass: line.vatClass,
      vatRate: line.vatRate,
      vatCents: line.offered || line.cancelled ? 0 : line.vatCents,
      source: line.source || null,
      fulfilmentRef: line.fulfilmentRef || null,
      components: line.fulfilmentRef ? (line.components || []) : [],
    };
  });
  const live = rows.filter((row) => row.status !== 'cancelled');
  return {
    document: {
      ref: `standalone:${sale.id}`, id: sale.id, status: sale.status, version: sale.version, soldAt: sale.soldAt, originRef: sale.originRef || null,
      customerName: sale.customerName || null, customerEmail: sale.customerEmail || null, client,
    },
    lines: rows,
    groups: groupsOf(live),
    totals: {
      totalCents: settlement.totalCents, paidCents: settlement.paidCents, remainingCents: settlement.remainingCents, refundOwedCents: settlement.refundOwedCents,
    },
    vatByRate: vatByRate.map(({ rate, vatCents }) => ({ rate, vatCents })),
  };
}

module.exports = {
  buildDocumentDetail,
  buildSaleDetail, stayOpenCents, departureSection, paidSection, arrivalComplementLines, partsText, SOURCE_LABELS, MOMENT_LABELS, DEPARTURE_TITLE, PAID_TITLE,
};
