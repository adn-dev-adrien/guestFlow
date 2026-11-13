/**
 * saleDetail — the one read model of what a stay sold and what is left to collect (specs/pricing-components.md §3 rule 31).
 *
 * `buildSaleDetail({ quote, facts, phase, vatClassOf, platformStay })` turns the quote of the stored stay (TOTALS and SETTLEMENT already ran)
 * and the facts of its stored lines into a ready-to-render payload: every amount in cents, every label French. The fiche, the SAS
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
  const gross = toCents(raw.grossTotalPrice != null ? raw.grossTotalPrice : (raw.originalTotalPrice && raw.offered ? raw.originalTotalPrice : raw.totalPrice));
  const due = raw.offered ? 0 : toCents(raw.totalPrice);
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

function buildSaleDetail({ quote, facts = {}, phase = null, vatClassOf = null, platformStay = false } = {}) {
  const q = quote || {};
  const options = q.optionLines || [];
  const resources = q.resourceLines || [];
  const extrasCents = [...options, ...resources].reduce((sum, line) => sum + (line.offered ? 0 : toCents(line.totalPrice)), 0);
  const stayCents = Math.max(0, toCents(q.finalPrice) - extrasCents);
  const lines = [
    {
      ref: 'accommodation', key: 'accommodation', kind: 'accommodation', label: 'Hébergement', quantity: Number(q.nights || 0), totalCents: stayCents, grossCents: stayCents,
      discountCents: 0, stayDiscountShareCents: 0, offered: false, source: 'fiche', sourceLabel: SOURCE_LABELS.fiche, collectAt: 'plan',
      momentLabel: MOMENT_LABELS.plan, settledCents: 0, paidAt: null, status: 'inPlan', statusLabel: 'Dans l’acompte et le solde', vatClass: 'accommodation',
    },
  ];
  const tax = toCents(q.touristTaxTotal);
  if (tax > 0) {
    lines.push({
      ref: 'touristTax', key: 'touristTax', kind: 'touristTax', label: 'Taxe de séjour', quantity: null, totalCents: tax, grossCents: tax, discountCents: 0,
      stayDiscountShareCents: 0, offered: false, source: 'fiche', sourceLabel: SOURCE_LABELS.fiche, collectAt: q.touristTaxInComplement ? 'arrival' : 'plan',
      momentLabel: q.touristTaxInComplement ? MOMENT_LABELS.arrival : MOMENT_LABELS.plan, settledCents: 0, paidAt: null,
      status: q.touristTaxInComplement ? 'dueAtArrival' : 'inPlan', statusLabel: q.touristTaxInComplement ? 'À payer à l’arrivée' : 'Dans l’acompte et le solde',
      vatClass: 'outOfScope',
    });
  }
  for (const line of options) lines.push(lineOf(line, { kind: line.isCustom ? 'custom' : 'option', facts, vatClassOf, platformStay }));
  for (const line of resources) lines.push(lineOf(line, { kind: 'resource', facts, vatClassOf, platformStay }));

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
      arrival: toCents(q.resolvedComplementAmount != null ? q.resolvedComplementAmount : q.complementAmount),
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

module.exports = { buildSaleDetail, departureSection, partsText, SOURCE_LABELS, MOMENT_LABELS, DEPARTURE_TITLE };
