/**
 * Installments controller — the plan of a direct reservation (specs/direct-installments.md §3-§4).
 *
 * Decides what the operator may do (rules 1-3, 9a, 11), applies it through the model and the pure rules of
 * `utils/installmentPlan`, and answers with the `installmentPlan` payload the fiche renders. Every
 * dependency is injected so the whole behaviour is testable on an in-memory database.
 *
 * Handlers (mounted by routes/reservations.js):
 *   put      PUT    /:id/installments                       { count } | { dates } | { amounts }
 *   remove   DELETE /:id/installments
 *   markPaid POST   /:id/installments/:installmentId/payment { paidDate, method }
 * Helpers for the rest of the core:
 *   planFor(reservationId)                the payload (fiche, ledger, responses)
 *   syncAfterSave(reservationId, quote)   rules 7, 8, 13 — inside the fiche's save transaction
 *   platformChangeRefusal(id, platform)   rule 1 — a plan with money in cannot leave the own channels
 *   retireChangedLinks(reservationId)     rule 17 — links that bill an old amount are retired and deactivated
 */

const plan = require('../utils/installmentPlan');
const { isDirectChannel } = require('../utils/platformNameFormat');
const { syncAfterTotalChange } = require('../utils/installmentSync');
const { recordInstallmentPayment } = require('../utils/installmentPayment');
const { validateCollectionDate } = require('../utils/arrivalPaymentDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { unsettledWithdrawnRefusal } = require('../utils/withdrawnPayments');

const MANUAL_METHODS = ['transfer', 'cash', 'cheque', 'card', 'other'];

const fail = (status, error, message, extra = {}) => ({ status, body: { error, message, ...extra } });

function buildController({
  database,
  installmentsModel,
  paymentLinksModel,
  quoteOf,
  providerReady = () => false,
  deactivateLinks = async () => {},
  // Resolves, or throws `{ message }` when the guest has paid that open link meanwhile.
  assertLinkNotPaid = async () => {},
  emit = () => {},
  todayOf,
}) {
  const stay = (reservationId) => database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(reservationId));

  const balanceDaysOf = (row) => {
    const property = database.prepare('SELECT balanceDaysBefore FROM properties WHERE id = ?').get(Number(row.propertyId));
    return property && property.balanceDaysBefore != null ? Number(property.balanceDaysBefore) : 30;
  };

  const contextOf = (row) => ({ today: todayOf(), startDate: row.startDate, balanceDaysBefore: balanceDaysOf(row) });

  const collected = (row) => [row.depositPaid, row.balancePaid, row.depositPaidCash, row.balancePaidCash]
    .some((flag) => Number(flag || 0) === 1);

  // Rules 1-3 — who may see the card, and who may create a plan.
  function eligibilityOf(row, rows) {
    if (!row || row.kind !== 'reservation') {
      return { eligible: false, canCreate: false, reason: 'Un devis ou une réservation annulée n’a pas d’échéancier.' };
    }
    if (!isDirectChannel(row.platform)) {
      return { eligible: false, canCreate: false, reason: 'Pas d’échéancier sur une réservation de plateforme.' };
    }
    if (rows.length > 0) return { eligible: true, canCreate: false, reason: null };
    if (collected(row)) {
      return { eligible: true, canCreate: false, reason: 'Un paiement est déjà enregistré sur ce séjour.' };
    }
    // specs/payment-link-lifecycle.md rule 63 — a payment received after a withdrawal by hand is settled first.
    const unsettled = unsettledWithdrawnRefusal(database, row.id);
    if (unsettled) return { eligible: true, canCreate: false, reason: unsettled.message };
    if (plan.maxCountFor(contextOf(row)) < plan.MIN_COUNT) {
      return { eligible: true, canCreate: false, reason: 'Trop près de l’arrivée pour étaler le paiement.' };
    }
    return { eligible: true, canCreate: true, reason: null };
  }

  function linksOf(rows) {
    const byInstallment = new Map();
    for (const row of rows) {
      const open = paymentLinksModel.findOpenForInstallment(row.id);
      if (open) byInstallment.set(row.id, open);
    }
    return byInstallment;
  }

  function planFor(reservationId) {
    const row = stay(reservationId);
    if (!row) return null;
    const rows = installmentsModel.listFor(reservationId);
    const eligibility = eligibilityOf(row, rows);
    return plan.buildPlanPayload({
      eligibility,
      rows,
      targetCents: Math.round(Number(row.installmentsTarget || 0) * 100),
      ...contextOf(row),
      linkByInstallment: linksOf(rows),
      canRequest: providerReady(),
    });
  }

  // The acompte / solde buckets of the stored row follow the plan (rule 5): 0 while it exists, the usual
  // split again once it is gone. Read from the engine, which knows both states.
  function restampBuckets(reservationId) {
    const row = stay(reservationId);
    const quote = quoteOf(row);
    if (!quote || quote.error) return;
    database.prepare(`
      UPDATE reservations
         SET depositAmount = ?, balanceAmount = ?, depositDueDate = ?, balanceDueDate = ?, updatedAt = datetime('now')
       WHERE id = ?`).run(quote.depositAmount, quote.balanceAmount, quote.depositDueDate || null, quote.balanceDueDate || null, Number(reservationId));
  }

  async function retireLinksOf(reservationId, installmentIds) {
    const retired = [];
    for (const installmentId of installmentIds) {
      retired.push(...paymentLinksModel.retireForAmountChange(reservationId, 'installment', -1, installmentId));
    }
    if (retired.length === 0) return;
    try { await deactivateLinks(retired); } catch { /* the marker stays: the poll retries */ }
  }

  // Rule 35 — the open links a change is about to abandon: refused when the guest paid one meanwhile.
  async function paidLinkRefusal(links) {
    for (const link of links) {
      try { await assertLinkNotPaid(link); } catch (err) {
        return fail(409, 'LINK_ALREADY_PAID', (err && err.message) || 'Un lien de paiement vient d’être payé : rien n’est modifié.');
      }
    }
    return null;
  }

  const openLinksOf = (reservationId, types) => paymentLinksModel.listForStay(reservationId)
    .filter((l) => l.status === 'open' && types.includes(l.type));

  // Rule 35 — the acompte / solde / full links of the stay die with the buckets they billed.
  async function retireBucketLinks(reservationId) {
    const retired = ['deposit', 'balance', 'full']
      .flatMap((type) => paymentLinksModel.retireForAmountChange(reservationId, type, -1));
    if (retired.length === 0) return;
    try { await deactivateLinks(retired); } catch { /* the marker stays: the poll retries */ }
  }

  // Rule 17 — an open link that no longer bills its installment's amount is abandoned at once; the returned
  // promise (null when there is nothing to deactivate) settles once the provider has been asked.
  function retireChangedLinks(reservationId) {
    const stale = [];
    for (const row of installmentsModel.listFor(reservationId)) {
      stale.push(...paymentLinksModel.retireForAmountChange(reservationId, 'installment', row.amountCents, row.id));
    }
    // …and the links of a plan that no longer exists, still waiting to be deactivated at the provider.
    stale.push(...paymentLinksModel.listRemoteCancelPending()
      .filter((l) => l.type === 'installment' && Number(l.reservationId) === Number(reservationId) && !stale.some((s) => s.id === l.id)));
    if (stale.length === 0) return null;
    return Promise.resolve(deactivateLinks(stale)).catch(() => { /* the marker stays: the poll retries */ });
  }

  async function createOrResize(row, rows, count) {
    const eligibility = eligibilityOf(row, rows);
    if (!eligibility.eligible) return fail(409, 'INSTALLMENTS_NOT_ALLOWED', eligibility.reason);
    if (rows.some((r) => Number(r.paid) === 1) || collected(row)) {
      return fail(409, 'INSTALLMENTS_LOCKED', 'Un paiement est enregistré : le nombre d’échéances est figé.');
    }
    const unsettled = unsettledWithdrawnRefusal(database, row.id);
    if (unsettled) return fail(unsettled.httpStatus, unsettled.error, unsettled.message);
    const stalePaid = await paidLinkRefusal(rows.length > 0
      ? openLinksOf(row.id, ['installment'])
      : openLinksOf(row.id, ['deposit', 'balance', 'full']));
    if (stalePaid) return stalePaid;
    const context = contextOf(row);
    const max = plan.maxCountFor(context);
    if (!Number.isInteger(count) || count < plan.MIN_COUNT || count > max) {
      const text = max < plan.MIN_COUNT ? 'Trop près de l’arrivée pour étaler le paiement.' : `Entre ${plan.MIN_COUNT} et ${max} échéances.`;
      return fail(400, 'INVALID_COUNT', text);
    }
    const quote = quoteOf(row);
    if (!quote || quote.error) return fail(409, 'QUOTE_UNAVAILABLE', 'Le total du séjour est introuvable.');
    const targetCents = Math.round(Number(quote.preArrivalAmount || 0) * 100);
    const amounts = plan.splitEuros(targetCents, count);
    if (!amounts) return fail(400, 'TOTAL_TOO_LOW', `Total trop faible pour ${count} échéances.`);
    const dates = plan.defaultDates(context, count);

    installmentsModel.replacePlan(row.id, dates.map((dueDate, i) => ({ number: i + 1, dueDate, amountCents: amounts[i] })), targetCents);
    await retireLinksOf(row.id, rows.map((r) => r.id));
    if (rows.length === 0) {
      await retireBucketLinks(row.id);
      restampBuckets(row.id);
    }
    return null;
  }

  function applyDates(row, rows, dates) {
    const today = todayOf();
    const next = rows.map((r) => ({ ...r }));
    const changes = [];
    for (const item of dates) {
      const index = next.findIndex((r) => r.id === Number(item.id));
      if (index < 0) return fail(404, 'INSTALLMENT_NOT_FOUND', 'Échéance introuvable.');
      if (Number(next[index].paid) === 1) return fail(400, 'INSTALLMENT_PAID', `Échéance ${next[index].number} : déjà payée.`, { installmentId: next[index].id });
      const message = plan.validateDate({ installments: next, index, dueDate: item.dueDate, today, startDate: row.startDate });
      if (message) return fail(400, 'INVALID_DATE', message, { field: 'dueDate', installmentId: next[index].id });
      next[index].dueDate = item.dueDate;
      changes.push(next[index]);
    }
    database.transaction(() => {
      for (const changed of changes) installmentsModel.updateRow(changed.id, { dueDate: changed.dueDate, dateEdited: 1 });
    }).immediate();
    return null;
  }

  function applyAmounts(row, rows, amounts) {
    for (const item of amounts) {
      const current = installmentsModel.listFor(row.id);
      const index = current.findIndex((r) => r.id === Number(item.id));
      if (index < 0) return fail(404, 'INSTALLMENT_NOT_FOUND', 'Échéance introuvable.');
      // A frozen plan may sit above the stay (rule 8, drop): what is typed is shared out of what the plan
      // holds, never out of the lower total.
      const frozen = current.some((r) => Number(r.paid) === 1);
      const basis = frozen
        ? current.reduce((sum, r) => sum + r.amountCents, 0)
        : Math.round(Number(row.installmentsTarget || 0) * 100);
      const checked = plan.validateAmount({ installments: current, index, amountEuros: item.amount, targetCents: basis });
      if (checked.error) return fail(400, 'INVALID_AMOUNT', checked.error, { field: 'amount', installmentId: current[index].id });
      const shares = plan.spreadCents(checked.rest, checked.others.length, { minLast: plan.MIN_SHARE_CENTS });
      database.transaction(() => {
        installmentsModel.updateRow(current[index].id, { amountCents: checked.cents, amountEdited: 1 });
        installmentsModel.applyAmounts(row.id, new Map(checked.others.map((o, k) => [o.number, shares[k]])), {});
      }).immediate();
    }
    return null;
  }

  async function put(req, res) {
    const id = Number(req.params.id);
    const row = stay(id);
    if (!row) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' });
    const rows = installmentsModel.listFor(id);
    const body = req.body || {};
    let refusal;
    if (body.count !== undefined) refusal = await createOrResize(row, rows, Number(body.count));
    else if (Array.isArray(body.dates) || Array.isArray(body.amounts)) {
      const eligibility = eligibilityOf(row, rows);
      if (!eligibility.eligible || rows.length === 0) return res.status(409).json({ error: 'INSTALLMENTS_NOT_ALLOWED', message: eligibility.reason || 'Pas d’échéancier sur cette réservation.' });
      refusal = Array.isArray(body.dates) ? applyDates(row, rows, body.dates) : applyAmounts(row, rows, body.amounts);
      if (!refusal && Array.isArray(body.amounts)) await retireChangedLinks(id);
    } else {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Nombre, dates ou montants attendus.' });
    }
    if (refusal) return res.status(refusal.status).json(refusal.body);
    return res.json({ installmentPlan: planFor(id) });
  }

  async function remove(req, res) {
    const id = Number(req.params.id);
    const row = stay(id);
    if (!row) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' });
    const rows = installmentsModel.listFor(id);
    if (rows.length === 0) return res.json({ installmentPlan: planFor(id) });
    if (rows.some((r) => Number(r.paid) === 1)) {
      return res.status(409).json({ error: 'INSTALLMENTS_LOCKED', message: 'Un paiement est enregistré : l’échéancier ne peut plus être supprimé.' });
    }
    const stalePaid = await paidLinkRefusal(openLinksOf(id, ['installment']));
    if (stalePaid) return res.status(stalePaid.status).json(stalePaid.body);
    installmentsModel.deletePlan(id);
    await retireLinksOf(id, rows.map((r) => r.id));
    restampBuckets(id);
    return res.json({ installmentPlan: planFor(id) });
  }

  function markPaid(req, res) {
    const id = Number(req.params.id);
    const installmentId = Number(req.params.installmentId);
    const row = stay(id);
    const installment = installmentsModel.findById(installmentId);
    if (!row || !installment || installment.reservationId !== id) {
      return res.status(404).json({ error: 'INSTALLMENT_NOT_FOUND', message: 'Échéance introuvable.' });
    }
    if (row.kind !== 'reservation') return res.status(409).json({ error: 'RESERVATION_NOT_ACTIVE', message: 'Cette réservation n’est plus active.' });
    if (Number(installment.paid) === 1) return res.status(409).json({ error: 'ALREADY_PAID', message: 'Cette échéance est déjà payée. Relire la fiche.' });
    const method = String((req.body && req.body.method) || 'transfer');
    if (!MANUAL_METHODS.includes(method)) return res.status(400).json({ error: 'INVALID_METHOD', message: 'Mode de paiement invalide.' });
    const today = todayOf();
    const rawDate = req.body && req.body.paidDate;
    let paidDate = today;
    if (rawDate !== undefined && rawDate !== null && rawDate !== '') {
      const checked = validateCollectionDate(rawDate, { today, invalidReason: 'Date invalide.' });
      if (!checked.ok) return res.status(400).json({ error: checked.reason, code: 'INVALID_PAYMENT_DATE', field: 'paidDate' });
      paidDate = String(rawDate).slice(0, 10);
    }
    recordInstallmentPayment({ db: database, emit }, { installmentId, paidDate, method });
    return res.json({ installmentPlan: planFor(id) });
  }

  // Rules 7, 8, 13 — called inside the transaction of the fiche's save, once the row holds the new total.
  function syncAfterSave(reservationId, quote) {
    const rows = installmentsModel.listFor(reservationId);
    if (rows.length === 0) return;
    const row = stay(reservationId);
    if (row.kind !== 'reservation' || !isDirectChannel(row.platform)) {
      // Retired locally with the deactivation marker first: the poll deactivates them at the provider.
      for (const installment of rows) paymentLinksModel.retireForAmountChange(reservationId, 'installment', -1, installment.id);
      installmentsModel.deletePlan(reservationId);
      return;
    }
    syncAfterTotalChange(database, reservationId, {
      targetCents: Math.round(Number(quote.preArrivalAmount || 0) * 100),
      startDate: row.startDate,
    });
  }

  // Rule 1 — money already collected through the plan keeps the reservation on the own channels.
  function platformChangeRefusal(reservationId, platform) {
    if (isDirectChannel(platform)) return null;
    if (!installmentsModel.listFor(reservationId).some((r) => Number(r.paid) === 1)) return null;
    return {
      status: 409,
      body: { error: 'Une échéance est déjà payée : la réservation reste en direct.', code: 'INSTALLMENTS_LOCKED' },
    };
  }

  // Rule 22 — the unpaid installments three days past their due date, for the collection alert.
  function lateInstallments(today) {
    return installmentsModel.listLate({ cutoff: addDaysToIsoDate(today, -plan.LATE_AFTER_DAYS), today });
  }

  return { eligibilityOf, planFor, put, remove, markPaid, syncAfterSave, platformChangeRefusal, retireChangedLinks, lateInstallments };
}

