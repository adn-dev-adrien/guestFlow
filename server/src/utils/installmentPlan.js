/**
 * Installment plan of a direct reservation — pure rules (specs/direct-installments.md §3).
 *
 * No DB, no clock: today, the stay dates and the property's solde delay are injected, amounts travel in
 * cents. The controller persists what this module decides; the client only renders it (CLAUDE.md §6.0).
 *
 *   splitEuros / spreadCents  rule 6   whole-euro shares, the last one carries the cents
 *   defaultDates              rule 10  first = today, last = the usual solde date, the rest evenly spaced
 *   rebalance                 rules 7-9a  recompute before the first payment, frozen spread after it
 *   validateDate/Amount       rules 9a, 11
 *   statusOf                  rule 14
 *   buildPlanPayload          the `installmentPlan` object of the fiche payload (§4.3)
 */

const { daysBetween } = require('./paymentSchedule');
const { addDaysToIsoDate } = require('./devisHelpers');
const { bookingDayOf } = require('./vatRegime');

const MIN_COUNT = 2;
const MAX_COUNT = 12;
const LATE_AFTER_DAYS = 3;
const MIN_SHARE_CENTS = 100;

const NBSP = ' ';

const frDate = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const frShort = (iso) => frDate(iso).slice(0, 5);

function euros(cents) {
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

// The unpaid installments whose amount follows the total: every unpaid one that is not pinned, and
// always the last unpaid (rule 9a — it is never pinned and always adjusts).
function floatingOf(installments) {
  const unpaid = installments.filter((i) => !isPaid(i));
  const last = unpaid[unpaid.length - 1];
  return unpaid.filter((i) => i === last || !isPinned(i));
}

/**
 * Rules 7, 8, 9, 9a — the amounts after the reservation total (`targetCents`, the pre-arrival amount)
 * changed.
 *
 * @param {{ number:number, amountCents:number, paid:number, amountEdited:number }[]} installments
 * @returns {{ amounts: Map<number, number>, clearPins: boolean, gapCents: number, added: Map<number, number>, frozen: boolean }}
 *   `amounts` maps number → new amount (every installment); `added` the part a rise brought to each
 *   unpaid installment; `gapCents` what the frozen plan holds above the stay (rule 8, drop).
 */
function rebalance({ installments, targetCents }) {
  const amounts = new Map(installments.map((i) => [i.number, Number(i.amountCents)]));
  const added = new Map();
  const frozen = installments.some(isPaid);
  const unpaid = installments.filter((i) => !isPaid(i));
  let clearPins = false;

  if (unpaid.length === 0) {
    return { amounts, clearPins, gapCents: Math.max(0, sumCents(installments) - targetCents), added, frozen };
  }

  if (!frozen) {
    let floating = floatingOf(installments);
    let pinnedSum = unpaid.filter((i) => !floating.includes(i)).reduce((s, i) => s + Number(i.amountCents), 0);
    // A price drop can leave the pinned amounts with no room: they are released rather than starving the rest.
    if (targetCents - pinnedSum < MIN_SHARE_CENTS * floating.length) {
      clearPins = true;
      floating = unpaid;
      pinnedSum = 0;
    }
    spreadCents(targetCents - pinnedSum, floating.length, { minLast: MIN_SHARE_CENTS }).forEach((cents, k) => amounts.set(floating[k].number, cents));
    return { amounts, clearPins, gapCents: 0, added, frozen };
  }

  const delta = targetCents - sumCents(installments);
  if (delta > 0) {
    const floating = floatingOf(installments);
    spreadCents(delta, floating.length).forEach((cents, k) => {
      const { number } = floating[k];
      amounts.set(number, amounts.get(number) + cents);
      added.set(number, cents);
    });
    return { amounts, clearPins, gapCents: 0, added, frozen };
  }
  return { amounts, clearPins, gapCents: -delta, added, frozen };
}

const dateMessage = (number, text) => `Échéance ${number} : ${text}`;

// Rule 11 — a date for an unpaid installment. `index` is the installment's place in `installments`.
function validateDate({ installments, index, dueDate, today, startDate }) {
  const target = installments[index];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate || '')) || daysBetween(dueDate, dueDate) === null) {
    return dateMessage(target.number, 'date invalide.');
  }
  if (dueDate < today) return dateMessage(target.number, `date passée, à partir du ${frDate(today)}.`);
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

// Rule 9a — an amount typed by hand, in whole euros, on an unpaid installment other than the last unpaid.
function validateAmount({ installments, index, amountEuros, targetCents }) {
  const target = installments[index];
  const cents = Math.round(Number(amountEuros) * 100);
  if (amountEuros === '' || amountEuros === null || amountEuros === undefined || !Number.isFinite(Number(amountEuros))
    || cents <= 0 || cents % 100 !== 0) {
    return { error: 'Montant en euros entiers, supérieur à 0.' };
  }
  if (isPaid(target)) return { error: dateMessage(target.number, 'déjà payée.') };
  const unpaid = installments.filter((i) => !isPaid(i));
  const lastUnpaid = unpaid[unpaid.length - 1];
  if (target === lastUnpaid) return { error: dateMessage(target.number, "la dernière échéance s'ajuste toute seule.") };
  const others = unpaid.filter((i) => i !== target && (i === lastUnpaid || !isPinned(i)));
  const fixed = installments.filter((i) => i !== target && (isPaid(i) || (isPinned(i) && i !== lastUnpaid)));
  const rest = targetCents - sumCents(fixed) - cents;
  if (rest < MIN_SHARE_CENTS * others.length) {
    return { error: `Laisse moins de 1 € à l'échéance ${others[others.length - 1].number}.` };
  }
  return { cents, rest, others };
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

const METHOD_LABELS = { link: 'lien', transfer: 'virement', cash: 'espèces', cheque: 'chèque', card: 'carte', other: 'autre' };

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
function buildPlanPayload({ eligibility, rows = [], targetCents = 0, today, startDate, balanceDaysBefore, linkByInstallment = new Map(), canRequest = false }) {
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
        amountEditable: !isPaid(row) && row !== lastUnpaid,
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
  spreadCents, splitEuros, taxShares, lastDueDate, maxCountFor, defaultDates, floatingOf,
  rebalance, validateDate, validateAmount, statusOf, statusLabel, buildPlanPayload, requestContext,
  euros, frDate,
};
