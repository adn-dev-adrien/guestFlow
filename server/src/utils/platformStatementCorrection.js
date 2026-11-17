/**
 * The platform statement typed on a stay whose figures can no longer go through the fiche save
 * (specs/platform-statement-after-payout.md): a received payout, or a locked fiche. Pure — the model feeds it
 * the stored row and two replays of the same stay by the same engine, `before` (the statement as stored) and
 * `after` (the statement typed).
 *
 * Comparing two replays, never a replay with the stored row, keeps engine drift out: a catalogue edited since
 * the stay moves both replays alike, so only what the statement itself moves is seen (rule 7), and the final
 * price follows the stored one by the difference of the pre-arrival buckets only.
 */

const { pricedProjection } = require('./storedReservationQuote');
const { round2 } = require('./reservationSettlement');

const HALF_CENT = 0.005;

// The fields of the statement, as the fiche's « Paiement plateforme » sends them, plus the transfer received
// (rule 8: only on a received payout, where the panel shows it prefilled and editable).
const STATEMENT_FIELDS = ['platformGrossAmount', 'platformTouristTaxAmount', 'platformCommissionAmount', 'acompteCommissionAmount', 'platformPayoutAmount'];
const COMMISSION_FIELDS = ['platformCommissionAmount', 'acompteCommissionAmount'];

// What a statement may never move (rule 7), with the words the refusal uses.
const PROTECTED_FIGURES = [
  ['touristTaxTotal', 'la taxe de séjour'],
  ['complementAmount', 'le complément d’arrivée'],
  ['endOfStayComplementTotal', 'le complément de fin de séjour'],
  ['optionsTotal', 'les options'],
  ['resourcesTotal', 'les ressources'],
  ['extraGuestSurcharge', 'le supplément voyageurs'],
];

// The columns the correction writes from the `after` replay (rule 6).
const STATEMENT_COLUMNS = ['depositAmount', 'balanceAmount', 'platformCommissionAmount', 'acompteCommissionAmount'];

/** A money field of the body: '' / null → null (cleared), a finite number ≥ 0 → rounded, anything else → NaN. */
function readMoney(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? round2(n) : Number.NaN;
}

/**
 * The statement of the body, validated. Only the fields present are taken; the others keep their stored value.
 * @returns {{ ok: true, statement: object } | { ok: false, error: string }}
 */
function parseStatement(body = {}, stored = {}) {
  const statement = {};
  for (const field of STATEMENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const value = readMoney(body[field]);
    if (Number.isNaN(value)) return { ok: false, error: 'Montant invalide : un nombre positif ou nul est attendu.' };
    statement[field] = value;
  }
  if (Object.keys(statement).length === 0) return { ok: false, error: 'Aucun montant du relevé à enregistrer.' };
  const merged = { ...stored, ...statement };
  const gross = merged.platformGrossAmount == null || merged.platformGrossAmount === '' ? null : Number(merged.platformGrossAmount);
  const commissions = round2(Number(merged.platformCommissionAmount || 0) + Number(merged.acompteCommissionAmount || 0));
  if (gross != null && commissions > gross + HALF_CENT) {
    return { ok: false, error: 'La commission ne peut pas dépasser le montant payé par le client.' };
  }
  return { ok: true, statement };
}

const preArrivalOf = (row) => round2(Number(row.depositAmount || 0) + Number(row.balanceAmount || 0));
const commissionsOf = (row) => round2(Number(row.platformCommissionAmount || 0) + Number(row.acompteCommissionAmount || 0));

/** The transfer received (rule 4): the one typed in the panel, else the stored « Virement reçu », else the stored net. */
function netReceived(stored, statement = {}) {
  const typed = statement.platformPayoutAmount;
  if (typed != null) return round2(typed);
  const payout = stored.platformPayoutAmount;
  if (payout !== '' && payout != null && Number.isFinite(Number(payout))) return round2(payout);
  return round2(preArrivalOf(stored) - commissionsOf(stored));
}

/** What the statement would move beyond itself (rule 7): the labels of the moved figures, empty when none. */
function movedFigures(before, after) {
  const moved = PROTECTED_FIGURES
    .filter(([key]) => Math.abs(round2(before[key]) - round2(after[key])) >= HALF_CENT)
    .map(([, label]) => label);
  const lines = (q) => JSON.stringify({ o: pricedProjection(q).optionLines, r: pricedProjection(q).resourceLines });
  const nights = (q) => JSON.stringify(pricedProjection(q).nights.map(([date]) => date));
  if (!moved.includes('les options') && lines(before) !== lines(after)) moved.push('les lignes d’options');
  if (nights(before) !== nights(after)) moved.push('les nuits');
  return moved;
}

/**
 * Rule 7bis — without a brut the replay prices the stay from today's tariff: when it no longer finds the pre-arrival
 * amount the stay carries (a catalogue edited, nights moved since), writing its buckets would re-price a sold stay.
 */
function driftedWithoutGross(stored, statement, before) {
  const merged = { ...stored, ...statement };
  const hasGross = !(merged.platformGrossAmount === '' || merged.platformGrossAmount == null);
  if (hasGross) return false;
  return Math.abs(round2(Number(before.depositAmount || 0) + Number(before.balanceAmount || 0)) - preArrivalOf(stored)) >= HALF_CENT;
}

/** Rule 3 (validation) — a commission the engine had to cut to its échéance: the label of the field, else null. */
function clampedCommission(statement, after) {
  const labels = { platformCommissionAmount: 'La commission solde', acompteCommissionAmount: 'La commission acompte' };
  const field = COMMISSION_FIELDS.find((key) => statement[key] != null
    && Math.abs(round2(statement[key]) - round2(after[key])) >= HALF_CENT);
  return field ? labels[field] : null;
}

/**
 * The columns to write: the statement, the buckets and commissions of the `after` replay, and the final price
 * moved by exactly what the pre-arrival buckets moved (rule 6).
 */
function nextColumns(stored, statement, after) {
  const { platformPayoutAmount, ...figures } = statement;
  const next = { ...figures };
  for (const column of STATEMENT_COLUMNS) next[column] = round2(after[column]);
  next.finalPrice = round2(Number(stored.finalPrice || 0) + preArrivalOf(next) - preArrivalOf(stored));
  return next;
}

/** The signed gap between the net the statement gives and the transfer received, 0 within half a cent. */
function netGapOf(next, received) {
  const gap = round2(preArrivalOf(next) - commissionsOf(next) - received);
  return Math.abs(gap) < HALF_CENT ? 0 : gap;
}

/**
 * The sentence the panel prints under the fields (rules 3-4), worded here so the client only renders it.
 * @returns {{ tone: 'done' | 'warning', label: string } | null} null when nothing has been received
 */
function netLabelOf(next, received, formatEuros) {
  if (received == null) return null;
  const net = round2(preArrivalOf(next) - commissionsOf(next));
  const gap = netGapOf(next, received);
  if (gap === 0) return { tone: 'done', label: `Net : ${formatEuros(net)} — identique au virement ✓` };
  return {
    tone: 'warning',
    label: `Net : ${formatEuros(net)} — le virement reçu est de ${formatEuros(received)} (écart ${formatEuros(Math.abs(gap))}). Le relevé sera enregistré avec cet écart.`,
  };
}

module.exports = {
  STATEMENT_FIELDS, parseStatement, netReceived, movedFigures, nextColumns, netGapOf, netLabelOf,
  driftedWithoutGross, clampedCommission,
};
