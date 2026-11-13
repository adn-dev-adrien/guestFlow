/**
 * saleDetail — the one read model of what a stay sold and what is left to collect (specs/pricing-components.md §3 rule 31).
 *
 * `buildSaleDetail({ quote, facts, phase, vatClassOf, platformStay, stored })` turns the quote of the stored stay (TOTALS and SETTLEMENT already ran)
 * and the facts of its stored lines into a ready-to-render payload: every amount in cents, every label French. A stored line bills what it
 * stores (`facts[key].storedCents`, its amount before its own discounts, rules 12, 74), and with `stored` (`{ finalCents, touristTaxCents }`, the stay's stored figures) the
 * accommodation is what the stored stay price leaves once its lines are counted: a stay whose engine price drifted since it was sold reads
 * as sold, never as re-priced. The fiche, the SAS
 * recaps and the e-mails render it and sum nothing (CLAUDE.md §6.0).
 *
 *   lines[]   { ref, kind, label, quantity, totalCents (what is due), grossCents, discountCents (own), stayDiscountShareCents,
 *               source, sourceLabel, addedOnReopen, collectAt, momentLabel, settledCents, paidAt, status, statusLabel, vat: { rate, vatCents, netCents } }
 *             « Hébergement » and « Taxe de séjour » first, then the options, the resources and the custom lines
 *   groups[]  { id, label, count, title, totalCents, refs[] } — the articles sold on several lines (rules 13, 85), for display: a same-price group reads
 *             « Bière locale — 3 × 6,50 € (2 lignes) », otherwise « Bière locale — 3 : 1 × 6,50 € + 2 × 7,00 € », an hourly resource « N séances »;
 *             an offered line stays in its group (struck through by the client), a group never merges two lines
 *   buckets   { plan, arrival, departure } the amount due at each moment, from SETTLEMENT's figures of the quote
 *   totals    { totalCents, settledCents, dueCents, vatByRate: [{ rate, vatCents, netCents }] }
 *   phase     the stay clock's answer ('before' | 'during' | 'after'), or null
 *
 * `facts[lineKey]` = { lineId, table, source, collectAt, collectAtDefault, soldAt, settledCents, paidAt, discountCents }.
 * A line with no fact is a line being sold (source fiche, nothing paid). Pure: no DB, no clock.
 */
const { toCents, roundMoney } = require('./pricing/money');
const { extraLineKey } = require('./pricing/storedLines');
const { vatOf } = require('./pricing/vat');

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

function lineOf(raw, { kind, facts, vatClassOf, platformStay }) {
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
  return {
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
    offered: Boolean(raw.offered),
    source,
    sourceLabel: SOURCE_LABELS[source] || 'Fiche',
    addedOnReopen: Boolean(fact && fact.addedOnReopen),
    collectAt,
    momentLabel: MOMENT_LABELS[collectAt] || '',
    settledCents,
    paidAt: (fact && fact.paidAt) || null,
    ...statusOf({ offered: Boolean(raw.offered), includedInPlatform, dueCents: due, settledCents, collectAt, paidAt: fact && fact.paidAt }),
    vatClass: vatClassOf ? vatClassOf(raw, kind) : null,
  };
}

function buildSaleDetail({ quote, facts = {}, phase = null, vatClassOf = null, platformStay = false, stored = null } = {}) {
  const q = quote || {};
  const options = q.optionLines || [];
  const resources = q.resourceLines || [];
  const extraLines = [
    ...options.map((line) => lineOf(line, { kind: line.isCustom ? 'custom' : 'option', facts, vatClassOf, platformStay })),
    ...resources.map((line) => lineOf(line, { kind: 'resource', facts, vatClassOf, platformStay })),
  ];
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
  const arrivalBucket = toCents(q.resolvedComplementAmount != null ? q.resolvedComplementAmount : q.complementAmount);
  const arrivalListed = lines.filter((line) => line.collectAt === 'arrival').reduce((sum, line) => sum + line.totalCents, 0);
  if (stored && arrivalBucket - arrivalListed > 1) {
    const cents = arrivalBucket - arrivalListed;
    lines.push({
      ref: 'arrivalAdjustment', key: 'arrivalAdjustment', kind: 'adjustment', label: ARRIVAL_ADJUSTMENT_LABEL, quantity: null, totalCents: cents, grossCents: cents,
      discountCents: 0, stayDiscountShareCents: 0, offered: false, source: 'fiche', sourceLabel: SOURCE_LABELS.fiche, collectAt: 'arrival',
      momentLabel: MOMENT_LABELS.arrival, settledCents: 0, paidAt: null, status: 'dueAtArrival', statusLabel: 'À payer à l’arrivée', vatClass: null,
    });
  }

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
      plan: toCents(q.preArrivalAmount),
      arrival: arrivalBucket,
      departure: toCents(q.endOfStayComplementTotal),
    },
    totals: { totalCents, settledCents, dueCents: Math.max(0, totalCents - settledCents), vatByRate: vat.byRate || [] },
  };
}

// Rule 32 — the SAS shows what a started stay sold for its departure apart from the total it collects at the door:
// « Ventes du séjour — au départ ». `null` when nothing is due there.
const DEPARTURE_TITLE = 'Ventes du séjour — au départ';
function departureSection(detail) {
  const lines = ((detail && detail.lines) || []).filter((line) => line.collectAt === 'departure' && line.totalCents > 0);
  if (!lines.length) return null;
  // Rule 13: the lines of an article are grouped inside each block — what is left to collect on one side, what is already paid on the other.
  const isPaid = (line) => line.status === 'paid';
  const groups = [['due', lines.filter((line) => !isPaid(line))], ['paid', lines.filter(isPaid)]]
    .flatMap(([block, inBlock]) => groupsOf(inBlock).map((group) => ({ ...group, block })));
  return {
    title: DEPARTURE_TITLE,
    lines: lines.map((line) => ({
      ref: line.ref, label: line.label, totalCents: line.totalCents, settledCents: line.settledCents, status: line.status, statusLabel: line.statusLabel,
      sourceLabel: line.sourceLabel, offered: line.offered, groupLabel: line.groupLabel, block: isPaid(line) ? 'paid' : 'due', addedOnReopen: line.addedOnReopen,
    })),
    groups,
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    dueCents: lines.reduce((sum, line) => sum + Math.max(0, line.totalCents - line.settledCents), 0),
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
function arrivalComplementLines(detail, { addedGuestsTaxLabel = null } = {}) {
  return ((detail && detail.lines) || [])
    .filter((line) => line.collectAt === 'arrival' && !line.offered && line.totalCents > 0 && ARRIVAL_KIND[line.kind])
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
    });
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
  buildSaleDetail, departureSection, paidSection, arrivalComplementLines, partsText, SOURCE_LABELS, MOMENT_LABELS, DEPARTURE_TITLE, PAID_TITLE,
};
