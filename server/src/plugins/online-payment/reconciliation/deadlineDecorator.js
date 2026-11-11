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

const NO_ACTION = { proposalId: null, amountCents: 0 };

/** What the bank says about the first échéance still open, in the words of its state. */
function bankLineOf(item) {
  const { proposal } = item;
  if (proposal) {
    const amountCents = proposal.allocations.reduce((s, a) => s + a.amountCents, 0);
    return {
      state: 'proposed', label: `Virement trouvé : ${euros(proposal.bank.amountCents)} le ${proposal.bank.dateLabel}`,
      confidence: proposal.confidence, confidenceLabel: proposal.confidenceLabel,
      // One click only when nothing is left to judge: the others are checked on the fiche.
      proposalId: proposal.confidence === 'sur' && !proposal.needsShares ? proposal.id : null, amountCents,
    };
  }
  const last = item.bank[item.bank.length - 1];
  if (item.state === 'received_not_recorded' && last) return { state: 'received', label: `Virement arrivé le ${last.dateLabel} : marquer reçu sur la fiche`, ...NO_ACTION };
  if (item.state === 'partial') return { state: 'partial', label: `Reçu en partie : ${euros(item.receivedCents)} sur ${euros(item.expectedCents)}`, ...NO_ACTION };
  if (item.state === 'amount_gap' && last) return { state: 'gap', label: `Virement de ${euros(item.receivedCents)} le ${last.dateLabel}, la fiche attend ${euros(item.expectedCents)}`, ...NO_ACTION };
  return { state: 'nothing', label: 'Rien sur le compte', ...NO_ACTION };
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
    out.push({ ...row, bank: bankLineOf(open[0]) });
    return out;
  }, []);
}

module.exports = { decorateRows };
