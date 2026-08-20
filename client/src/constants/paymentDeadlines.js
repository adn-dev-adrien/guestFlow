/**
 * Payment-deadline card copy (specs/payment-schedule-and-cancellation.md §3.4 / §6).
 *
 * Presentation only: the server decides the state, the amounts, the days late and which actions are
 * available. Here we map a state to the French words and the colour that carry it.
 */

export const DEADLINE_STATE_LABELS = {
  // Nobody has asked the guest yet — the row is a to-do, not a debt
  // (specs/payment-schedule-and-cancellation.md §1 amendment).
  deposit_to_request: 'Acompte à demander',
  balance_to_request: 'Solde à demander',
  deposit_overdue: 'Acompte en retard',
  balance_overdue: 'Solde en retard',
  cancel_due: 'Solde impayé',
  unpaid_at_arrival: 'Arrivée non réglée',
  // specs/platform-payout-due-date.md — the platform's transfer, not the guest's money.
  platform_payout_overdue: 'Virement plateforme',
  // …and the booking where even the amount is unknown: a hole in the books, not a debt.
  platform_amount_missing: 'Montant manquant',
};

export const DEADLINE_STATE_BADGE = {
  deposit_to_request: 'info',
  balance_to_request: 'warning',
  deposit_overdue: 'warning',
  balance_overdue: 'warning',
  cancel_due: 'error',
  unpaid_at_arrival: 'error',
  platform_payout_overdue: 'warning',
  platform_amount_missing: 'warning',
};

/** The one-line explanation under the client name — what is late, and by how much. */
export function deadlineHeadline(row) {
  const days = Number(row.daysLate || 0);
  const late = days <= 0 ? "aujourd'hui" : `${days} jour${days > 1 ? 's' : ''} de retard`;
  // A « à demander » row keeps showing after its deadline: the to-do is still to ask, so it says how
  // long the asking has been waiting rather than pretending the guest is late.
  const overdueSuffix = days > 0 ? ` — échéance dépassée de ${days} jour${days > 1 ? 's' : ''}` : '';
  switch (row.state) {
    case 'deposit_to_request':
      return `Acompte jamais demandé${overdueSuffix}`;
    case 'balance_to_request':
      return `Solde jamais demandé${overdueSuffix}`;
    case 'cancel_due':
      return `Solde impayé — ${late}, annulation possible`;
    case 'unpaid_at_arrival':
      return 'Le séjour commence et le règlement n’est pas complet';
    case 'balance_overdue':
      return `Solde en retard — ${late}`;
    case 'platform_payout_overdue':
      return days <= 0
        ? 'Virement plateforme attendu aujourd’hui'
        : `Virement plateforme en retard de ${days} jour${days > 1 ? 's' : ''}`;
    case 'platform_amount_missing':
      return 'Montant de la plateforme jamais saisi — ouvrez la fiche pour l’enregistrer';
    default:
      return `Acompte en retard — ${late}`;
  }
}
