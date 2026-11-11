/**
 * What a confirmation writes on the fiche, and how « Défaire » takes it back
 * (specs/qonto-bank-reconciliation.md rules 34–38).
 *
 * The write goes through the core's own payment mark (`applyPaymentMark`), so every guard of « Marquer
 * perçu » applies and a refusal cancels the confirmation. Only an échéance the fiche does not mark
 * received yet is written: the core refuses to mark one twice, so a receipt already marked keeps its
 * recorded date and amount, and its gap stays shown for the operator to fix on the fiche.
 */

const BUCKET_FIELDS = {
  deposit: { flag: 'depositPaid', date: 'depositPaidDate' },
  balance: { flag: 'balancePaid', date: 'balancePaidDate' },
  complement: { flag: 'complementPaid', date: 'complementPaidDate' },
  checkoutComplement: { flag: 'complementPaid', date: 'complementPaidDate' },
  endOfStayComplement: { flag: 'endOfStayComplementPaid', date: 'endOfStayComplementPaidDate' },
};

const { day } = require('./dates');
const { platformAcompteNet } = require('./expectedReceipts');
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const frDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * @param {object} deps
 * @param {object} deps.model              reconciliationModel
 * @param {Function} deps.applyPaymentMark core's mark (no request)
 * @param {Function} deps.computePlatformCommission
 * @param {object} deps.reservations       core reservationsModel (getRow, addHistoryEntry, updatePaymentField)
 * @param {object} [deps.installments]     core installmentsModel (findById, markUnpaid): « Défaire » takes an installment back
 * @param {Function} [deps.takeBackRefusal] core guard: a mark taken back never leaves book refunds above what stays collected
 */
