/**
 * Installment plan of a direct reservation — pure rules (specs/payments/direct-installments.md §3).
 *
 * No DB, no clock: today, the stay dates and the property's solde delay are injected, amounts travel in
 * cents. The controller persists what this module decides; the client only renders it (CLAUDE.md §6.0).
 *
 *   splitEuros / spreadCents  rule 6   whole-euro shares, the last one carries the cents
 *   defaultDates              rule 10  first = today, last = the usual solde date, the rest evenly spaced
 *   rebalance                 rules 7-9a, 53-56  recompute before the first payment, frozen spread after it
 *   validateDate/Amount       rules 9a, 11, 53, 55
 *   isClosed / collectedDepositCents  rules 53, 60
 *   statusOf                  rule 14
 *   buildPlanPayload          the `installmentPlan` object of the fiche payload (§4.3)
 */

const { daysBetween } = require('./paymentSchedule');
const { addDaysToIsoDate } = require('./devisHelpers');
const { bookingDayOf } = require('./vatRegime');
const { dateBeyondHorizon, isRealIsoDay } = require('./stayDates');
const { roundMoneyOrZero } = require('./pricing/money');

const MIN_COUNT = 2;
const MAX_COUNT = 12;
const LATE_AFTER_DAYS = 3;
const MIN_SHARE_CENTS = 100;

const NBSP = ' ';

const frDate = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const frShort = (iso) => frDate(iso).slice(0, 5);

function eurosText(cents) {
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const dec = abs % 100;
  return `${sign}${whole}${dec ? `,${String(dec).padStart(2, '0')}` : ''}${NBSP}€`;
}

// Rule 6 — `count` shares of `cents`: each but the last rounds to the whole euro (half up), the last takes
// what is left. Rule 32 — when that would leave the last share under `minLast` (a negative share on a
// rise), the shares are floored to the euro instead: the last then takes the remainder and is never
// smaller than the others.
function spreadCents(cents, count, { minLast = 0 } = {}) {
  if (count <= 0) return [];
  const build = (each) => Array.from({ length: count }, (_, i) => (i < count - 1 ? each : cents - each * (count - 1)));
  const rounded = build(Math.round(cents / count / 100) * 100);
  if (rounded[count - 1] >= minLast) return rounded;
  return build(Math.max(0, Math.floor(cents / count / 100) * 100));
}

// Rule 6 plus the floor of the edge case « total below N euros »: null when a share would fall under 1 €.
function splitEuros(totalCents, count) {
  const shares = spreadCents(totalCents, count, { minLast: MIN_SHARE_CENTS });
  return shares.length > 0 && shares.every((c) => c >= MIN_SHARE_CENTS) ? shares : null;
}

// Rule 10 — the last due date: the usual solde date, never before today.
function lastDueDate({ today, startDate, balanceDaysBefore }) {
  const solde = addDaysToIsoDate(String(startDate).slice(0, 10), -Number(balanceDaysBefore));
  return solde && solde > today ? solde : today;
}

// Rule 3 — two installments may not share a day: N installments need N calendar days from first to last.
function maxCountFor(context) {
  const span = daysBetween(context.today, lastDueDate(context));
  if (span === null) return 0;
  return Math.max(0, Math.min(MAX_COUNT, span + 1));
}

// Rule 10 — evenly spaced, rounded to the day.
function defaultDates(context, count) {
  const first = context.today;
  const last = lastDueDate(context);
  const span = daysBetween(first, last);
  return Array.from({ length: count }, (_, i) => (i === count - 1
    ? last
    : addDaysToIsoDate(first, Math.round((span * i) / (count - 1)))));
}

const sumCents = (list) => list.reduce((sum, i) => sum + Number(i.amountCents || 0), 0);
const isPaid = (i) => Number(i.paid || 0) === 1;
const isPinned = (i) => Number(i.amountEdited || 0) === 1;

// The unpaid installments whose amount follows the total: the ones that are not pinned. Since rule 53
// the last unpaid one is no exception: pinned too, it stops adjusting.
function floatingOf(installments) {
  return installments.filter((i) => !isPaid(i) && !isPinned(i));
}

// Rule 53 — a plan is closed when it still owes installments and none of them adjusts any more: what it
// does not cover is paid at the arrival (rule 54).
function isClosed(installments) {
  return installments.some((i) => !isPaid(i)) && floatingOf(installments).length === 0;
}

