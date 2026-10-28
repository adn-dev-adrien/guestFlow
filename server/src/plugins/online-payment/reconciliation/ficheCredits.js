/**
 * The credits a fiche can be linked to, and the search of the linking dialog
 * (specs/reconciliation-assisted-matching.md rules 1–4, 14).
 *
 * Pure: available credits × the fiche's open receipts → plausible first, the rest folded. Plausible =
 * settled within ±15 days of a receipt's anchor date AND (an amount within ±5,00 € of a receipt, or of
 * all of them together, OR the client's last name in the transfer). Search tokens are read as a date,
 * an amount or text; every token must match.
 */

const { normalize, nameMatches, textOf, daysBetween } = require('./matcher');
const { day } = require('./dates');
const { euros } = require('./receiptStates');

const MARGIN_CENTS = 500;
const WINDOW_DAYS = 15;
const PAGE_SIZE = 50;

const DATE_DM = /^(\d{1,2})\/(\d{1,2})$/;
const DATE_DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const AMOUNT = /^\d+(?:[.,]\d{1,2})?$/;
const pad = (n) => String(n).padStart(2, '0');
const validDayMonth = (d, m) => d >= 1 && d <= 31 && m >= 1 && m <= 12;

/** Rule 4 — « 12/03 », « 596,58 », « dupont » → typed tokens. Anything that is not a date or an amount is text. */
function parseSearch(q) {
  return String(q == null ? '' : q).trim().split(/\s+/).filter(Boolean).map((raw) => {
    let m = DATE_DMY.exec(raw);
    if (m && validDayMonth(Number(m[1]), Number(m[2]))) return { kind: 'date', value: raw, iso: `${m[3]}-${pad(m[2])}-${pad(m[1])}` };
    m = DATE_ISO.exec(raw);
    if (m && validDayMonth(Number(m[3]), Number(m[2]))) return { kind: 'date', value: raw, iso: raw };
    m = DATE_DM.exec(raw);
    if (m && validDayMonth(Number(m[1]), Number(m[2]))) return { kind: 'date', value: raw, monthDay: `${pad(m[2])}-${pad(m[1])}` };
    if (AMOUNT.test(raw)) {
      const [int, dec] = raw.replace(',', '.').split('.');
      const whole = dec === undefined;
      return { kind: 'amount', value: raw, cents: Number(int) * 100 + (whole ? 0 : Number(dec.padEnd(2, '0'))), whole };
    }
    return { kind: 'text', value: raw, needle: normalize(raw) };
  });
}

const publicTokens = (tokens) => tokens.map(({ kind, value }) => ({ kind, value }));

function dateMatches(token, iso) {
  const d = day(iso);
  if (!d) return false;
  return token.iso ? d === token.iso : d.slice(5) === token.monthDay;
}
function amountMatches(token, ...cents) {
  return cents.some((c) => (token.whole ? c >= token.cents && c < token.cents + 100 : c === token.cents));
}

/** Does one credit satisfy every token? (rule 4) */
function creditMatches(credit, tokens) {
  return tokens.every((t) => {
    if (t.kind === 'date') return dateMatches(t, credit.settledAt);
    if (t.kind === 'amount') return amountMatches(t, credit.amountCents, credit.remainingCents);
    return !t.needle || textOf(credit).includes(t.needle);
  });
}

/** The same search over an open receipt, for the credit → fiches direction (rule 14). */
function receiptMatches(receipt, tokens) {
  const r = receipt.reservation || {};
  const hay = normalize([r.clientName, r.propertyName, r.reservationNumber, receipt.label, r.platform].join(' '));
  return tokens.every((t) => {
    if (t.kind === 'date') return [receipt.dueDate, receipt.expectedDate].some((d) => dateMatches(t, d));
    if (t.kind === 'amount') return amountMatches(t, receipt.openCents, receipt.expectedCents);
    return !t.needle || hay.includes(t.needle);
  });
}

const anchorOf = (receipt) => day(receipt.dueDate) || day(receipt.expectedDate) || day(receipt.reservation && receipt.reservation.endDate) || null;
const dueSort = (a, b) => (anchorOf(a) || '9999').localeCompare(anchorOf(b) || '9999');
const withinWindow = (isoA, isoB) => {
  const d = daysBetween(isoA, isoB);
  return d != null && Math.abs(d) <= WINDOW_DAYS;
};

function anchorLabel(receipt) {
  const a = anchorOf(receipt);
  if (!a) return '';
  const short = `${a.slice(8, 10)}/${a.slice(5, 7)}`;
  return day(receipt.dueDate) && !receipt.paid ? `avant le ${short}` : `attendu le ${short}`;
}

/**
 * Rules 1–2 — how one credit fits a fiche.
 * @returns {{ rank: number, reasons: string[], fitsKey: string|null, distance: number }|null} null = not plausible
 */
function plausibility(credit, receipts, lastName) {
  const own = plausibilityByEvidence(credit, receipts, lastName);
  if (own || !credit.proposedHereKey) return own;
  return { rank: 0, reasons: ['proposal'], fitsKey: credit.proposedHereKey, distance: 0 };
}

