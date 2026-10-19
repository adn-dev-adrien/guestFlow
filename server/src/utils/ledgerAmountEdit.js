/**
 * Setting the acompte or the solde from the payments ledger (specs/reservation-payment-ledger.md
 * §3.3, rules 15-21). Decision 8 of the UI/UX review 2026-10-18: both amounts stay settable.
 *
 * The field only proposes; this module decides. It answers either a refusal in French (`reason`),
 * or the consequence of the typed amount (`effects`), the amount the engine actually reaches and the
 * exact form fields the fiche applies verbatim (`formPatch`). The client computes nothing.
 *
 * Notation (direct stay): P = pre-arrival amount (acompte + solde), H = its accommodation part,
 * T = the tourist tax riding on the solde (P = H + T).
 *
 *   - acompte, not perceived: 0 ≤ A ≤ H, stored as `depositAmountOverride` (rule 16);
 *   - solde, acompte not perceived: T ≤ S ≤ P, the split moves, not the price (rule 17);
 *   - solde, acompte perceived or no acompte at all: a different price. The whole engine is re-run for
 *     each candidate accommodation price (`evaluate`, injected) until the solde equals S, or the
 *     nearest reachable cent; the accommodation never falls below the acompte received (rule 18);
 *   - a perceived row keeps what it collected (rules 19-20).
 *
 * Pure apart from the injected `evaluate(customPrice) → quote`.
 */

const { evaluateArithmetic } = require('./moneyExpression');
const { formatEuros } = require('./reservationLedger');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toCents = (n) => Math.round(round2(n) * 100);
const MAX_PASSES = 8;
const NEIGHBOURHOOD_CENTS = 3;

/** « 12,5 », « 12.5 », « 100+20 », a number — rounded to the cent, or null when unreadable. */
function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? round2(raw) : null;
  const value = evaluateArithmetic(raw);
  return value == null ? null : round2(value);
}

const refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/** Rule 19 — what a perceived row answers to a different amount. */
function paidRefusal(collected, typed) {
  if (typed < collected - 0.004) {
    const gap = round2(collected - typed);
    return refuse(`Déjà perçu : ${formatEuros(collected)}. Pour rendre ${formatEuros(gap)}, créer un remboursement.`, {
      refund: { amount: gap, label: 'Créer le remboursement' },
    });
  }
  if (typed > collected + 0.004) {
    return refuse(`Déjà perçu : ${formatEuros(collected)}. Pour un autre montant, annuler la perception puis la refaire.`);
  }
  return refuse('Montant inchangé.');
}

/**
 * The cheapest accommodation price whose pre-arrival accommodation still covers the acompte received
 * (rule 18, floor H' ≥ A). With no acompte the floor is a price of 0.
 */
function floorPrice({ evaluate, startPrice, acompte }) {
  if (!(acompte > 0)) return 0;
  const target = toCents(acompte);
  let c = toCents(startPrice);
  let q = evaluate(c / 100);
  let h = toCents(q.accommodationPreArrival);
  for (let pass = 0; pass < MAX_PASSES && h !== target; pass += 1) {
    const probe = evaluate((c + 100) / 100);
    const slope = (toCents(probe.accommodationPreArrival) - h) / 100 || 1;
    c = Math.max(0, c + Math.round((target - h) / slope));
    q = evaluate(c / 100);
    h = toCents(q.accommodationPreArrival);
  }
  // A percentage option rounds in steps: walk to the first cent that covers the acompte.
  while (h < target) { c += 1; h = toCents(evaluate(c / 100).accommodationPreArrival); }
  while (c > 0 && toCents(evaluate((c - 1) / 100).accommodationPreArrival) >= target) c -= 1;
  return c / 100;
}

/**
 * Rule 18 — the accommodation price whose solde equals `target`, or the nearest reachable cent.
 * Secant passes on the engine, then a small walk around the best price. Never below `minPrice`.
 */
function solveBalance({ evaluate, startPrice, target, minPrice }) {
  const goal = toCents(target);
  const floor = toCents(minPrice);
  const seen = new Map();
  const balanceAt = (c) => {
    if (!seen.has(c)) seen.set(c, toCents(evaluate(c / 100).balanceAmount));
    return seen.get(c);
  };
  let c = Math.max(floor, toCents(startPrice));
  for (let pass = 0; pass < MAX_PASSES && balanceAt(c) !== goal; pass += 1) {
    const slope = (balanceAt(c + 100) - balanceAt(c)) / 100 || 1;
    const next = Math.max(floor, c + Math.round((goal - balanceAt(c)) / slope));
    if (next === c) break;
    c = next;
  }
  let best = c;
  for (let d = -NEIGHBOURHOOD_CENTS; d <= NEIGHBOURHOOD_CENTS; d += 1) {
    const candidate = c + d;
    if (candidate < floor) continue;
    const gap = Math.abs(balanceAt(candidate) - goal);
    const bestGap = Math.abs(balanceAt(best) - goal);
    if (gap < bestGap || (gap === bestGap && candidate < best)) best = candidate;
  }
  return best / 100;
}

/**
 * @param {object} p
 * @param {'deposit'|'balance'} p.row   the ledger row being edited
 * @param {*} p.amount                  what the operator typed (string or number)
 * @param {object} p.quote              the live quote of the fiche as it stands
 * @param {object} p.ledger             the ledger built on that quote (row states and modes)
 * @param {object} [p.stored]           the stored row: paid flags, paid amounts and dates
 * @param {boolean} [p.pastLocked]      the stay has started and the fiche is not unlocked
 * @param {function} [p.evaluate]       (customPrice) → quote, the whole engine (rule 18)
 * @returns {{ok:false, reason:string, refund?:object} | {ok:true, amount:number, reached:number, effects:string[], formPatch:object}}
 */