// Rule 58 — what the plan's installments do not cover, read from the stay's row (rule 23 aggregates), capped at `room`: what
// the arrival complement holds beyond its other lines. 0 when nothing is left.
function restOfPlan(row, room) {
  const money = roundMoneyOrZero;
  const shortfall = money(Number(row.installmentsTarget || 0) - Number(row.installmentsPaidAmount || 0) - Number(row.installmentsUnpaidAmount || 0));
  const rest = Math.min(room, shortfall);
  return rest > 0.01 ? money(rest) : 0;
}

// Rule 60 — the acompte collected before the plan was made (cash included): it keeps its own bucket, the plan
// splits what is left of the pre-arrival amount.
function collectedDepositCents(stay) {
  const collected = Number(stay.depositPaid || 0) === 1 || Number(stay.depositPaidCash || 0) === 1;
  return collected ? Math.max(0, Math.round(Number(stay.depositAmount || 0) * 100)) : 0;
}

/**
 * Rules 7, 8, 9, 9a, 53, 56 — the amounts after the reservation total (`targetCents`, what the plan covers:
 * the pre-arrival amount less a collected acompte) changed. A closed plan never moves an installment on a
 * rise or a drop the shortfall absorbs; a drop beyond it, before any payment, releases the last unpaid pin.
 *
 * @param {{ number:number, amountCents:number, paid:number, amountEdited:number }[]} installments
 * @returns {{ amounts: Map<number, number>, clearPins: boolean, unpin: number[], gapCents: number, added: Map<number, number>, frozen: boolean }}
 *   `amounts` maps number → new amount (every installment); `added` the part a rise brought to each
 *   unpaid installment; `gapCents` what the frozen plan holds above the stay (rule 8, drop).
 */
function rebalance({ installments, targetCents }) {
  const amounts = new Map(installments.map((i) => [i.number, Number(i.amountCents)]));
  const added = new Map();
  const frozen = installments.some(isPaid);
  const unpaid = installments.filter((i) => !isPaid(i));
  let clearPins = false;
  const unpin = [];

  if (unpaid.length === 0) {
    return { amounts, clearPins, unpin, gapCents: Math.max(0, sumCents(installments) - targetCents), added, frozen };
  }

  if (!frozen) {
    let floating = floatingOf(installments);
    if (floating.length === 0) {
      // Rule 56 — closed: the complement carries a rise and a drop it can absorb; a plan above the stay frees its last pin.
      if (sumCents(installments) <= targetCents) return { amounts, clearPins, unpin, gapCents: 0, added, frozen };
      floating = [unpaid[unpaid.length - 1]];
      unpin.push(floating[0].number);
    }
    let pinnedSum = unpaid.filter((i) => !floating.includes(i)).reduce((s, i) => s + Number(i.amountCents), 0);
    // A price drop can leave the pinned amounts with no room: they are released rather than starving the rest.
    if (targetCents - pinnedSum < MIN_SHARE_CENTS * floating.length) {
      clearPins = true;
      floating = unpaid;
      pinnedSum = 0;
    }
    spreadCents(targetCents - pinnedSum, floating.length, { minLast: MIN_SHARE_CENTS }).forEach((cents, k) => amounts.set(floating[k].number, cents));
    return { amounts, clearPins, unpin, gapCents: 0, added, frozen };
  }

  const delta = targetCents - sumCents(installments);
  if (delta > 0) {
    const floating = floatingOf(installments);
    spreadCents(delta, floating.length).forEach((cents, k) => {
      const { number } = floating[k];
      amounts.set(number, amounts.get(number) + cents);
      added.set(number, cents);
    });
    return { amounts, clearPins, unpin, gapCents: 0, added, frozen };
  }
  return { amounts, clearPins, unpin, gapCents: -delta, added, frozen };
}

const dateMessage = (number, text) => `Échéance ${number} : ${text}`;