function createFicheWriter({ model, applyPaymentMark, computePlatformCommission, reservations, installments = null, takeBackRefusal = null }) {
  const history = (reservationId, label, from, to) => reservations.addHistoryEntry(reservationId, 'update',
    [{ field: 'bankReconciliation', label, from, to }]);
  const installmentOfWrite = (w) => {
    const installment = installments ? installments.findById(w.written.installmentId) : null;
    const untouchedSince = installment && Number(installment.paid) === 1 && day(installment.paidDate) === w.written.date
      && String(installment.paidMethod) === 'transfer';
    return untouchedSince ? installment : null;
  };
  const bucketEdited = (w) => {
    const fields = BUCKET_FIELDS[w.ledgerKey];
    const row = reservations.getRow(w.reservationId);
    return !row || !fields
      || Number(row[fields.flag] || 0) !== 1 || day(row[fields.date]) !== w.written.date
      || (w.written.payout != null && round2(row.platformPayoutAmount) !== round2(w.written.payout));
  };

  return {
    /**
     * Marks the receipt received when its confirmed lines now cover it (rules 34–37). `auto` = the server
     * confirmed it alone (reconciliation-assisted-matching.md rules 20–21).
     * @returns {{ written: boolean, reason?: string, error?: { status: number, body: object } }}
     */
    writeIfComplete({ receipt, lines, expectedBankCents, tolerance = 0, user, auto = false }) {
      const fields = receipt.installmentId ? { installment: true } : BUCKET_FIELDS[receipt.ledgerKey];
      if (!fields) return { written: false, reason: 'no-bucket' };
      if (receipt.paid) return { written: false, reason: 'already-received' };
      const got = lines.reduce((s, l) => s + l.amountCents, 0);
      if (got < expectedBankCents - tolerance) return { written: false, reason: 'partial' };
      const settled = lines.map((l) => day(l.settledAt)).filter(Boolean).sort().pop();
      if (!settled) return { written: false, reason: 'no-date' };

      const before = reservations.getRow(receipt.reservationId) || {};
      // An installment is marked through its own handler (rule 38); « Défaire » takes it back through the
      // installments model (reconciliation-assisted-matching.md rule 21) while nobody touched it since.
      const body = fields.installment
        ? { installmentId: receipt.installmentId, installmentPaidDate: settled, installmentMethod: 'transfer' }
        : { [fields.flag]: true, [fields.date]: settled };
      let payout = null;
      let commission = null;
      // An automatic confirmation writes the flag and the date only (rules 20–21): never a payout, never an amount.
      // The payout and its commission are written only when the fiche carried none: a recorded payout that the credit
      // equals is never touched (review 2026-10-28), and neither is its commission.
      if (!auto && receipt.unbounded && String(before.platform || 'direct').trim().toLowerCase() !== 'direct' && receipt.ledgerKey === 'balance') {
        // Rule 46 — the credit pays the solde only when the platform took an acompte: the payout is the
        // whole stay's net, so the commission is not inflated by the acompte.
        // …and what the platform kept as a penalty (reconciliation-assisted-matching.md rule 25).
        payout = round2(got / 100 + platformAcompteNet(before) + Math.max(0, Number(before.platformPenaltyAmount || 0)));
        const gross = before.platformGrossAmount != null && before.platformGrossAmount !== ''
          ? Number(before.platformGrossAmount) : Number(before.depositAmount || 0) + Number(before.balanceAmount || 0);
        commission = computePlatformCommission({
          gross, payout, touristTax: before.platformTouristTaxAmount, acompteCommission: before.acompteCommissionAmount,
        });
        body.platformPayoutAmount = payout;
        if (commission != null) body.platformCommissionAmount = commission;
      }
      const answer = applyPaymentMark({ reservationId: receipt.reservationId, body, user });
      if (answer.status >= 400) return { written: false, reason: 'refused', error: answer };

      model.recordFicheWrite({
        reservationId: receipt.reservationId, ledgerKey: receipt.ledgerKey,
        transactionIds: [...new Set(lines.map((l) => l.transactionId))],
        prior: {
          paid: false, date: null,
          payout: before.platformPayoutAmount == null ? null : Number(before.platformPayoutAmount),
          commission: before.platformCommissionAmount == null ? null : Number(before.platformCommissionAmount),
        },
        written: { paid: true, date: settled, payout, commission, installmentId: receipt.installmentId || null },
        createdBy: user && user.id ? user.id : null,
      });
      history(receipt.reservationId, auto ? 'Rapprochement bancaire automatique' : 'Rapprochement bancaire', 'à percevoir', `reçu le ${frDate(settled)} (virement)`);
      return { written: true, date: settled, payout, warning: answer.body && answer.body.warning };
    },

    /**
     * specs/reservation-refunds.md rule 52 — what `restoreForTransaction` would take back must not leave book refunds above
     * what stays collected: the refusal, or null. Only the marks it would really touch count.
     */
    undoRefusal({ transactionId }) {
      if (!takeBackRefusal) return null;
      const byStay = new Map();
      model.ficheWritesOfTransaction(transactionId).forEach((w) => {
        const stay = byStay.get(w.reservationId) || { flags: [], installmentCents: 0 };
        if (w.written.installmentId != null) {
          const installment = installmentOfWrite(w);
          if (installment) stay.installmentCents += Number(installment.amountCents);
        } else if (!bucketEdited(w)) stay.flags.push(BUCKET_FIELDS[w.ledgerKey].flag);
        byStay.set(w.reservationId, stay);
      });
      for (const [reservationId, stay] of byStay) {
        const refusal = takeBackRefusal(reservationId, stay);
        if (refusal) return refusal;
      }
      return null;
    },

    /**
     * Rule 38 — puts back what the confirmations of this credit wrote, unless the fiche was edited since.
     * @returns {{ restored: object[], untouched: object[] }}
     */
    restoreForTransaction({ transactionId, user }) {
      const restored = [];
      const untouched = [];
      model.ficheWritesOfTransaction(transactionId).forEach((w) => {
        if (w.written.installmentId != null) {
          // An installment the confirmation marked received goes back to unpaid, unless it was touched since.
          const installment = installmentOfWrite(w);
          if (installment && installments.markUnpaid(installment.id).flipped) {
            history(w.reservationId, 'Rapprochement bancaire', `reçu le ${frDate(w.written.date)}`, 'à percevoir (rapprochement défait)');
            restored.push({ reservationId: w.reservationId, ledgerKey: w.ledgerKey });
          } else untouched.push({ reservationId: w.reservationId, ledgerKey: w.ledgerKey });
          model.deleteFicheWrite(w.id);
          return;
        }
        const fields = BUCKET_FIELDS[w.ledgerKey];
        if (bucketEdited(w)) {
          untouched.push({ reservationId: w.reservationId, ledgerKey: w.ledgerKey });
          model.deleteFicheWrite(w.id);
          return;
        }
        const answer = applyPaymentMark({ reservationId: w.reservationId, body: { [fields.flag]: false }, user });
        if (answer.status >= 400) {
          untouched.push({ reservationId: w.reservationId, ledgerKey: w.ledgerKey });
          model.deleteFicheWrite(w.id);
          return;
        }
        if (w.written.payout != null) {
          reservations.updatePaymentField(
            "UPDATE reservations SET platformPayoutAmount = ?, platformCommissionAmount = ?, updatedAt = datetime('now') WHERE id = ?",
            w.prior.payout, w.prior.commission, w.reservationId,
          );
        }
        history(w.reservationId, 'Rapprochement bancaire', `reçu le ${frDate(w.written.date)}`, 'à percevoir (rapprochement défait)');
        model.deleteFicheWrite(w.id);
        restored.push({ reservationId: w.reservationId, ledgerKey: w.ledgerKey });
      });
      return { restored, untouched };
    },
  };
}

module.exports = { createFicheWriter, BUCKET_FIELDS };
