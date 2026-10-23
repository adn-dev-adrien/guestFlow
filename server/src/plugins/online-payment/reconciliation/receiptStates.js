/**
 * The state of each expected receipt (specs/qonto-bank-reconciliation.md rules 19, 21, 22, 37) and the
 * words the page prints for it. Pure: decisions in, one state out. A proposal never clears or raises a
 * gap, except that it turns a waiting / late receipt into « À confirmer ».
 */

const GAP_STATES = Object.freeze(['amount_gap', 'received_not_recorded', 'recorded_not_received', 'late', 'date_gap']);
const MS_DAY = 24 * 60 * 60 * 1000;

const day = (v) => {
  const s = String(v == null ? '' : v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const daysUntil = (from, to) => Math.round((Date.parse(`${day(to)}T00:00:00Z`) - Date.parse(`${day(from)}T00:00:00Z`)) / MS_DAY);

const NBSP = ' ';
function euros(cents) {
  const n = Math.round(cents) / 100;
  const sign = n < 0 ? '−' : '';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)},${dec}${NBSP}€`;
}
const shortDate = (iso) => { const d = day(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : ''; };

const TONES = {
  reconciled: ['Rapproché', 'success'],
  partial: ['Reçu en partie', 'info'],
  amount_gap: ['Écart de montant', 'error'],
  received_not_recorded: ['Reçu, non saisi', 'error'],
  recorded_not_received: ['Saisi, rien sur le compte', 'error'],
  late: ['En retard', 'error'],
  date_gap: ['Date à corriger', 'warning'],
  proposed: ['À confirmer', 'info'],
  waiting: ['Attendu', 'neutral'],
};

/**
 * @param {object} p
 * @param {object} p.receipt         expected receipt (`expectedCents`, `paid`, `paidDate`, `dueDate`, `expectedDate`, `channel`)
 * @param {{ amountCents: number, settledAt: string }[]} p.lines  confirmed reconciliations of this receipt
 * @param {boolean} p.hasProposal
 * @param {string} p.today
 * @param {(cents: number) => number} [p.netOf]  the acquirer's net of a payment-link amount (rule 15)
 */
function stateOfReceipt({ receipt, lines, hasProposal, today, netOf = (c) => c }) {
  const isLink = receipt.channel === 'link';
  const expected = isLink ? netOf(receipt.expectedCents) : receipt.expectedCents;
  const tolerance = isLink ? Math.max(1, lines.length) : 0;
  const got = lines.reduce((s, l) => s + l.amountCents, 0);
  const lastSettled = lines.map((l) => day(l.settledAt)).filter(Boolean).sort().pop() || null;

  let key;
  if (lines.length > 0) {
    if (!receipt.paid && got < expected - tolerance) key = 'partial';
    else if (Math.abs(got - expected) > tolerance) key = 'amount_gap';
    else if (!receipt.paid) key = 'received_not_recorded';
    else if (lastSettled && day(receipt.paidDate) && lastSettled.slice(0, 7) !== day(receipt.paidDate).slice(0, 7)) key = 'date_gap';
    else key = 'reconciled';
  } else if (hasProposal) key = 'proposed';
  else if (receipt.paid) {
    const at = day(receipt.paidDate) || day(receipt.expectedDate);
    key = at && daysUntil(at, today) > 7 ? 'recorded_not_received' : 'waiting';
  } else {
    const due = day(receipt.dueDate);
    key = due && daysUntil(due, today) > 7 ? 'late' : 'waiting';
  }
  const [stateLabel, tone] = TONES[key];
  return { state: key, stateLabel, tone, gapCents: got - expected, receivedCents: got, expectedBankCents: expected, lastSettled };
}

/** What to fix on the fiche, in words (rule 26), or null. */
function fixText({ state, receipt, gapCents, receivedCents, expectedBankCents, lastSettled }) {
  if (state === 'amount_gap') {
    return `Le virement fait ${euros(receivedCents)}, la fiche attend ${euros(expectedBankCents)}. ${receipt.paid ? 'Corriger le montant sur la fiche.' : ''}`.trim();
  }
  if (state === 'partial') return `${euros(receivedCents)} sur ${euros(expectedBankCents)} reçus : la fiche sera cochée quand le reste arrivera.`;
  if (state === 'received_not_recorded') return `Arrivé le ${shortDate(lastSettled)} : marquer « ${receipt.label} » reçu sur la fiche.`;
  if (state === 'date_gap') return `Perçu le ${shortDate(lastSettled)} sur le compte : corriger la date de la fiche (mois différent).`;
  if (state === 'recorded_not_received') return 'Coché reçu sur la fiche, mais aucun virement correspondant sur le compte.';
  return null;
}

const isGap = (state) => GAP_STATES.includes(state);

module.exports = { stateOfReceipt, fixText, isGap, GAP_STATES, TONES, euros, shortDate };