// Rule 11 — a date for an unpaid installment. `index` is the installment's place in `installments`.
function validateDate({ installments, index, dueDate, today, startDate }) {
  const target = installments[index];
  if (!isRealIsoDay(dueDate)) {
    return dateMessage(target.number, 'date invalide.');
  }
  if (dueDate < today) return dateMessage(target.number, `date passée, à partir du ${frDate(today)}.`);
  // specs/tech/reservations-backend-mvc.md rule 13 (reading of 2026-11-02) — a stay stored past the horizon
  // before the rule does not carry its installments past it.
  if (dateBeyondHorizon(dueDate, today)) return dateMessage(target.number, 'date trop lointaine : 5 ans au plus.');
  const arrival = String(startDate).slice(0, 10);
  if (dueDate > arrival) return dateMessage(target.number, `après l'arrivée du ${frDate(arrival)}.`);
  const prev = installments[index - 1];
  const next = installments[index + 1];
  if (prev && dueDate <= prev.dueDate) {
    return dateMessage(target.number, `après l'échéance ${prev.number} (${frDate(prev.dueDate)}) et avant l'arrivée du ${frDate(arrival)}.`);
  }
  if (next && dueDate >= next.dueDate) {
    return dateMessage(target.number, `avant l'échéance ${next.number} (${frDate(next.dueDate)}).`);
  }
  return null;
}

// Rules 9a, 53, 55 — an amount typed by hand, cents allowed and at least 1 €, on an unpaid installment. `targetCents` is
// what the typed amount is shared out of (the plan's own total once it is frozen); `stayCents` what the stay asks of the
// plan, the ceiling of rule 55 when no installment is left to adjust.
function validateAmount({ installments, index, amountEuros, targetCents, stayCents = targetCents }) {
  const target = installments[index];
  const cents = Math.round(Number(amountEuros) * 100);
  if (amountEuros === '' || amountEuros === null || amountEuros === undefined || !Number.isFinite(Number(amountEuros))) {
    return { error: 'Montant illisible (ex. 250,50).' };
  }
  if (cents < MIN_SHARE_CENTS) return { error: 'Montant d’au moins 1 € attendu.' };
  if (isPaid(target)) return { error: dateMessage(target.number, 'déjà payée.') };
  const others = floatingOf(installments).filter((i) => i !== target);
  const fixed = installments.filter((i) => i !== target && !others.includes(i));
  const rest = targetCents - sumCents(fixed) - cents;
  if (others.length === 0) {
    // Rule 55 — nothing adjusts any more: the plan may not hold more than the stay (nor more than it held already).
    const after = sumCents(fixed) + cents;
    if (after > stayCents && after > sumCents(installments)) {
      const room = stayCents - sumCents(fixed);
      return { error: dateMessage(target.number, `dépasse le séjour de ${eurosText(after - stayCents)} (${eurosText(room)} au plus).`) };
    }
    return { cents, rest: 0, others, closes: true };
  }
  if (rest < MIN_SHARE_CENTS * others.length) {
    return { error: `Laisse moins de 1 € à l'échéance ${others[others.length - 1].number}.` };
  }
  return { cents, rest, others, closes: false };
}

// Rule 39 — the tourist tax rides every installment in proportion to its amount; the last installment takes
// what is left, so the shares add up to the tax exactly.
function taxShares(taxCents, amountsCents) {
  const scheduled = amountsCents.reduce((sum, c) => sum + c, 0);
  if (!(taxCents > 0) || !(scheduled > 0)) return amountsCents.map(() => 0);
  const shares = amountsCents.map((c) => Math.min(c, Math.round((taxCents * c) / scheduled)));
  const early = shares.slice(0, -1).reduce((sum, c) => sum + c, 0);
  shares[shares.length - 1] = Math.max(0, taxCents - early);
  return shares;
}

// Rule 14 — one status per installment. « En retard » = unpaid three days after the due date.
function statusOf(installment, today) {
  if (isPaid(installment)) return 'paid';
  if (today >= addDaysToIsoDate(installment.dueDate, LATE_AFTER_DAYS)) return 'late';
  if (installment.requestedAt) return 'requested';
  return installment.dueDate > today ? 'upcoming' : 'toRequest';
}

const METHOD_LABELS = {
  link: 'lien', transfer: 'virement', cash: 'espèces', cheque: 'chèque', card: 'carte', other: 'autre',
  // specs/payments/mixed-method-payments.md rule 12 — an installment paid with several methods.
  mixed: 'plusieurs moyens',
};

function statusLabel(installment, status) {
  switch (status) {
    case 'paid': {
      const method = METHOD_LABELS[installment.paidMethod] || installment.paidMethod;
      return `Payée le ${frShort(installment.paidDate)}${method ? ` · ${method}` : ''}`;
    }
    case 'late': return 'En retard';
    case 'requested': return `Demandée le ${frShort(bookingDayOf(installment.requestedAt))}`;
    case 'toRequest': return 'À demander';
    default: return 'À venir';
  }
}

