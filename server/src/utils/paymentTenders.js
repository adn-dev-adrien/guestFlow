/**
 * One payment, several methods (specs/mixed-method-payments.md) — the pure rules of a « règlement »:
 * which methods exist, what a set of lines may be, and what a recorded settlement counts for.
 *
 * A settlement is one manual payment of a target (a bucket, the single arrival payment, a mid-stay note,
 * an installment) recorded as 1-4 tender lines `{ method, amountCents, internal }`. Its `parts` freeze the
 * buckets it covered, so every reader knows what the money paid for without re-deriving it.
 *
 * Pure functions — unit-tested in tests/mixed-method-payments.unit.test.js.
 */

// Rule 4 — fixed list, in display order. The client receives these labels from the ledger payload.
const METHODS = Object.freeze([
  Object.freeze({ value: 'card', label: 'CB' }),
  Object.freeze({ value: 'cash', label: 'Espèces' }),
  Object.freeze({ value: 'cheque', label: 'Chèque' }),
  Object.freeze({ value: 'transfer', label: 'Virement' }),
  Object.freeze({ value: 'holidayVoucher', label: 'Chèques-vacances' }),
  Object.freeze({ value: 'other', label: 'Autre' }),
]);
const METHOD_VALUES = new Set(METHODS.map((m) => m.value));
// Rule 28 — the methods whose money reaches the bank account.
const BANK_METHODS = new Set(['card', 'cheque', 'transfer']);
const MAX_LINES = 4;
const SHORTFALL_KINDS = new Set(['due', 'waived']);

const methodLabel = (value) => (METHODS.find((m) => m.value === value) || { label: String(value) }).label;

