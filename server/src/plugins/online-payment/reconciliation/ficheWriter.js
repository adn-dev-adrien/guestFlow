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
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const frDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * @param {object} deps
 * @param {object} deps.model              reconciliationModel
 * @param {Function} deps.applyPaymentMark core's mark (no request)
 * @param {Function} deps.computePlatformCommission
 * @param {object} deps.reservations       core reservationsModel (getRow, addHistoryEntry, updatePaymentField)
 */
function createFicheWriter({ model, applyPaymentMark, computePlatformCommission, reservations }) {
  const history = (reservationId, label, from, to) => reservations.addHistoryEntry(reservationId, 'update',
    [{ field: 'bankReconciliation', label, from, to }]);

  return {
    /**
     * Marks the receipt received when its confirmed lines now cover it (rules 34–37).
     * @returns {{ written: boolean, reason?: string, error?: { status: number, body: object } }}
     */
    writeIfComplete({ receipt, lines, expectedBankCents, tolerance = 0, user }) {
      const fields = receipt.installmentId ? { installment: true } : BUCKET_FIELDS[receipt.ledgerKey];
      if (!fields) return { written: false, reason: 'no-bucket' };
      if (receipt.paid) return { written: false, reason: 'already-received' };
      const got = lines.reduce((s, l) => s + l.amountCents, 0);
      if (got < expectedBankCents - tolerance) return { written: false, reason: 'partial' };
      const settled = lines.map((l) => day(l.settledAt)).filter(Boolean).sort().pop();
      if (!settled) return { written: false, reason: 'no-date' };

      const before = reservations.getRow(receipt.reservationId) || {};
      // An installment is marked through its own handler (rule 38); « Défaire » cannot take it back: the
      // payment stays recorded, as a bank transfer cannot be un-received.
      const body = fields.installment
        ? { installmentId: receipt.installmentId, installmentPaidDate: settled, installmentMethod: 'transfer' }
        : { [fields.flag]: true, [fields.date]: settled };
      let payout = null;
      let commission = null;
      if (String(before.platform || 'direct').trim().toLowerCase() !== 'direct' && receipt.ledgerKey === 'balance') {
        payout = round2(got / 100);
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
        written: { paid: true, date: settled, payout, commission },
        createdBy: user && user.id ? user.id : null,
      });
      history(receipt.reservationId, 'Rapprochement bancaire', 'à percevoir', `reçu le ${frDate(settled)} (virement)`);
      return { written: true, date: settled, payout, warning: answer.body && answer.body.warning };
    },

    /**
     * Rule 38 — puts back what the confirmations of this credit wrote, unless the fiche was edited since.
     * @returns {{ restored: object[], untouched: object[] }}
     */
    restoreForTransaction({ transactionId, user }) {
      const restored = [];
      const untouched = [];
      model.ficheWritesOfTransaction(transactionId).forEach((w) => {
        const fields = BUCKET_FIELDS[w.ledgerKey];
        const row = reservations.getRow(w.reservationId);
        const edited = !row || !fields
          || Number(row[fields.flag] || 0) !== 1 || day(row[fields.date]) !== w.written.date
          || (w.written.payout != null && round2(row.platformPayoutAmount) !== round2(w.written.payout));
        if (edited) {
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
