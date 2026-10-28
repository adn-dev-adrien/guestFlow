/**
 * The franchise-threshold follow-up (specs/vat-optional-mode.md rules 35-44): the pure rules.
 *
 * Under « franchise en base » (art. 293 B) the operator types the threshold itself; GuestFlow compares
 * it with the turnover collected during the calendar year and the one still expected before 31
 * December. The model reads the money (vatFranchiseModel); this module only decides what counts, in
 * which level it falls and with which words.
 */

const { parseGoalAmount, MESSAGES: GOAL_MESSAGES } = require('./revenueGoals');
const { addDaysToIsoDate } = require('./devisHelpers');

const NBSP = ' ';

const MESSAGES = Object.freeze({
  notPositive: 'Montant supérieur à 0 €. Vide pour ne pas en fixer.',
  notANumber: 'Un montant en euros (ex. 12 500).',
  tooManyDecimals: 'Deux décimales au plus.',
  tooHigh: '10 000 000 € au plus.',
  notApplicable: 'Seuil sans objet hors franchise',
});

const GOAL_TO_OWN = new Map([
  [GOAL_MESSAGES.notPositive, MESSAGES.notPositive],
  [GOAL_MESSAGES.notANumber, MESSAGES.notANumber],
  [GOAL_MESSAGES.tooManyDecimals, MESSAGES.tooManyDecimals],
  [GOAL_MESSAGES.tooHigh, MESSAGES.tooHigh],
]);

/** Rule 36 — the same parser as the revenue goal, with the threshold's own messages. */
function parseThreshold(value) {
  const parsed = parseGoalAmount(value);
  if (parsed.ok) return parsed;
  return { ok: false, error: GOAL_TO_OWN.get(parsed.error) || MESSAGES.notANumber };
}

const cents = (n) => Math.round((Number(n) || 0) * 100);
const euros = (n) => cents(n) / 100;

/** Rule 35 — the follow-up exists only under « Sans TVA » with the franchise mention. */
function franchiseApplies(block) {
  return Boolean(block) && block.regime === 'not_subject' && block.legalMention === 'art_293_b';
}

/**
 * Rule 37 — the turnover of `[from, to]`: every ledger row dated in the range, gross of the platform
 * commission, without tourist tax (and without VAT under a taxed period), refunds subtracted on their
 * own date, then the compensations received in the range. `share(reservationId, amount)` is the model's
 * part of a positive amount that is turnover.
 */
function turnoverOf({ rows, compensations = [], from, to, share }) {
  let total = 0;
  const inRange = (date) => Boolean(date) && date >= from && date <= to;
  for (const row of rows) {
    if (!inRange(row.date)) continue;
    const amount = Number(row.amount) || 0;
    total += amount >= 0
      ? share(row.reservationId, amount + (Number(row.commission) || 0))
      : -share(row.reservationId, -amount);
  }
  for (const c of compensations) {
    if (inRange(c.date)) total += share(c.reservationId, Number(c.amount) || 0);
  }
  return euros(total);
}

/**
 * Rule 38 — what is still to be collected on a stay of kind `reservation`, expected on or before
 * `yearEnd`, past dates included. `installments`: the unpaid rows of its plan `{ dueDate, amountCents }`;
 * `payoutDays` the delay of its platform; `isPlatform` whether the solde is a platform payout.
 */
function expectedOf({ stay, installments = [], payoutDays, isPlatform, yearEnd, share }) {
  let total = 0;
  const due = (date, amount) => {
    if (amount > 0 && date && date <= yearEnd) total += share(stay.id, amount);
  };
  const unpaid = (paid, paidCash) => !paid && !paidCash;
  if (!stay.depositDisabled && unpaid(stay.depositPaid, stay.depositPaidCash)) {
    due(stay.depositDueDate || stay.startDate, Number(stay.depositAmount) || 0);
  }
  if (unpaid(stay.balancePaid, stay.balancePaidCash)) {
    const date = isPlatform ? addDaysToIsoDate(stay.endDate, payoutDays) : (stay.balanceDueDate || stay.endDate);
    due(date, Number(stay.balanceAmount) || 0);
  }
  if (unpaid(stay.complementPaid, stay.complementPaidCash)) due(stay.startDate, Number(stay.complementAmount) || 0);
  if (unpaid(stay.endOfStayComplementPaid, stay.endOfStayComplementPaidCash)) {
    due(stay.endDate, Number(stay.endOfStayComplementAmount) || 0);
  }
  for (const i of installments) due(i.dueDate, (Number(i.amountCents) || 0) / 100);
  return euros(total);
}

/** Rule 39 — comparisons use cents; « near » starts at 80 % of the threshold, and `= threshold` is « near », never « over ». */
function levelOf({ collected, projected, threshold }) {
  if (threshold == null) return null;
  const c = cents(collected);
  const t = cents(threshold);
  if (c > t) return 'over';
  if (c * 10 >= t * 8) return 'near';
  if (projected != null && cents(projected) > t) return 'projected_over';
  return 'ok';
}

const percent = (value, whole) => Math.round((cents(value) / cents(whole)) * 100);

/** « 1 240 € », whole euros; under 1 € the cents show, so an overrun never reads « 0 € ». */
function formatAmount(amount) {
  const n = Math.abs(euros(amount));
  const text = n < 1 && n > 0
    ? n.toFixed(2).replace('.', ',')
    : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${text}${NBSP}€`;
}

const LEVELS = {
  ok: { tone: 'neutral', title: 'Sous le seuil' },
  near: { tone: 'warning', title: 'Seuil proche' },
  projected_over: { tone: 'warning', title: 'Projection au-delà du seuil' },
  over: { tone: 'error', title: 'Seuil dépassé' },
};

/** Rule 39 — tone, title, text and action of a level, from the figures. */
function wordsOf({ level, collected, projected, threshold, settingsPath }) {
  if (!level) return { tone: 'neutral', title: null, text: null, action: null };
  const base = LEVELS[level];
  const left = formatAmount(Math.max(0, euros(threshold) - euros(collected)));
  if (level === 'over') {
    return {
      ...base,
      text: `${formatAmount(euros(collected) - euros(threshold))} au-delà du seuil. Retour à la TVA à prévoir.`,
      action: { label: 'Passer à la TVA…', path: settingsPath },
    };
  }
  if (level === 'projected_over') {
    return {
      ...base,
      text: `${formatAmount(euros(projected) - euros(collected))} attendus d’ici le 31/12 avec les réservations en cours.`,
      action: null,
    };
  }
  return { ...base, text: `Reste ${left} avant le seuil.`, action: null };
}

/** Rule 42 — the home's line for a level, or null when nothing is worth saying. */
function attentionSummary(payload) {
  if (!payload || !payload.applies || !payload.level || payload.level === 'ok') return null;
  const { level, collected, projected, threshold } = payload;
  const detail = {
    over: `Dépassé de ${formatAmount(euros(collected) - euros(threshold))}`,
    near: `${percent(collected, threshold)} % atteint`,
    projected_over: `Projection : ${percent(projected, threshold)} %`,
  }[level];
  return { count: 1, title: 'Seuil de franchise', detail, severity: level === 'over' ? 'urgent' : 'todo' };
}

module.exports = {
  MESSAGES, parseThreshold, franchiseApplies, turnoverOf, expectedOf, levelOf, wordsOf, attentionSummary, formatAmount, percent,
};