const euros = (cents) => `${(Math.round(Number(cents) || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

// Only a number or a numeric string is an amount: an object whose `toString` is not a function would throw.
function toCents(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/**
 * Rules 4-9, 15 — validates the typed lines against what the target owes.
 *
 * @param {object} input
 * @param {Array<{method:string, amountCents:number, internal?:boolean}>} input.tenders
 * @param {number} input.dueCents what the target owes (the amount the ordinary mark already checks)
 * @param {{kind:'due'|'waived'}|null} [input.shortfall] what becomes of the part not covered
 * @returns {{ ok:true, lines:Array, receivedCents:number, shortfallCents:number, shortfallKind:string|null }
 *          | { ok:false, error:string, field:'tenders'|'shortfall' }}
 */
function validateSettlement({ tenders, dueCents, shortfall = null }) {
  const refuse = (error, field = 'tenders') => ({ ok: false, error, field });
  if (!Array.isArray(tenders) || tenders.length === 0) return refuse('Au moins un moyen de paiement.');
  if (tenders.length > MAX_LINES) return refuse(`${MAX_LINES} moyens au plus.`);
  const due = toCents(dueCents);
  if (due == null || due <= 0) return refuse('Rien à encaisser.');
  const lines = [];
  const seen = new Set();
  for (const raw of tenders) {
    const method = raw && typeof raw.method === 'string' ? raw.method : '';
    if (!METHOD_VALUES.has(method)) return refuse('Moyen de paiement inconnu.');
    const amountCents = toCents(raw.amountCents);
    if (amountCents == null || amountCents <= 0) return refuse('Chaque moyen doit avoir un montant.');
    const internal = raw.internal === true || raw.internal === 1;
    if (internal && method !== 'cash') return refuse('Seules les espèces peuvent aller en caisse interne.');
    // Rule 8 — one line per method and destination: the operator adds to the existing one.
    const key = `${method}:${internal ? 1 : 0}`;
    if (seen.has(key)) {
      const where = method === 'cash' ? (internal ? ' en caisse interne' : ' en compta') : '';
      return refuse(`Une seule ligne ${methodLabel(method)}${where}.`);
    }
    seen.add(key);
    lines.push({ method, amountCents, internal });
  }
  const receivedCents = lines.reduce((s, l) => s + l.amountCents, 0);
  // Rule 6 — over the due: refused, the form keeps the lines.
  if (receivedCents > due) return refuse(`Les moyens font ${euros(receivedCents)} pour ${euros(due)} dus.`);
  const shortfallCents = due - receivedCents;
  if (shortfallCents === 0) return { ok: true, lines, receivedCents, shortfallCents: 0, shortfallKind: null };
  // Rule 15 — under the due: never silently.
  const kind = shortfall && typeof shortfall === 'object' && SHORTFALL_KINDS.has(shortfall.kind) ? shortfall.kind : null;
  if (!kind) return refuse(`${euros(shortfallCents)} ne sont pas couverts : reste à percevoir ou geste commercial ?`, 'shortfall');
  return { ok: true, lines, receivedCents, shortfallCents, shortfallKind: kind };
}

function parseParts(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * What one settlement counts for (rules 26-28). `bookedWaivedCents` is the share of the geste commercial
 * the books carry: `waived × books / received` — a settlement entirely in the caisse interne books none.
 */
function settlementFigures(settlement) {
  const tenders = settlement.tenders || [];
  let receivedCents = 0;
  let booksCents = 0;
  let internalCents = 0;
  let bankCents = 0;
  const byMethod = {};
  for (const t of tenders) {
    const amount = Number(t.amountCents) || 0;
    receivedCents += amount;
    if (Number(t.internal) === 1 || t.internal === true) internalCents += amount;
    else booksCents += amount;
    if (BANK_METHODS.has(t.method)) bankCents += amount;
    byMethod[t.method] = (byMethod[t.method] || 0) + amount;
  }
  const waivedCents = settlement.shortfallKind === 'waived' ? Number(settlement.shortfallCents) || 0 : 0;
  const bookedWaivedCents = receivedCents > 0 ? Math.round((waivedCents * booksCents) / receivedCents) : 0;
  return { receivedCents, booksCents, internalCents, bankCents, waivedCents, bookedWaivedCents, byMethod };
}

/**
 * The figures of one target, all its settlements together (rules 16-18). `shortfallDueCents` is what the
 * last settlement left to collect: a remainder collected later is a settlement of its own (rule 17).
 * `allInternal` drives the target's caisse-interne flag (rule 11).
 */
function targetFigures(settlements) {
  const list = [...(settlements || [])].sort((a, b) => (a.id || 0) - (b.id || 0));
  const total = { receivedCents: 0, booksCents: 0, internalCents: 0, bankCents: 0, waivedCents: 0, bookedWaivedCents: 0 };
  for (const s of list) {
    const f = settlementFigures(s);
    for (const k of Object.keys(total)) total[k] += f[k];
  }
  const last = list[list.length - 1];
  const shortfallDueCents = last && last.shortfallKind === 'due' ? Number(last.shortfallCents) || 0 : 0;
  return {
    ...total,
    shortfallDueCents,
    allInternal: list.length > 0 && total.booksCents === 0 && shortfallDueCents === 0,
  };
}

/**
 * The four per-reservation aggregates every money reader adds to its row (rules 16, 27). A target whose
 * own caisse-interne flag is set (rule 11: every line internal, nothing left due) is already off the books
 * whole: only its geste commercial is subtracted, from the caisse.
 *
 * @param {Array<{settlements:Array, flagged:boolean}>} targets
 */
function reservationAggregates(targets) {
  const out = { splitOffBooksAmount: 0, splitWaivedAmount: 0, splitWaivedCashAmount: 0, splitShortfallDue: 0 };
  for (const { settlements, flagged } of targets) {
    const f = targetFigures(settlements);
    if (flagged) {
      out.splitWaivedCashAmount += f.waivedCents;
    } else {
      out.splitOffBooksAmount += f.internalCents;
      out.splitWaivedAmount += f.waivedCents;
      out.splitShortfallDue += f.shortfallDueCents;
    }
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]) / 100;
  return out;
}

// « Espèces 50,00 € (caisse interne) · CB 72,00 € » — the history wording (rules 14, 24).
function linesText(tenders) {
  return (tenders || [])
    .map((t) => `${methodLabel(t.method)} ${euros(t.amountCents)}${Number(t.internal) === 1 || t.internal === true ? ' (caisse interne)' : ''}`)
    .join(' · ');
}

function shortfallText(settlement) {
  const cents = Number(settlement.shortfallCents) || 0;
  if (!cents) return '';
  return settlement.shortfallKind === 'waived' ? ` · geste commercial ${euros(cents)}` : ` · reste à percevoir ${euros(cents)}`;
}

function settlementText(settlement) {
  return `${linesText(settlement.tenders)}${shortfallText(settlement)}`;
}

const frDate = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

module.exports = {
  METHODS, BANK_METHODS, MAX_LINES, toCents,
  methodLabel, euros, frDate,
  validateSettlement, parseParts, settlementFigures, targetFigures, reservationAggregates,
  linesText, settlementText,
};