// The controller bound to the application's database, built on first use so that requiring this module
// (the pricing path, the tests) never opens it.
let bound = null;
function bind() {
  if (bound) return bound;
  const database = require('../database');
  const paymentLinksModel = require('../models/paymentLinksModel');
  const paymentProviders = require('../utils/paymentProviders');
  const { quoteStoredReservation } = require('../utils/storedReservationQuote');
  bound = buildController({
    database,
    installmentsModel: require('../models/installmentsModel'),
    paymentLinksModel,
    // The stay as its fiche prices it on a save.
    quoteOf: (row) => quoteStoredReservation(database, row),
    providerReady: () => Boolean(paymentProviders.active()),
    deactivateLinks: (links) => require('../utils/paymentLinkDeactivation').deactivateAbandonedLinks(links, { paymentLinksModel }),
    assertLinkNotPaid: (link) => require('../utils/paymentLinkDeactivation').assertNotPaid(link, paymentProviders.active()),
    emit: require('../plugins/sdk/eventBus').emit,
    todayOf: require('../utils/localDate').todayIso,
  });
  return bound;
}

const delegate = (name) => (...args) => bind()[name](...args);

module.exports = {
  buildController,
  MANUAL_METHODS,
  planFor: delegate('planFor'),
  put: delegate('put'),
  remove: delegate('remove'),
  markPaid: delegate('markPaid'),
  syncAfterSave: delegate('syncAfterSave'),
  platformChangeRefusal: delegate('platformChangeRefusal'),
  retireChangedLinks: delegate('retireChangedLinks'),
  lateInstallments: delegate('lateInstallments'),
};