function plausibilityByEvidence(credit, receipts, lastName) {
  const near = receipts.filter((r) => anchorOf(r) && withinWindow(anchorOf(r), credit.settledAt));
  if (near.length === 0) return null;
  const totalOpen = receipts.reduce((s, r) => s + r.openCents, 0);
  const diffOf = (r) => Math.abs(r.openCents - credit.remainingCents);
  const byAmount = near.filter((r) => diffOf(r) <= MARGIN_CENTS).sort((a, b) => diffOf(a) - diffOf(b) || dueSort(a, b));
  const sumDiff = Math.abs(totalOpen - credit.remainingCents);
  const sumFits = receipts.length > 1 && sumDiff <= MARGIN_CENTS;
  const named = nameMatches(lastName, credit);
  if (byAmount.length === 0 && !sumFits && !named) return null;

  const reasons = [];
  let fits = null;
  let diff = null;
  if (byAmount.length > 0) { fits = byAmount[0]; diff = diffOf(fits); } else if (sumFits) { [fits] = [...receipts].sort(dueSort); diff = sumDiff; }
  if (diff != null) reasons.push(diff === 0 ? 'exact' : 'amount');
  if (named) reasons.push('name');
  if (!fits) [fits] = [...near].sort(dueSort);
  const distance = Math.min(...near.map((r) => Math.abs(daysBetween(anchorOf(r), credit.settledAt))));
  return { rank: diff === 0 ? 0 : (diff != null ? 1 : 2), reasons, fitsKey: fits.key, distance };
}

const creditView = (c, extra = {}) => ({
  transactionId: c.transactionId, amountCents: c.amountCents, remainingCents: c.remainingCents,
  dateLabel: c.dateLabel, counterparty: c.counterparty, reference: c.reference,
  partlyUsed: c.remainingCents < c.amountCents,
  partlyUsedLabel: c.remainingCents < c.amountCents ? `reste ${euros(c.remainingCents)} sur ${euros(c.amountCents)}` : null,
  proposedElsewhere: Boolean(c.proposedElsewhere),
  ...extra,
});

/**
 * @param {object} p
 * @param {object[]} p.credits   `{ transactionId, amountCents, remainingCents, settledAt, dateLabel, counterparty, reference, label, note, proposedElsewhere }`
 * @param {object[]} p.receipts  the fiche's open receipts (`openCents` > 0)
 * @param {string} p.lastName
 * @param {string} [p.q]
 * @param {number} [p.offset]
 */
function ficheCredits({ credits, receipts, lastName, q = '', offset = 0 }) {
  const tokens = parseSearch(q);
  const filtered = credits.filter((c) => creditMatches(c, tokens));
  const likely = [];
  const others = [];
  filtered.forEach((c) => {
    const fit = plausibility(c, receipts, lastName);
    if (fit) likely.push({ c, fit }); else others.push(c);
  });
  likely.sort((a, b) => a.fit.rank - b.fit.rank || a.fit.distance - b.fit.distance || String(b.c.settledAt).localeCompare(String(a.c.settledAt)));
  others.sort((a, b) => String(day(b.settledAt)).localeCompare(String(day(a.settledAt))) || String(b.settledAt).localeCompare(String(a.settledAt)));
  const start = Math.max(0, Number(offset) || 0);
  return {
    receipts: [...receipts].sort(dueSort).map((r) => ({ key: r.key || `${r.reservationId}|${r.ledgerKey}`, label: r.label, openCents: r.openCents, anchorDateLabel: anchorLabel(r) })),
    likely: likely.map(({ c, fit }) => creditView(c, { reasons: fit.reasons, fitsKey: fit.fitsKey })),
    others: { total: others.length, offset: start, items: others.slice(start, start + PAGE_SIZE).map((c) => creditView(c, { reasons: [], fitsKey: null })) },
    query: { tokens: publicTokens(tokens) },
  };
}

/**
 * Rule 14 — the open receipts a credit can be linked to: plausible first, the others folded.
 * @param {object} p
 * @param {object} p.credit     `{ remainingCents, settledAt, ... }`
 * @param {object[]} p.receipts open receipts of every fiche in scope
 * @param {Set<string>} [p.suggestedKeys] receipts of a proposal / combination found for this credit
 */
function creditReceipts({ credit, receipts, suggestedKeys = new Set(), q = '', offset = 0 }) {
  const tokens = parseSearch(q);
  const filtered = receipts.filter((r) => receiptMatches(r, tokens));
  const likely = [];
  const others = [];
  filtered.forEach((r) => {
    if (!credit) { others.push(r); return; }
    const anchor = anchorOf(r);
    const near = anchor && withinWindow(anchor, credit.settledAt);
    const diff = Math.abs(r.openCents - credit.remainingCents);
    const suggested = suggestedKeys.has(r.key);
    const named = nameMatches(r.reservation && r.reservation.lastName, credit);
    if ((near && (diff <= MARGIN_CENTS || named)) || suggested) {
      likely.push({ r, rank: suggested || diff === 0 ? 0 : (diff <= MARGIN_CENTS ? 1 : 2), diff });
    } else others.push(r);
  });
  likely.sort((a, b) => a.rank - b.rank || a.diff - b.diff || dueSort(a.r, b.r));
  others.sort(dueSort);
  const start = Math.max(0, Number(offset) || 0);
  const view = (r) => ({
    key: r.key, reservationId: r.reservationId, ledgerKey: r.ledgerKey, reservation: r.reservation, label: r.label,
    expectedCents: r.expectedCents, openCents: r.openCents, anchorDateLabel: anchorLabel(r), unbounded: Boolean(r.unbounded),
  });
  return {
    likely: likely.map(({ r }) => view(r)),
    others: { total: others.length, offset: start, items: others.slice(start, start + PAGE_SIZE).map(view) },
    query: { tokens: publicTokens(tokens) },
  };
}

module.exports = {
  parseSearch, creditMatches, receiptMatches, plausibility, ficheCredits, creditReceipts, anchorOf, dueSort, MARGIN_CENTS, WINDOW_DAYS, PAGE_SIZE,
};
