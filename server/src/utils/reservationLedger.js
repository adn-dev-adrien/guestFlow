/**
 * The payments ledger of a reservation (specs/reservation-payment-ledger.md §3.1, §3.4, §3.5).
 *
 * One row per money movement, in the order money moves, each with its amount, its state in words, at
 * most one action and whether (and why not) its amount can be edited. The fiche renders the rows as
 * they come: it computes none of it (CLAUDE.md §6.0).
 *
 * Pure — no DB access. The controller hands it the stored row (paid flags, dates, caution, single
 * payment group), the live quote when the fiche is being edited (the unpaid amounts follow it, rule 7),
 * the payment links, the refund register and today.
 *
 * « Reste à percevoir » is `reservationSettlement.remainingToPay` (rule 5): the ledger adds no
 * arithmetic of its own.
 */

const { remainingToPay, platformPenalty, round2 } = require('./reservationSettlement');
const { parseGroup } = require('./arrivalPaymentGroup');
const { saleChannel } = require('./saleChannel');
const { platformDisplay } = require('./platformDisplay');
const { localIsoDate, localHourMinute } = require('./localDate');

const NBSP = ' ';

/** « 1 234,56 € » — non-breaking, so an amount never wraps. */
function formatEuros(amount) {
  const n = round2(amount);
  const sign = n < 0 ? '−' : '';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)},${dec}${NBSP}€`;
}

const isoDay = (v) => {
  const s = String(v == null ? '' : v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** « 23/08 », or « 23/08/2027 » when the year differs from the stay's (rule 4). */
function shortDate(iso, stayYear) {
  const d = isoDay(iso);
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return stayYear && y !== stayYear ? `${day}/${m}/${y}` : `${day}/${m}`;
}

const cents = (n) => Math.round(round2(n) * 100);
const flag = (v) => Number(v || 0) === 1 || v === true;

// Edge case « Devis » — the devis does not store an acompte override yet: an edit would be lost.
const DEVIS_LOCK = Object.freeze({
  editable: false, mode: 'locked', min: null, max: null,
  reason: 'Sur un devis, l\'acompte suit le pourcentage du logement : le prix se règle par « Prix hébergement ajusté ».',
});

const METHOD_LABELS = { transfer: 'virement', cash: 'espèces', internal: 'caisse interne' };

const LINK_TYPES_BY_ROW = { deposit: ['deposit'], balance: ['balance', 'full'], complement: ['complement'] };

/**
 * The link shown on a row (rule 28): the open one when there is one, else the latest.
 */
function pickLink(links, rowKey) {
  const types = LINK_TYPES_BY_ROW[rowKey];
  if (!types) return null;
  const mine = (links || []).filter((l) => types.includes(String(l.type)));
  if (mine.length === 0) return null;
  const byNewest = [...mine].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  return byNewest.find((l) => l.status === 'open') || byNewest[0];
}

// Review of #902 (L5) — a solde link and a full link can both be open (a full request, then a solde request): the
// row shows the one `pickLink` chose, and every other open link of the row, so each can be withdrawn by hand —
// and every payment of the row still to settle (rule 56).
function otherOpenLinks(links, rowKey, shown) {
  const types = LINK_TYPES_BY_ROW[rowKey] || [];
  return (links || [])
    .filter((l) => types.includes(String(l.type)) && (l.status === 'open' || unsettledPayment(l)) && (!shown || l.id !== shown.id))
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
}

// specs/payment-link-lifecycle.md rule 24 — the moment a link stops, in the operator's day and hour (the
// process runs in Europe/Paris). A sentinel or missing date (Qonto's `0001-01-01…`) is no moment.
function linkEnd(link, stayYear) {
  const ms = Date.parse(String((link && link.expiresAt) || ''));
  if (!(ms > 0)) return null;
  const at = new Date(ms);
  return `${shortDate(localIsoDate(at), stayYear)} à ${localHourMinute(at)}`;
}

const WITHDRAWN_LABELS = {
  refunded: 'Lien retiré · paiement remboursé',
  'amount-changed': 'Lien retiré · montant modifié',
  settled: 'Lien retiré · perçu autrement',
  'dates-taken': 'Lien retiré · dates prises',
  superseded: 'Lien retiré · doublon écarté',
};

function lapsedLabel(link, stayYear, providerLabel) {
  const end = link.cancelReason === 'validity' ? linkEnd(link, stayYear) : null;
  const label = end ? `Lien expiré le ${end}` : link.cancelReason === 'stay-started' ? 'Lien expiré · séjour commencé' : 'Lien expiré';
  return link.remoteCancelPendingAt ? `${label} · désactivation en attente chez ${providerLabel || 'le prestataire de paiement'}` : label;
}

const BUCKET_LINK_TYPES = new Set(['deposit', 'balance', 'full']);
// specs/payment-link-lifecycle.md rule 56 — paid after its withdrawal by hand, not settled yet.
const unsettledPayment = (link) => link.status === 'cancelled' && link.cancelReason === 'operator' && Boolean(link.paidAt);
// Review of #902 (O2, O3) — the amount in both confirmations; « Enregistrer » says what it does (a devis becomes a
// reservation; the guest is confirmed unless the nights are closed or taken) and is not offered on a read-only stay.
const CONFIRMING_LINK_TYPES = new Set(['deposit', 'full']);
function stayConfirmMessage(link, { isDevis, nightsUnavailable }) {
  const unavailable = 'sans confirmation au client : dates fermées ou prises.';
  if (isDevis) return nightsUnavailable ? `Le devis devient une réservation, ${unavailable}` : 'Le devis devient une réservation ; confirmation envoyée au client.';
  if (nightsUnavailable) return `Le montant est compté comme perçu, ${unavailable}`;
  return CONFIRMING_LINK_TYPES.has(String(link.type)) ? 'Le montant est compté comme perçu ; confirmation envoyée au client.' : 'Le montant est compté comme perçu.';
}
function settleActions(link, { readOnly, isDevis, nightsUnavailable }) {
  const amount = formatEuros(Number(link.amountCents || 0) / 100);
  return {
    linkId: Number(link.id),
    ...(readOnly ? {} : {
      stay: { label: 'Enregistrer sur le séjour', confirmTitle: `Enregistrer ${amount} sur le séjour ?`, confirmMessage: stayConfirmMessage(link, { isDevis, nightsUnavailable }), confirmLabel: 'Enregistrer' },
    }),
    refunded: { label: 'Marquer remboursé', confirmTitle: `${amount} remboursés ?`, confirmMessage: 'À confirmer une fois le remboursement fait chez le prestataire.', confirmLabel: 'Remboursé' },
  };
}

// Rule 42 — « Lien retiré le {jour} »: a link withdrawn by hand ends at its withdrawal.
function operatorLabel(link, stayYear) {
  const ms = Date.parse(String(link.expiresAt || ''));
  return ms > 0 ? `Lien retiré le ${shortDate(localIsoDate(new Date(ms)), stayYear)}` : 'Lien retiré';
}

function linkDetail(link, { stayYear, due, canRequest, canWithdraw = false, providerLabel = null, settleContext = null }) {
  if (!link) return null;
  const created = shortDate(link.createdAt, stayYear);
  const paidOn = shortDate(link.paidAt, stayYear);
  const amount = formatEuros(Number(link.amountCents || 0) / 100);
  let label;
  if (link.status === 'open') {
    const end = linkEnd(link, stayYear);
    label = `Lien envoyé le ${created} · ${amount}${end ? ` · valable jusqu'au ${end}` : ''}`;
  } else if (link.status === 'paid') {
    label = link.cancelReason === 'amount-changed'
      ? `Payé par lien le ${paidOn} (ancien montant)`
      : `Payé par lien le ${paidOn}`;
  } else if (link.status === 'expired') label = lapsedLabel(link, stayYear, providerLabel);
  else if (unsettledPayment(link)) label = `${amount} payés le ${shortDate(localIsoDate(new Date(Date.parse(link.paidAt))), stayYear)} après retrait : à traiter`;
  else if (link.cancelReason === 'operator') label = operatorLabel(link, stayYear);
  else label = WITHDRAWN_LABELS[link.cancelReason] || 'Lien retiré';
  // « Renvoyer la demande » only while the row is still due, and only once the previous link is gone
  // (rule 28): an open link is still the request, a paid one settled it. Dates taken by another stay
  // refuse any new link (specs/payment-link-lifecycle.md rule 11): nothing to offer.
  const resendable = due && canRequest && link.status !== 'open' && link.status !== 'paid'
    && link.cancelReason !== 'dates-taken' && !unsettledPayment(link)
    && ['deposit', 'balance', 'full'].includes(String(link.type));
  return {
    status: link.status,
    label,
    ...(resendable ? { resend: { type: String(link.type), label: 'Renvoyer la demande' } } : {}),
    // specs/payment-link-lifecycle.md rule 42 — an open link of a stay that is not read-only.
    ...(canWithdraw && link.status === 'open' ? {
      withdraw: {
        linkId: Number(link.id),
        label: 'Retirer le lien',
        confirmTitle: 'Retirer ce lien ?',
        confirmMessage: 'Il ne pourra plus être payé.',
        confirmLabel: 'Retirer',
      },
    } : {}),
    // Rule 56 — a payment received after a withdrawal by hand: the operator refunds it or records it on the stay.
    ...(settleContext && unsettledPayment(link) ? { settle: settleActions(link, settleContext) } : {}),
  };
}

/** Rule 4 — the due state of a row with a deadline. */
function dueState(deadline, today, stayYear, { platformPayout = false } = {}) {
  const d = isoDay(deadline);
  if (!d) return { state: 'due', tone: 'due', stateLabel: 'À percevoir' };
  if (today && d < today) return { state: 'late', tone: 'late', stateLabel: `En retard depuis le ${shortDate(d, stayYear)}` };
  return {
    state: 'due',
    tone: 'due',
    stateLabel: platformPayout ? `Attendu le ${shortDate(d, stayYear)}` : `À percevoir avant le ${shortDate(d, stayYear)}`,
  };
}

/**
 * @param {object} p
 * @param {object|null} p.row       the stored reservation row (null for a fiche not saved yet)
 * @param {object|null} p.quote     the live quote (calculate-price), or null to read the stored amounts
 * @param {object} [p.live]         the live form values the quote does not echo: platform,
 *                                  depositDisabled, platformPayoutAmount, depositAmountOverride, kind
 * @param {object[]} [p.links]      payment_links rows of the reservation
 * @param {object[]} [p.refunds]    reservation_refunds rows (with their lines)
 * @param {object} [p.overpayment]  `{ ttc, lines }` — the live trop-perçu (reservation-refunds rule 34)
 * @param {object[]} [p.midStayNotes] the settled mid-stay notes
 * @param {number} [p.cautionAmount] the effective caution (live from the property until received)
 * @param {object|null} [p.installmentPlan] the `installmentPlan` payload (specs/direct-installments.md rule 5):
 *                                  its installments REPLACE the acompte and solde rows
 * @param {object[]} [p.penalties]  the platform penalties of the stay (`{ amount, reason, date }`), drawn under the payout row
 *                                  (specs/reconciliation-assisted-matching.md rule 27)
 * @param {boolean} [p.canRequest]  a payment provider is ready (« Renvoyer la demande »)
 * @param {string|null} [p.providerLabel] the declared payment provider's name, for a deactivation still owed
 *                                  (specs/payment-link-lifecycle.md rule 24)
 * @param {boolean} [p.nightsUnavailable] the stay's nights are closed or taken today: « Enregistrer sur le séjour »
 *                                  of a payment to settle confirms nobody (specs/payment-link-lifecycle.md rule 56)
 * @param {boolean} [p.stayReadOnly] the stay the links answer for is read-only (a devis converted into a cancelled
 *                                  stay): no withdrawal, a payment to settle is refunded only (rule 56, O4)
 * @param {string} p.today          `YYYY-MM-DD`
 * @returns {{ rows: object[], remaining: number, remainingLabel: string, settled: boolean }}
 */
function buildLedger({
  row = null, quote = null, live = {}, links = [], refunds = [], overpayment = null,
  midStayNotes = [], cautionAmount = 0, canRequest = false, installmentPlan = null, today,
  storedAccommodationPreArrival = null, penalties = [], providerLabel = null, nightsUnavailable = false, stayReadOnly = false,
} = {}) {
  const r = row || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(live, k) && live[k] !== undefined;
  const platform = has('platform') ? live.platform : (r.platform || 'direct');
  const kind = has('kind') ? live.kind : (r.kind || 'reservation');
  const isDevis = kind === 'devis';
  const cancelled = kind === 'cancelled';
  const stored = Boolean(row && row.id);
  const canAct = stored && !isDevis && !cancelled;
  // A cancelled stay and a duplicate set aside are read-only: their links are never withdrawn by hand.
  const canWithdraw = stored && !cancelled && kind !== 'superseded' && !stayReadOnly;
  // Rule 56 — a payment received after a withdrawal by hand is settled on any stored stay (refund only when read-only).
  const settleContext = stored ? { readOnly: !canWithdraw, isDevis, nightsUnavailable: Boolean(nightsUnavailable) } : null;
  const stayYear = isoDay(r.startDate || (quote && quote.startDate) || live.startDate)?.slice(0, 4) || null;
  // Rule 24 — the engine's own split (specs/plugins-phase-p-productisation.md rule 45): a named
  // channel carries a platform amount and commissions; only a platform SALE drops the acompte and is
  // settled by a payout.
  const channel = saleChannel(platform);
  const isPlatform = channel.namedChannel;
  const ota = channel.platformSale;
  const platformName = platformDisplay(platform);
  const depositDisabled = flag(has('depositDisabled') ? live.depositDisabled : r.depositDisabled);
  const group = parseGroup(r.arrivalPaymentGroup);
  const inGroup = (bucket) => Boolean(group && group.buckets.includes(bucket));

  const paid = {
    deposit: !depositDisabled && (flag(r.depositPaid) || flag(r.depositPaidCash)),
    balance: flag(r.balancePaid) || flag(r.balancePaidCash),
    complement: flag(r.complementPaid) || flag(r.complementPaidCash),
    endOfStay: flag(r.endOfStayComplementPaid) || flag(r.endOfStayComplementPaidCash),
  };
  // Rule 7 — unpaid rows follow the live quote, paid rows keep what the stored row collected.
  const amountOf = (bucket, quoteField, rowField) => {
    if (paid[bucket] || !quote || quote[quoteField] == null) return round2(r[rowField]);
    return round2(quote[quoteField]);
  };
  const depositAmount = depositDisabled ? 0 : amountOf('deposit', 'depositAmount', 'depositAmount');
  const balanceAmount = amountOf('balance', 'balanceAmount', 'balanceAmount');
  const complementAmount = amountOf('complement', 'complementAmount', 'complementAmount');
  const liveEndOfStay = amountOf('endOfStay', 'endOfStayComplementTotal', 'endOfStayComplementAmount');
  // Rule 40 — while the fiche is edited, mid-stay sales the stored end-of-stay complement still owes but
  // the live quote no longer carries (their option line is gone from the fiche) stay due: the row keeps
  // the stored amount and says what « Enregistrer » would remove.
  const storedEndOfStay = round2(r.endOfStayComplementAmount);
  const droppedOnSave = Boolean(quote && stored && !paid.endOfStay && storedEndOfStay > liveEndOfStay + 0.004);
  const endOfStayAmount = droppedOnSave ? storedEndOfStay : liveEndOfStay;
  const fromQuote = (field, rowField = field) => (quote && quote[field] != null ? quote[field] : r[rowField]);
  // The engine zeroes the commissions of a direct stay; a stored row is read as stored (rule 5 parity).
  const commissionOf = (field) => round2(quote ? (isPlatform ? quote[field] : 0) : r[field]);
  const acompteCommission = commissionOf('acompteCommissionAmount');
  const soldeCommission = commissionOf('platformCommissionAmount');
  const depositDueDate = fromQuote('depositDueDate');
  const balanceDueDate = fromQuote('balanceDueDate');
  const preArrival = quote && quote.preArrivalAmount != null ? round2(quote.preArrivalAmount) : round2(depositAmount + balanceAmount);
  // Rule 16 — the stored ledger names the same ceiling the server enforces (fixed at the 2026-10-27 spec
  // review: `max` read null without a quote).
  const accommodation = quote && quote.accommodationPreArrival != null
    ? round2(quote.accommodationPreArrival)
    : (!quote && storedAccommodationPreArrival != null ? round2(storedAccommodationPreArrival) : null);
  const touristTaxOnSolde = accommodation == null ? null : round2(preArrival - accommodation);
  const platformTakesDeposit = quote && quote.platformTakesDeposit != null ? Boolean(quote.platformTakesDeposit) : depositAmount > 0;
  const overrideRaw = has('depositAmountOverride') ? live.depositAmountOverride : r.depositAmountOverride;
  const override = overrideRaw === '' || overrideRaw == null || !Number.isFinite(Number(overrideRaw)) ? null : round2(overrideRaw);

  const rows = [];
  const warn = (label) => ({ tone: 'warning', label });
  const futureWarning = (date) => (isoDay(date) && today && isoDay(date) > today ? [warn('Date future enregistrée')] : []);

  // A 0 € solde: nothing to collect — or, on a stay imported without a price, a price to enter (the
  // ledger never invents a remainder, nor a delay, out of a missing price).
  const unpriced = row != null && !(Number(r.finalPrice) > 0);
  const nothingDue = () => (unpriced
    ? { state: 'none', tone: 'muted', stateLabel: 'Prix à renseigner' }
    : { state: 'none', tone: 'muted', stateLabel: 'Rien à percevoir' });
  const paidLabel = (verb, date, origin) => `${verb} le ${shortDate(date, stayYear)}${origin ? ` · ${origin}` : ''}`;
  const undo = (confirm, confirmLabel = 'Annuler la perception') => (canAct ? { kind: 'undo', label: 'Annuler', confirm, confirmLabel } : null);
  const groupNote = (bucket) => (inGroup(bucket) ? ` Le paiement unique du ${shortDate(group.at, stayYear)} est dissous.` : '');

  const originOf = (bucket, cashFlag) => {
    if (inGroup(bucket)) return 'paiement unique';
    if (flag(cashFlag)) return 'caisse interne';
    const link = pickLink(links, bucket === 'endOfStay' ? null : bucket);
    if (link && link.status === 'paid') return 'lien de paiement';
    if (ota && (bucket === 'deposit' || bucket === 'balance')) return platformName;
    return '';
  };

  const planRows = installmentPlan && installmentPlan.installments && installmentPlan.installments.length > 0
    ? installmentPlan.installments : null;

  // ── Échéancier (specs/direct-installments.md rules 5, 8, 13, 14) ─────────
  // The plan replaces the acompte and the solde: one row per installment, then the warning when the plan
  // holds more than the stay.
  if (planRows) {
    const count = planRows.length;
    const TONES = { paid: 'done', late: 'late', requested: 'due', toRequest: 'due', upcoming: 'due' };
    for (const installment of planRows) {
      const detail = { warnings: [] };
      if (installment.clamped) detail.warnings.push(warn('Date ramenée à l\'arrivée'));
      if (installment.status === 'paid') detail.warnings.push(...futureWarning(installment.paidDate));
      rows.push({
        key: `installment-${installment.number}`,
        label: `Échéance ${installment.number}/${count}`,
        amount: installment.amount,
        state: installment.status === 'paid' ? 'paid' : installment.status === 'late' ? 'late' : 'due',
        tone: TONES[installment.status] || 'due',
        stateLabel: installment.status === 'upcoming'
          ? `À percevoir avant le ${shortDate(installment.dueDate, stayYear)}`
          : installment.status === 'late'
            ? `En retard depuis le ${shortDate(installment.dueDate, stayYear)}`
            : installment.statusLabel,
        action: null,
        amountEdit: { editable: false, mode: 'none', min: null, max: null, reason: null },
        detail: tidyDetail(detail),
        ...(installment.status === 'paid' && isoDay(installment.paidDate) ? { paidDate: isoDay(installment.paidDate) } : {}),
      });
    }
    if (installmentPlan.gap > 0) {
      rows.push({
        key: 'installmentGap', label: 'Échéancier au-dessus du séjour', amount: installmentPlan.gap, state: 'due', tone: 'warning',
        stateLabel: 'À régler : remboursement, geste commercial ou à garder',
        action: null, amountEdit: { editable: false, mode: 'none', min: null, max: null, reason: null }, detail: null,
      });
    }
  }

  // ── Acompte (rules 4, 6, 15-17, 20) ───────────────────────────────────────
  if (!planRows) {
    let notApplicable = null;
    if (ota && !platformTakesDeposit) notApplicable = `Sans objet · ${platformName} encaisse en une fois`;
    else if (depositDisabled) notApplicable = 'Sans objet · acompte désactivé';
    else if (!paid.deposit && depositAmount === 0 && override == null) notApplicable = 'Sans objet · paiement en une fois';
    if (notApplicable && !paid.deposit) {
      rows.push({
        key: 'deposit', label: 'Acompte', amount: null, state: 'na', tone: 'muted', stateLabel: notApplicable,
        action: null, amountEdit: { editable: false, mode: 'none', min: null, max: null, reason: null }, detail: null,
      });
    } else {
      const shown = pickLink(links, 'deposit');
      const link = linkDetail(shown, { stayYear, due: !paid.deposit, canRequest, canWithdraw, providerLabel, settleContext });
      const detail = { warnings: [] };
      if (link) detail.link = link;
      const others = otherOpenLinks(links, 'deposit', shown).map((l) => linkDetail(l, { stayYear, due: false, canRequest, canWithdraw, providerLabel, settleContext }));
      if (others.length > 0) detail.otherLinks = others;
      if (isPlatform && acompteCommission > 0) {
        detail.commission = `Commission ${formatEuros(acompteCommission)} · net ${formatEuros(depositAmount - acompteCommission)}`;
      }
      let base;
      if (paid.deposit) {
        const origin = originOf('deposit', r.depositPaidCash);
        const verb = cancelled ? null : 'Perçu';
        base = {
          state: inGroup('deposit') ? 'paid-group' : 'paid',
          tone: 'done',
          stateLabel: cancelled ? 'Conservé · indemnité d\'annulation' : paidLabel(verb, r.depositPaidDate, origin),
          action: undo(`Annuler la perception de l'acompte du ${shortDate(r.depositPaidDate, stayYear)} ? L'écriture comptable correspondante disparaît.${groupNote('deposit')}`),
          amountEdit: {
            editable: false, mode: 'paid', min: null, max: null,
            reason: `Acompte perçu le ${shortDate(r.depositPaidDate, stayYear)} : annuler la perception pour corriger le montant.`,
          },
        };
        detail.warnings.push(...futureWarning(r.depositPaidDate));
        // Rule 32 — stored before the guard: a 0 € acompte ticked as perceived.
        if (!(depositAmount > 0)) detail.warnings.push(warn(`Acompte de ${formatEuros(0)} marqué perçu`));
      } else {
        const due = depositAmount > 0
          ? dueState(depositDueDate, today, stayYear)
          : { state: 'none', tone: 'muted', stateLabel: 'Aucun acompte' };
        let amountEdit;
        if (cancelled) amountEdit = { editable: false, mode: 'none', min: null, max: null, reason: null };
        else if (isDevis) amountEdit = DEVIS_LOCK;
        else if (paid.balance) {
          amountEdit = { editable: false, mode: 'locked', min: null, max: null, reason: 'Solde déjà perçu : l\'acompte ne peut plus changer.' };
        } else {
          amountEdit = {
            editable: true, mode: 'amount', min: 0, max: accommodation, reason: null,
            help: accommodation == null ? null : `Entre 0 et ${formatEuros(accommodation)}.`,
            ...(override != null ? { reset: { label: 'Calcul automatique', patch: { depositAmountOverride: '' } } } : {}),
          };
        }
        base = {
          ...due,
          action: canAct && depositAmount > 0 ? { kind: 'mark', label: 'Marquer perçu', dateLabel: 'Perçu le' } : null,
          amountEdit,
        };
        if (override != null && quote && quote.autoDepositAmount != null) {
          detail.hint = `Montant fixé · calcul auto ${formatEuros(quote.autoDepositAmount)}`;
        }
        // Rule 17 — a later price drop brought the accommodation under the frozen acompte: the engine
        // clamped it, the row says so.
        if (override != null && accommodation != null && override > accommodation + 0.004) {
          detail.warnings.push(warn(`Acompte ramené à ${formatEuros(depositAmount)} : l'hébergement a baissé`));
        }
      }
      rows.push({ key: 'deposit', label: 'Acompte', amount: depositAmount, ...base, detail: tidyDetail(detail) });
    }
  }

  // ── Solde / Versement de la plateforme (rules 4, 15, 17-19, 24-26) ───────
  if (!planRows) {
    const label = ota ? `Versement ${platformName}` : 'Solde';
    const shown = pickLink(links, 'balance');
    const link = linkDetail(shown, { stayYear, due: !paid.balance, canRequest, canWithdraw, providerLabel, settleContext });
    const detail = { warnings: [] };
    if (link) detail.link = link;
    const others = otherOpenLinks(links, 'balance', shown).map((l) => linkDetail(l, { stayYear, due: false, canRequest, canWithdraw, providerLabel, settleContext }));
    if (others.length > 0) detail.otherLinks = others;
    const depositRow = rows[0];
    const depositApplies = depositRow.state !== 'na';
    let base;
    if (isPlatform) {
      const penaltyTotal = platformPenalty(r);
      if (soldeCommission > 0 || penaltyTotal > 0) {
        detail.commission = `Commission ${formatEuros(soldeCommission)} · net ${formatEuros(balanceAmount - soldeCommission - penaltyTotal)}`;
      }
      if (penalties.length > 0) {
        detail.penalties = penalties.map((p) => ({ id: p.id, label: `Pénalité plateforme −${formatEuros(p.amount)} · ${p.reason} · ${shortDate(p.date, stayYear)}` }));
      }
      const payoutRaw = has('platformPayoutAmount') ? live.platformPayoutAmount : r.platformPayoutAmount;
      const payout = payoutRaw === '' || payoutRaw == null || !Number.isFinite(Number(payoutRaw)) ? null : round2(payoutRaw);
      // Rule 26 — the reconciliation chip, on the row: the whole net the platform settles against the
      // transfer the operator typed (the same « Net perçu » the statement block used to print).
      const expectedNet = quote && quote.platformNetReceivedAmount != null
        ? round2(quote.platformNetReceivedAmount)
        : round2(preArrival - acompteCommission - soldeCommission);
      if (payout != null) {
        const gap = round2(expectedNet - payout);
        detail.reconciliation = Math.abs(gap) < 0.005
          ? { tone: 'done', label: '✓ cohérent avec le virement' }
          : { tone: 'warning', label: `écart : ${formatEuros(gap)}` };
      }
      if (paid.balance) {
        base = {
          state: 'paid', tone: 'done',
          stateLabel: paidLabel(ota ? 'Reçu' : 'Perçu', r.balancePaidDate, ota ? platformName : originOf('balance', r.balancePaidCash)),
          action: undo(`Annuler la réception du versement du ${shortDate(r.balancePaidDate, stayYear)} ? L'écriture comptable correspondante disparaît.${groupNote('balance')}`, 'Annuler le versement'),
          amountEdit: {
            editable: false, mode: 'locked', min: null, max: null,
            reason: `Versement reçu le ${shortDate(r.balancePaidDate, stayYear)} : annuler la réception pour corriger les montants.`,
          },
        };
        detail.warnings.push(...futureWarning(r.balancePaidDate));
      } else {
        base = {
          ...(balanceAmount > 0 ? dueState(balanceDueDate, today, stayYear, { platformPayout: ota }) : nothingDue()),
          action: canAct && balanceAmount > 0
            ? { kind: 'mark', label: ota ? 'Marquer reçu' : 'Marquer perçu', dateLabel: ota ? 'Reçu le' : 'Perçu le', payout: { expected: soldeCommission > 0 ? round2(balanceAmount - soldeCommission) : null } }
            : null,
          amountEdit: cancelled
            ? { editable: false, mode: 'none', min: null, max: null, reason: null }
            : { editable: true, mode: 'statement', min: null, max: null, reason: null },
        };
      }
    } else if (paid.balance) {
      base = {
        state: inGroup('balance') ? 'paid-group' : 'paid',
        tone: 'done',
        stateLabel: paidLabel('Perçu', r.balancePaidDate, originOf('balance', r.balancePaidCash)),
        action: undo(`Annuler la perception du solde du ${shortDate(r.balancePaidDate, stayYear)} ? L'écriture comptable correspondante disparaît.${groupNote('balance')}`),
        amountEdit: {
          editable: false, mode: 'paid', min: null, max: null,
          reason: `Solde perçu le ${shortDate(r.balancePaidDate, stayYear)} : montant figé.`,
        },
      };
      detail.warnings.push(...futureWarning(r.balancePaidDate));
    } else {
      const split = depositApplies && !paid.deposit;
      const due = balanceAmount > 0 ? dueState(balanceDueDate, today, stayYear) : nothingDue();
      let amountEdit;
      if (cancelled) amountEdit = { editable: false, mode: 'none', min: null, max: null, reason: null };
      else if (isDevis) amountEdit = DEVIS_LOCK;
      else if (split) {
        amountEdit = {
          editable: true, mode: 'split', min: touristTaxOnSolde, max: preArrival, reason: null,
          help: touristTaxOnSolde == null ? null : `Entre ${formatEuros(touristTaxOnSolde)} et ${formatEuros(preArrival)} ; l'acompte prend le reste.`,
        };
      } else {
        amountEdit = { editable: true, mode: 'price', min: null, max: null, reason: null, help: 'Un autre solde change le prix de l\'hébergement.' };
      }
      if (paid.deposit) detail.hint = 'Acompte perçu : modifier le solde change le prix';
      base = { ...due, action: canAct && balanceAmount > 0 ? { kind: 'mark', label: 'Marquer perçu', dateLabel: 'Perçu le' } : null, amountEdit };
    }
    // Rule 24 of the reconciliation spec — a penalty is declared where the payout is, even on a fiche whose amounts are frozen.
    const penaltyAction = isPlatform && canAct ? { label: 'Déclarer une pénalité' } : null;
    rows.push({ key: 'balance', label, amount: balanceAmount, ...base, ...(penaltyAction ? { penaltyAction } : {}), detail: tidyDetail(detail) });
  }

  const afterBuckets = rows.length;

  // ── Compléments + notes en séjour (rules 2, 22, Q5) ──────────────────────
  const deferred = flag(has('complementDeferredToCheckout') ? live.complementDeferredToCheckout : r.complementDeferredToCheckout);
  const arrivalAdjusted = r.complementAmountOverride != null && r.complementAmountOverride !== '';
  const endAdjusted = r.endOfStayComplementAmountOverride != null && r.endOfStayComplementAmountOverride !== '';
  const complementRow = ({ key, label, amount, bucket, paidFlag, cashFlag, dateField, dueLabel, slot }) => {
    const isPaid = paid[bucket];
    const detail = { warnings: [], slot };
    const link = bucket === 'complement' ? pickLink(links, 'complement') : null;
    if (link) {
      detail.link = linkDetail(link, { stayYear, due: !isPaid, canRequest: false, canWithdraw, providerLabel, settleContext });
      // Rule 31 — a retired link paid at its old amount: the operator settles the gap.
      if (link.status === 'paid' && link.cancelReason === 'amount-changed' && cents(amount) !== Number(link.amountCents || 0)) {
        detail.warnings.push(warn(`Payé ${formatEuros(Number(link.amountCents) / 100)} par un lien retiré, ${formatEuros(amount)} attendus`));
      }
    }
    let base;
    if (isPaid) {
      const name = key === 'complement' ? 'du complément d\'arrivée' : 'du complément de fin de séjour';
      const cash = flag(cashFlag);
      base = {
        state: inGroup(bucket === 'endOfStay' ? 'endOfStayComplement' : bucket) ? 'paid-group' : 'paid',
        tone: 'done',
        stateLabel: paidLabel('Perçu', r[dateField], originOf(bucket === 'endOfStay' ? 'endOfStayComplement' : bucket, cashFlag)),
        action: undo(cash
          ? `Annuler la perception ${name} du ${shortDate(r[dateField], stayYear)} (caisse interne) ?`
          : `Annuler la perception ${name} du ${shortDate(r[dateField], stayYear)} ? L'écriture comptable correspondante disparaît.`),
      };
      detail.warnings.push(...futureWarning(r[dateField]));
    } else {
      base = {
        state: 'due', tone: amount > 0 ? 'due' : 'muted', stateLabel: amount > 0 ? dueLabel : 'Rien à percevoir',
        action: canAct && amount > 0 ? { kind: 'mark', label: 'Marquer perçu', dateLabel: 'Perçu le', cash: true } : null,
      };
    }
    return {
      key, label, amount, ...base, bucket: paidFlag,
      amountEdit: cancelled
        ? { editable: false, mode: 'none', min: null, max: null, reason: null }
        : { editable: true, mode: 'complement', min: null, max: null, reason: null },
      detail: tidyDetail(detail),
    };
  };
  const mergedAmount = round2(complementAmount + endOfStayAmount);
  if (deferred && mergedAmount > 0) {
    rows.push(complementRow({
      key: 'checkoutComplement', label: 'Complément de fin de séjour', amount: mergedAmount, bucket: 'complement',
      paidFlag: 'complementPaid', cashFlag: r.complementPaidCash, dateField: 'complementPaidDate',
      dueLabel: 'À percevoir au départ', slot: 'checkoutComplement',
    }));
  } else {
    if (complementAmount > 0 || arrivalAdjusted) {
      rows.push(complementRow({
        key: 'complement', label: 'Complément d\'arrivée', amount: complementAmount, bucket: 'complement',
        paidFlag: 'complementPaid', cashFlag: r.complementPaidCash, dateField: 'complementPaidDate',
        dueLabel: 'À percevoir à l\'arrivée', slot: 'complement',
      }));
    }
  }
  const notes = Array.isArray(midStayNotes) ? midStayNotes : [];
  if (notes.length > 0) {
    const total = round2(notes.reduce((s, n) => s + (Number(n.total) || 0), 0));
    rows.push({
      key: 'midStayNotes', label: 'Notes en séjour', amount: total, state: 'paid', tone: 'done',
      stateLabel: notes.length > 1 ? `${notes.length} notes perçues` : '1 note perçue',
      action: null, amountEdit: { editable: false, mode: 'none', min: null, max: null, reason: null },
      detail: { slot: 'midStayNotes' },
    });
  }
  if (!deferred && (endOfStayAmount > 0 || endAdjusted)) {
    rows.push(complementRow({
      key: 'endOfStayComplement', label: 'Complément de fin de séjour', amount: endOfStayAmount, bucket: 'endOfStay',
      paidFlag: 'endOfStayComplementPaid', cashFlag: r.endOfStayComplementPaidCash, dateField: 'endOfStayComplementPaidDate',
      dueLabel: 'À percevoir au départ', slot: 'endOfStayComplement',
    }));
  }

  // ── Remboursements + trop-perçu ───────────────────────────────────────────
  if (overpayment && round2(overpayment.ttc) > 0) {
    rows.push({
      key: 'overpayment', label: 'Trop-perçu', amount: round2(overpayment.ttc), state: 'due', tone: 'warning',
      stateLabel: 'À rembourser',
      action: canAct ? { kind: 'refund', label: 'Rembourser' } : null,
      amountEdit: { editable: false, mode: 'none', min: null, max: null, reason: null },
      // What the refund dialog opens on, so a fiche that shows only the stored ledger still prefills it.
      refundPrefill: { overpaymentTtc: round2(overpayment.ttc), overpaymentLines: overpayment.lines || [], method: overpayment.method || null },
      detail: {
        lines: (overpayment.lines || []).filter((l) => Number(l.collectedTtc) > 0)
          .map((l) => (l.excessOnly
            ? `${l.label} : ${formatEuros(l.collectedTtc)} encaissés en trop`
            : `${l.label} : ${formatEuros(l.collectedTtc)} encaissés, ${formatEuros(l.dueTtc)} dus`)),
      },
    });
  }
  for (const refund of refunds || []) {
    const method = METHOD_LABELS[refund.method] || refund.method || '';
    rows.push({
      key: `refund-${refund.id}`, label: 'Remboursement', amount: -round2(refund.totalTtc), state: 'refunded', tone: 'info',
      stateLabel: `Rendu le ${shortDate(refund.refundDate, stayYear)}${method ? ` · ${method}` : ''}`,
      action: canAct ? { kind: 'deleteRefund', label: 'Supprimer', refundId: refund.id, confirm: 'Supprimer ce remboursement ? L\'avoir correspondant sera supprimé.' } : null,
      amountEdit: { editable: false, mode: 'none', min: null, max: null, reason: null },
      detail: {
        lines: (refund.lines || []).map((l) => `${l.label} : − ${formatEuros(l.amountTtc)}`),
        ...(refund.reason ? { note: `« ${refund.reason} »` } : {}),
      },
    });
  }

  // ── Paiements après retrait (specs/payment-link-lifecycle.md rule 63) ──────
  // A payment to settle that no row above shows — an installment plan replaces the acompte and solde rows —
  // gets a row of its own, right after the buckets, so « Marquer remboursé » stays reachable. Beside a plan, an
  // acompte / solde / séjour payment is refunded only (Adrien, 2026-10-31): the plan holds the pre-arrival money.
  if (settleContext) {
    const shown = new Set(rows.flatMap((x) => [x.detail?.link, ...(x.detail?.otherLinks || [])])
      .filter((l) => l && l.settle).map((l) => l.settle.linkId));
    const waiting = (links || []).filter((l) => unsettledPayment(l) && !shown.has(Number(l.id)))
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    if (waiting.length > 0) {
      const heldByPlan = (l) => Boolean(planRows) && BUCKET_LINK_TYPES.has(String(l.type));
      const details = waiting.map((l) => linkDetail(l, {
        stayYear, due: false, canRequest: false, canWithdraw, providerLabel,
        settleContext: heldByPlan(l) ? { ...settleContext, readOnly: true } : settleContext,
      }));
      const [first, ...rest] = details;
      rows.splice(afterBuckets, 0, {
        key: 'withdrawnPayments',
        label: waiting.length > 1 ? 'Paiements après retrait' : 'Paiement après retrait',
        amount: waiting.reduce((sum, l) => sum + Number(l.amountCents || 0), 0) / 100,
        state: 'due', tone: 'warning', stateLabel: 'À traiter',
        action: null,
        amountEdit: { editable: false, mode: 'none', min: null, max: null, reason: null },
        detail: tidyDetail({
          link: first,
          ...(rest.length > 0 ? { otherLinks: rest } : {}),
          ...(!settleContext.readOnly && waiting.some(heldByPlan) ? { note: 'Supprimer l’échéancier pour l’enregistrer sur le séjour.' } : {}),
        }),
      });
    }
  }

  // ── Caution (rules 6, 12) ─────────────────────────────────────────────────
  if (!isDevis) {
    const received = flag(r.cautionReceived);
    const returned = flag(r.cautionReturned);
    const caution = round2(cautionAmount);
    const none = { editable: false, mode: 'none', min: null, max: null, reason: null };
    if (caution <= 0 && !received && !returned) {
      rows.push({ key: 'caution', label: 'Caution', amount: null, state: 'na', tone: 'muted', stateLabel: 'Sans objet', action: null, amountEdit: none, detail: null });
    } else {
      const recvDetail = { warnings: futureWarning(r.cautionReceivedDate) };
      rows.push(received
        ? {
          key: 'cautionReceived', label: 'Caution reçue', amount: caution, state: 'paid', tone: 'done',
          stateLabel: `Reçue le ${shortDate(r.cautionReceivedDate, stayYear)}`,
          action: undo(`Annuler la réception de la caution du ${shortDate(r.cautionReceivedDate, stayYear)} ?${returned ? ' La restitution est annulée aussi.' : ''}`, 'Annuler la réception'),
          amountEdit: none, detail: tidyDetail(recvDetail),
        }
        : {
          key: 'cautionReceived', label: 'Caution reçue', amount: caution, state: 'due', tone: 'due',
          stateLabel: 'À recevoir à l\'arrivée',
          action: canAct ? { kind: 'mark', label: 'Recevoir', dateLabel: 'Reçue le' } : null,
          amountEdit: none, detail: null,
        });
      const retDetail = { warnings: futureWarning(r.cautionReturnedDate) };
      if (returned && !received) retDetail.warnings.push(warn('Restituée sans réception enregistrée'));
      if (returned) {
        rows.push({
          key: 'cautionReturned', label: 'Caution restituée', amount: caution, state: 'paid', tone: 'done',
          stateLabel: `Rendue le ${shortDate(r.cautionReturnedDate, stayYear)}`,
          action: undo(`Annuler la restitution de la caution du ${shortDate(r.cautionReturnedDate, stayYear)} ?`, 'Annuler la restitution'),
          amountEdit: none, detail: tidyDetail(retDetail),
        });
      } else if (!received) {
        rows.push({
          key: 'cautionReturned', label: 'Caution restituée', amount: caution, state: 'waiting', tone: 'muted',
          stateLabel: 'Après réception', action: null, amountEdit: none, detail: null,
        });
      } else {
        rows.push({
          key: 'cautionReturned', label: 'Caution restituée', amount: caution, state: 'due', tone: 'due',
          stateLabel: 'À rendre au départ',
          action: canAct ? { kind: 'mark', label: 'Restituer', dateLabel: 'Rendue le', after: isoDay(r.cautionReceivedDate) } : null,
          amountEdit: none, detail: null,
        });
      }
    }
  }

  if (droppedOnSave) {
    const row = rows.find((x) => x.key === 'endOfStayComplement');
    if (row) {
      const lost = round2(storedEndOfStay - liveEndOfStay);
      row.detail = { ...(row.detail || {}), warnings: [...((row.detail && row.detail.warnings) || []),
        warn(`« Enregistrer » retirerait ${formatEuros(lost)} encore dus : une prestation vendue en séjour n'est plus sur la fiche`)] };
    }
  }

  // Rule 41 — a paid row carries its date, so undoing then redoing it can propose the same day.
  const PAID_DATES = {
    deposit: r.depositPaidDate, balance: r.balancePaidDate, complement: r.complementPaidDate,
    checkoutComplement: r.complementPaidDate, endOfStayComplement: r.endOfStayComplementPaidDate,
    cautionReceived: r.cautionReceivedDate, cautionReturned: r.cautionReturnedDate,
  };
  for (const row of rows) {
    if (String(row.state).startsWith('paid') && isoDay(PAID_DATES[row.key])) row.paidDate = isoDay(PAID_DATES[row.key]);
  }

  // Rule 33 — while the fiche is edited (live quote), a row whose amount the save would change says
  // what is stored now: a mark is recorded against the stored amount, after the save.
  if (quote && stored) {
    const storedOf = {
      deposit: depositDisabled ? 0 : round2(r.depositAmount),
      balance: round2(r.balanceAmount),
      complement: round2(r.complementAmount),
      endOfStayComplement: round2(r.endOfStayComplementAmount),
      checkoutComplement: round2(Number(r.complementAmount || 0) + Number(r.endOfStayComplementAmount || 0)),
    };
    for (const row of rows) {
      if (!(row.key in storedOf) || row.amount == null || String(row.state).startsWith('paid')) continue;
      row.storedAmount = storedOf[row.key];
      if (cents(row.amount) !== cents(row.storedAmount)) {
        row.changesOnSave = true;
        row.detail = { ...(row.detail || {}), pending: `Enregistré : ${formatEuros(row.storedAmount)} · « Enregistrer » applique le nouveau montant` };
      }
    }
  }

  // ── Reste à percevoir (rule 5) ────────────────────────────────────────────
  const remaining = remainingToPay({
    ...r,
    depositDisabled: depositDisabled ? 1 : 0,
    depositAmount,
    balanceAmount,
    complementAmount,
    endOfStayComplementAmount: endOfStayAmount,
    acompteCommissionAmount: acompteCommission,
    platformCommissionAmount: soldeCommission,
  });
  return {
    rows,
    remaining,
    remainingLabel: remaining === 0 ? 'Tout est perçu' : `Reste à percevoir ${formatEuros(remaining)}`,
    closing: remaining === 0
      ? (unpriced && !(quote && Number(quote.finalPrice) > 0)
        ? { label: 'Prix à renseigner', amount: null, tone: 'muted' }
        : { label: 'Tout est perçu', amount: null, tone: 'done' })
      : { label: 'Reste à percevoir', amount: remaining, tone: 'due' },
    settled: remaining === 0,
  };
}

function tidyDetail(detail) {
  if (!detail) return null;
  const out = { ...detail };
  if (Array.isArray(out.warnings) && out.warnings.length === 0) delete out.warnings;
  return Object.keys(out).length === 0 ? null : out;
}

module.exports = { buildLedger, formatEuros, shortDate, pickLink };