/**
 * The `installmentPlan` payload (§4.3). `eligibility` is `{ eligible, canCreate, reason }` decided by the
 * controller (rules 1-2); `linkByInstallment` maps an installment id to its open payment link.
 */
function buildPlanPayload({ eligibility, rows = [], targetCents = 0, today, startDate, balanceDaysBefore, linkByInstallment = new Map(), canRequest = false, deposit = null, restCollected = false }) {
  const base = {
    eligible: Boolean(eligibility.eligible),
    canCreate: Boolean(eligibility.canCreate),
    reason: eligibility.reason || null,
    countLocked: false,
    frozen: false,
    total: 0,
    paid: 0,
    remaining: 0,
    gap: 0,
    minCount: MIN_COUNT,
    maxCount: 0,
    count: 0,
    canRequest: Boolean(canRequest),
    arrivalDate: String(startDate || '').slice(0, 10) || null,
    settled: false,
    closed: false,
    restCollected: false,
    arrivalRest: 0,
    deposit: null,
    installments: [],
  };
  if (!eligibility.eligible) return base;

  const context = { today, startDate, balanceDaysBefore };
  base.maxCount = maxCountFor(context);
  if (rows.length === 0) return base;

  const frozen = rows.some(isPaid);
  const unpaid = rows.filter((i) => !isPaid(i));
  const lastUnpaid = unpaid[unpaid.length - 1];
  const paidCents = sumCents(rows.filter(isPaid));
  const scheduled = sumCents(rows);
  // Rule 33 — the stay is covered by what was collected: the rest of the plan is not due.
  const settled = targetCents > 0 && paidCents >= targetCents && unpaid.length > 0;
  const closed = isClosed(rows);
  return {
    ...base,
    countLocked: frozen,
    frozen,
    count: rows.length,
    total: targetCents / 100,
    paid: paidCents / 100,
    remaining: settled ? 0 : Math.max(0, scheduled - paidCents) / 100,
    settled,
    canRequest: Boolean(canRequest) && !settled,
    gap: frozen ? Math.max(0, scheduled - targetCents) / 100 : 0,
    // Rules 54, 58 — what a closed plan leaves to the arrival complement, the server's figure the card prints.
    closed,
    restCollected,
    arrivalRest: closed && !settled ? Math.max(0, targetCents - scheduled) / 100 : 0,
    // Rule 60 — the acompte collected before the plan, shown as a paid row beside it.
    deposit,
    installments: rows.map((row) => {
      const status = statusOf(row, today);
      const link = linkByInstallment.get(row.id) || null;
      return {
        id: row.id,
        number: row.number,
        dueDate: row.dueDate,
        amount: Number(row.amountCents) / 100,
        status,
        statusLabel: statusLabel(row, status),
        editable: !isPaid(row),
        amountEditable: !isPaid(row),
        canRelease: row === lastUnpaid && isPinned(row) && !restCollected,
        amountEdited: isPinned(row) && !isPaid(row),
        dateEdited: Number(row.dateEdited || 0) === 1 && !isPaid(row),
        added: Number(row.addedCents || 0) / 100,
        paidDate: row.paid ? row.paidDate : null,
        method: row.paid ? row.paidMethod : null,
        requestedAt: row.requestedAt || null,
        linkUrl: link ? link.url : null,
        clamped: !isPaid(row) && row.dueDate === String(startDate).slice(0, 10),
      };
    }),
  };
}

// Rule 21 — what the request email says of the installment it asks for and of the whole plan.
function requestContext(installment, rows) {
  return {
    number: installment.number,
    count: rows.length,
    amount: Number(installment.amountCents) / 100,
    dueDate: installment.dueDate,
    schedule: rows.map((row) => ({
      number: row.number, dueDate: row.dueDate, amount: Number(row.amountCents) / 100, paid: isPaid(row),
    })),
  };
}

module.exports = {
  MIN_COUNT, MAX_COUNT, LATE_AFTER_DAYS, MIN_SHARE_CENTS,
  spreadCents, splitEuros, taxShares, lastDueDate, maxCountFor, defaultDates, floatingOf, isClosed, collectedDepositCents, restOfPlan,
  rebalance, validateDate, validateAmount, statusOf, statusLabel, buildPlanPayload, requestContext,
  euros: eurosText, frDate,
};
