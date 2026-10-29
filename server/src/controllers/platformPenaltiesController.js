/**
 * Platform penalties — declare, preview, list, remove (specs/reconciliation-assisted-matching.md rules
 * 23–31). An amount a platform keeps on a stay's payout for a reason other than its commission or the
 * tourist tax (host cancellation, relocation costs, non-compliance…).
 *
 * The one question the server must answer is whether the payout recorded on the fiche is the platform's
 * statement figure (before the penalty) or the bank amount (after it). In the second case the penalty is
 * added back to the payout so the commission drops by the same amount instead of swallowing the penalty
 * (`computePlatformCommission`, unchanged). Strict like all money: every guard refuses in words, a write
 * is one transaction, nothing is estimated on the client.
 *
 * Handlers (mounted by routes/reservations.js): list, preview, declare, remove. Every dependency is
 * injected so the whole behaviour is testable on an in-memory database.
 */

const { isDirectChannel } = require('../utils/platformNameFormat');
const { computePlatformCommission } = require('../utils/platformCommission');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const cents = (n) => Math.round((Number(n) || 0) * 100);
const present = (v) => v !== '' && v != null && Number.isFinite(Number(v));
const eur = (n) => `${round2(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
const frDay = (iso) => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthName = (iso) => MONTHS[Number(String(iso).slice(5, 7)) - 1];
const SUGGESTIONS = Object.freeze(['Frais d’annulation hôte', 'Frais de relogement', 'Non-conformité']);
const REASON_MIN = 3;
const REASON_MAX = 120;

const fail = (status, code, message, field = null) => ({ status, body: { error: message, code, ...(field ? { field } : {}) } });

/** What the acompte the platform already paid out is worth net of its commission (rule 46 of the reconciliation). */
const acompteNetOf = (row) => (Number(row.depositDisabled || 0) === 1 || !(Number(row.depositAmount || 0) > 0)
  ? 0 : Math.max(0, round2(Number(row.depositAmount) - Number(row.acompteCommissionAmount || 0))));

const grossOf = (row) => (present(row.platformGrossAmount) ? Number(row.platformGrossAmount) : round2(Number(row.depositAmount || 0) + Number(row.balanceAmount || 0)));

function buildController({ database, penaltiesModel, reservationsModel, todayOf, emit = () => {} }) {
  const stay = (id) => database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));

  /** Rule 23 — only a stay settled by a platform, and not a cancelled one. */
  function scopeRefusal(row) {
    if (!row) return fail(404, 'NOT_FOUND', 'Réservation introuvable.');
    if (isDirectChannel(row.platform)) {
      return fail(422, 'PENALTY_NOT_PLATFORM', 'Une pénalité ne se déclare que sur un séjour réglé par une plateforme.');
    }
    if (row.kind === 'cancelled') return fail(409, 'PENALTY_CANCELLED', 'Ce séjour est annulé : aucune pénalité ne peut y être déclarée.');
    return null;
  }

  /**
   * Rules 24–26, 29 — what a declaration would do, or why it is refused. Pure over the row and the body.
   * @returns {{ refusal?: object, errors: object[], needsChoice: boolean, plan?: object, before?: object, after?: object, warnings: string[] }}
   */
  function evaluate(row, body = {}) {
    const refusal = scopeRefusal(row);
    if (refusal) return { refusal, errors: [], needsChoice: false, warnings: [] };
    const errors = [];
    const today = todayOf();
    const existingCents = cents(row.platformPenaltyAmount);

    const amount = Number(body.amount);
    const amountCents = cents(amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push({ code: 'INVALID_PENALTY', field: 'amount', message: 'Le montant doit être supérieur à 0.' });
    else if (Math.abs(amount * 100 - amountCents) > 1e-6) errors.push({ code: 'INVALID_PENALTY', field: 'amount', message: 'Le montant a deux décimales au plus.' });

    const reason = String(body.reason == null ? '' : body.reason).trim().replace(/\s+/g, ' ');
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
      errors.push({ code: 'INVALID_PENALTY', field: 'reason', message: `Le motif fait entre ${REASON_MIN} et ${REASON_MAX} caractères.` });
    }

    const defaultDate = Number(row.balancePaid || 0) === 1 && /^\d{4}-\d{2}-\d{2}/.test(String(row.balancePaidDate || '')) ? String(row.balancePaidDate).slice(0, 10) : today;
    const date = body.date ? String(body.date).slice(0, 10) : defaultDate;
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    if (!validDate) errors.push({ code: 'INVALID_PENALTY', field: 'date', message: 'Date invalide.' });
    else if (date > today) errors.push({ code: 'INVALID_PENALTY', field: 'date', message: 'La date ne peut pas être dans le futur.' });

    const payoutRecorded = present(row.platformPayoutAmount) && Number(row.platformPayoutAmount) > 0;
    const source = body.source === 'reconciliation' ? 'reconciliation' : 'fiche';
    const payout = payoutRecorded ? round2(row.platformPayoutAmount) : null;
    const needsChoice = payoutRecorded && source === 'fiche' && typeof body.payoutIncludesPenalty !== 'boolean';
    if (needsChoice) {
      errors.push({ code: 'INVALID_PENALTY', field: 'payoutIncludesPenalty', message: 'Indiquer si le versement saisi est le montant du relevé ou le montant reçu sur le compte.' });
    }
    const adjusts = payoutRecorded && source === 'fiche' && body.payoutIncludesPenalty === true;

    const gross = grossOf(row);
    const tax = Math.max(0, Number(row.platformTouristTaxAmount) || 0);
    const acompteCommission = Number(row.acompteCommissionAmount) || 0;
    const acompteNet = acompteNetOf(row);
    const commission = present(row.platformCommissionAmount) ? round2(row.platformCommissionAmount) : null;

    const newPayout = adjusts && payout != null && amountCents > 0 ? round2(payout + amountCents / 100) : payout;
    let newCommission = commission;
    if (adjusts && newPayout != null && amountCents > 0) {
      const raw = round2(gross - newPayout - tax - acompteCommission);
      if (raw < 0) {
        errors.push({ code: 'COMMISSION_NEGATIVE', field: 'amount', message: 'Le versement du relevé dépasserait le total facturé : la commission deviendrait négative.' });
      } else newCommission = computePlatformCommission({ gross, payout: newPayout, touristTax: row.platformTouristTaxAmount, acompteCommission });
    }

    // Rule 26 — the penalties together cannot exceed what the platform pays out for the solde.
    const statementPayout = payoutRecorded ? newPayout : round2(gross - (commission || 0) - acompteCommission - tax);
    const cap = Math.max(0, round2(statementPayout - acompteNet));
    if (amountCents > 0 && existingCents + amountCents > cents(cap)) {
      errors.push({ code: 'PENALTY_EXCEEDS_PAYOUT', field: 'amount', message: `Les pénalités dépassent le versement de la plateforme (${eur(cap)}).` });
    }

    const bankAmount = (statementPayout2, penalties) => (statementPayout2 == null ? null : round2(statementPayout2 - acompteNet - penalties));
    const penaltiesBefore = existingCents / 100;
    const penaltiesAfter = (existingCents + (amountCents > 0 ? amountCents : 0)) / 100;
    const before = { payout, commission, netReceived: bankAmount(payout, penaltiesBefore) };
    const after = { payout: newPayout, commission: newCommission, netReceived: bankAmount(newPayout, penaltiesAfter) };

    const warnings = [];
    const currentMonth = today.slice(0, 7);
    const changedMonths = new Set();
    if (validDate && date.slice(0, 7) < currentMonth) changedMonths.add(date);
    if (adjusts && Number(row.balancePaid || 0) === 1 && String(row.balancePaidDate || '').slice(0, 7) < currentMonth) changedMonths.add(String(row.balancePaidDate).slice(0, 10));
    changedMonths.forEach((d) => warnings.push(`L’écriture de ${monthName(d)} change : si ${monthName(d)} est déjà transmis, prévenir le comptable.`));

    return {
      errors, needsChoice, warnings, before, after,
      plan: { amountCents, reason, date, source, adjusts, payout, newPayout, commission, newCommission },
    };
  }

  const previewBody = (result) => ({
    valid: result.errors.length === 0,
    needsChoice: result.needsChoice,
    before: result.before,
    after: result.after,
    warnings: result.warnings,
    errors: result.errors,
  });

  return {
    /** GET /:id/platform-penalties — the lines, the total, whether one can be declared. */
    list(reservationId) {
      const row = stay(reservationId);
      if (!row) return fail(404, 'NOT_FOUND', 'Réservation introuvable.');
      const refusal = scopeRefusal(row);
      return {
        status: 200,
        body: {
          items: penaltiesModel.listFor(reservationId).map((p) => ({
            id: p.id, amount: p.amount, reason: p.reason, date: p.date, dateLabel: frDay(p.date), payoutAdjusted: p.payoutAdjustedFrom != null,
          })),
          total: round2(row.platformPenaltyAmount),
          canDeclare: !refusal,
          suggestions: SUGGESTIONS,
        },
      };
    },

    /** POST /:id/platform-penalties/preview — never writes. */
    preview(reservationId, body) {
      const result = evaluate(stay(reservationId), body);
      if (result.refusal) return result.refusal;
      return { status: 200, body: previewBody(result) };
    },

    /** POST /:id/platform-penalties — the line, the payout adjustment and the history entry, all or nothing. */
    declare(reservationId, body, user) {
      const row = stay(reservationId);
      const result = evaluate(row, body);
      if (result.refusal) return result.refusal;
      if (result.errors.length > 0) {
        const [first] = result.errors;
        return { status: 422, body: { error: first.message, code: first.code, field: first.field, errors: result.errors } };
      }
      const { plan } = result;
      let id;
      database.transaction(() => {
        id = penaltiesModel.insert({
          reservationId, amountCents: plan.amountCents, reason: plan.reason, date: plan.date, source: plan.source,
          payoutAdjustedFrom: plan.adjusts ? plan.payout : null, payoutAdjustedTo: plan.adjusts ? plan.newPayout : null,
          commissionAdjustedFrom: plan.adjusts ? plan.commission : null, commissionAdjustedTo: plan.adjusts ? plan.newCommission : null,
          createdBy: user && user.id ? user.id : null,
        });
        if (plan.adjusts) {
          reservationsModel.updatePaymentField(
            "UPDATE reservations SET platformPayoutAmount = ?, platformCommissionAmount = ?, updatedAt = datetime('now') WHERE id = ?",
            plan.newPayout, plan.newCommission, Number(reservationId),
          );
        }
        reservationsModel.addHistoryEntry(Number(reservationId), 'update', [{
          field: 'platformPenalty', label: 'Pénalité plateforme', from: null, to: `${eur(plan.amountCents / 100)} · ${plan.reason}`,
        }]);
      }).immediate();
      emit('platform-penalty.changed', { reservationId: Number(reservationId) });
      const after = stay(reservationId);
      return {
        status: 201,
        body: {
          item: { id, amount: plan.amountCents / 100, reason: plan.reason, date: plan.date, dateLabel: frDay(plan.date), payoutAdjusted: plan.adjusts },
          reservation: {
            platformPayoutAmount: after.platformPayoutAmount, platformCommissionAmount: after.platformCommissionAmount, platformPenaltyAmount: round2(after.platformPenaltyAmount),
          },
          warnings: result.warnings,
        },
      };
    },

    /** DELETE /:id/platform-penalties/:penaltyId — rule 30. */
    remove(reservationId, penaltyId) {
      const row = stay(reservationId);
      if (!row) return fail(404, 'NOT_FOUND', 'Réservation introuvable.');
      const penalty = penaltiesModel.findById(penaltyId);
      if (!penalty || penalty.reservationId !== Number(reservationId)) return fail(404, 'NOT_FOUND', 'Pénalité introuvable.');
      let restored = false;
      let moved = false;
      database.transaction(() => {
        if (penalty.payoutAdjustedFrom != null) {
          const unchanged = present(row.platformPayoutAmount) && round2(row.platformPayoutAmount) === round2(penalty.payoutAdjustedTo)
            && (penalty.commissionAdjustedTo == null ? !present(row.platformCommissionAmount) : present(row.platformCommissionAmount) && round2(row.platformCommissionAmount) === round2(penalty.commissionAdjustedTo));
          if (unchanged) {
            reservationsModel.updatePaymentField(
              "UPDATE reservations SET platformPayoutAmount = ?, platformCommissionAmount = ?, updatedAt = datetime('now') WHERE id = ?",
              penalty.payoutAdjustedFrom, penalty.commissionAdjustedFrom, Number(reservationId),
            );
            restored = true;
          } else moved = true;
        }
        penaltiesModel.remove(penaltyId);
        reservationsModel.addHistoryEntry(Number(reservationId), 'update', [{
          field: 'platformPenalty', label: 'Pénalité plateforme', from: `${eur(penalty.amount)} · ${penalty.reason}`, to: 'supprimée',
        }]);
      }).immediate();
      emit('platform-penalty.changed', { reservationId: Number(reservationId) });
      return {
        status: 200,
        body: { ok: true, payoutRestored: restored, ...(moved ? { message: 'Versement modifié depuis : vérifier la commission à la main.' } : {}) },
      };
    },
  };
}

let bound = null;
function bind() {
  if (bound) return bound;
  const database = require('../database');
  bound = buildController({
    database,
    penaltiesModel: require('../models/platformPenaltiesModel'),
    reservationsModel: require('../models/reservationsModel'),
    todayOf: require('../utils/localDate').todayIso,
    emit: require('../plugins/sdk/eventBus').emit,
  });
  return bound;
}
const delegate = (name) => (...args) => bind()[name](...args);

module.exports = {
  buildController, SUGGESTIONS,
  list: delegate('list'), preview: delegate('preview'), declare: delegate('declare'), remove: delegate('remove'),
};