function evaluateLedgerEdit({ row, amount, quote, ledger, stored = {}, pastLocked = false, evaluate } = {}) {
  const value = parseAmount(amount);
  if (value == null) return refuse('Montant illisible : chiffres, virgule, + et − seulement.');
  if (value < 0) return refuse('Un montant ne peut pas être négatif.');
  const rows = (ledger && ledger.rows) || [];
  const depositRow = rows.find((r) => r.key === 'deposit') || {};
  const balanceRow = rows.find((r) => r.key === 'balance') || {};
  const H = round2(quote.accommodationPreArrival);
  const P = round2(quote.preArrivalAmount);
  const T = round2(P - H);
  const depositNow = round2(quote.depositAmount);
  const balanceNow = round2(quote.balanceAmount);

  if (row === 'deposit') {
    const mode = depositRow.amountEdit && depositRow.amountEdit.mode;
    if (mode === 'paid') return paidRefusal(round2(stored.depositAmount), value);
    if (mode === 'locked') return refuse(depositRow.amountEdit.reason);
    if (mode !== 'amount') return refuse('Pas d\'acompte sur cette réservation.');
    if (value > H + 0.004) {
      return refuse(`L'acompte ne dépasse pas l'hébergement (${formatEuros(H)}) : la taxe de séjour reste sur le solde.`);
    }
    const nextBalance = round2(P - value);
    return {
      ok: true, amount: value, reached: value,
      effects: value === depositNow ? [] : [`Solde : ${formatEuros(balanceNow)} → ${formatEuros(nextBalance)}`],
      formPatch: { depositAmountOverride: value, ledgerAmountEdit: 'deposit' },
    };
  }

  if (row !== 'balance') return refuse('Ce montant ne se règle pas ici.');
  const mode = balanceRow.amountEdit && balanceRow.amountEdit.mode;
  if (mode === 'paid') return paidRefusal(round2(stored.balanceAmount), value);
  if (mode === 'statement') return refuse('Le versement se règle par le relevé de la plateforme.');
  if (mode === 'split') {
    if (value < T - 0.004) return refuse(`Le solde porte la taxe de séjour (${formatEuros(T)}) : pas en dessous.`);
    if (value > P + 0.004) return refuse(`Au-delà du séjour (${formatEuros(P)}) : modifier le prix de l'hébergement.`);
    const nextDeposit = round2(P - value);
    return {
      ok: true, amount: value, reached: value,
      effects: value === balanceNow ? [] : [`Acompte : ${formatEuros(depositNow)} → ${formatEuros(nextDeposit)} · total inchangé`],
      formPatch: { depositAmountOverride: nextDeposit, ledgerAmountEdit: 'balance' },
    };
  }
  if (mode !== 'price') return refuse('Ce montant ne se règle pas ici.');
  if (pastLocked) return refuse('Séjour commencé : déverrouiller la fiche pour changer le prix de l\'hébergement.');
  if (typeof evaluate !== 'function') return refuse('Calcul impossible.');
  if (value === balanceNow) return { ok: true, amount: value, reached: value, effects: [], formPatch: {} };

  const startPrice = round2(quote.accommodationAdjustedPrice);
  const acompte = depositRow.state === 'paid' || depositRow.state === 'paid-group' ? round2(stored.depositAmount) : 0;
  const minPrice = floorPrice({ evaluate, startPrice, acompte });
  const floorQuote = evaluate(minPrice);
  const floorBalance = round2(floorQuote.balanceAmount);
  if (value < floorBalance - 0.004) {
    return refuse(acompte > 0
      ? `Pas en dessous de ${formatEuros(floorBalance)} : l'acompte perçu (${formatEuros(acompte)}) couvre déjà l'hébergement.`
      : `Pas en dessous de ${formatEuros(floorBalance)} : l'hébergement ne descend pas sous 0 €.`);
  }
  const price = solveBalance({ evaluate, startPrice, target: value, minPrice });
  const after = evaluate(price);
  const reached = round2(after.balanceAmount);
  const effects = [];
  const taxBefore = round2(quote.touristTaxTotal);
  const taxAfter = round2(after.touristTaxTotal);
  effects.push(`Hébergement : ${formatEuros(startPrice)} → ${formatEuros(price)}`
    + (taxBefore !== taxAfter ? ` · taxe de séjour ${formatEuros(taxBefore)} → ${formatEuros(taxAfter)}` : ''));
  // The options priced on the stay follow the accommodation (the cancellation insurance).
  const totalsOf = (q) => new Map((q.optionLines || []).map((l) => [String(l.optionId ?? l.title), l]));
  const beforeLines = totalsOf(quote);
  for (const [key, line] of totalsOf(after)) {
    const prev = beforeLines.get(key);
    if (prev && round2(prev.totalPrice) !== round2(line.totalPrice)) {
      effects.push(`${line.title} : ${formatEuros(prev.totalPrice)} → ${formatEuros(line.totalPrice)}`);
    }
  }
  if (toCents(reached) !== toCents(value)) {
    effects.push(`Solde obtenu : ${formatEuros(reached)} (au centime près, la taxe suit l'hébergement)`);
  }
  return {
    ok: true, amount: value, reached, effects,
    formPatch: { customPrice: price, ledgerAmountEdit: 'balance' },
  };
}

module.exports = { evaluateLedgerEdit, parseAmount, solveBalance, floorPrice };
