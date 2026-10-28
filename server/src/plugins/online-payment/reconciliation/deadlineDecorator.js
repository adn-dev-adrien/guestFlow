/**
 * The home's « Échéances » card, told what the bank says (specs/reconciliation-assisted-matching.md rule 22).
 *
 * Pure: the card's rows × the reconciliation's items → the rows, each overdue one with a `bank` line —
 * a transfer found (with the proposal to confirm), nothing on the account — and the rows whose échéance
 * was reconciled since the card was computed dropped. Rows the card does not ask money for (« to
 * request », an amount still to type) are left as they are.
 */

const { euros } = require('./receiptStates');

const OVERDUE = new Set(['deposit_overdue', 'balance_overdue', 'cancel_due', 'unpaid_at_arrival', 'platform_payout_overdue', 'installment_overdue']);

const isInstallment = (item) => String(item.ledgerKey).startsWith('installment-');

/** The receipts a row is late on, earliest first. */
function receiptsOf(row, items) {
  const mine = items.filter((i) => i.reservation.id === row.reservationId);
  const keys = [];
  if (row.state === 'installment_overdue' || (row.installmentsDue || 0) > 0) {
    return mine.filter(isInstallment).filter((i) => i.state !== 'reconciled').slice(0, Math.max(1, row.installmentsDue || 1));
  }
  if (row.depositDue > 0) keys.push('deposit');
  if (row.balanceDue > 0 || row.state === 'platform_payout_overdue') keys.push('balance');
  return keys.map((k) => mine.find((i) => i.ledgerKey === k)).filter(Boolean);
}

/**
 * @param {object[]} rows   the card's rows
 * @param {object[]} items  the controller's receipt items (`state`, `proposal`, `reservation`, `ledgerKey`)
 */
function decorateRows(rows, items) {
  return rows.reduce((out, row) => {
    if (!OVERDUE.has(row.state)) { out.push(row); return out; }
    const late = receiptsOf(row, items);
    if (late.length === 0) { out.push(row); return out; }
    const open = late.filter((i) => i.state !== 'reconciled');
    if (open.length === 0) return out;
    const proposed = open.find((i) => i.proposal);
    if (proposed) {
      const { proposal } = proposed;
      const amountCents = proposal.allocations.reduce((s, a) => s + a.amountCents, 0);
      out.push({
        ...row,
        bank: {
          state: 'proposed', label: `Virement trouvé : ${euros(proposal.bank.amountCents)} le ${proposal.bank.dateLabel}`,
          proposalId: proposal.needsShares ? null : proposal.id, amountCents,
        },
      });
    } else {
      out.push({ ...row, bank: { state: 'nothing', label: 'Rien sur le compte', proposalId: null, amountCents: 0 } });
    }
    return out;
  }, []);
}

module.exports = { decorateRows };
