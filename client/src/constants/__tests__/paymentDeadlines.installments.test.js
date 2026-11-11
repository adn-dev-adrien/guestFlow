// specs/direct-installments.md rule 22 — an installment in arrears reads on the payment-deadline card.
import { deadlineHeadline, DEADLINE_STATE_LABELS, DEADLINE_STATE_BADGE } from '../paymentDeadlines';

test('an installment in arrears is worded, plural and singular, and drawn as a warning', () => {
  expect(DEADLINE_STATE_LABELS.installment_overdue).toBe('Échéance en retard');
  expect(DEADLINE_STATE_BADGE.installment_overdue).toBe('warning');
  expect(deadlineHeadline({ state: 'installment_overdue', daysLate: 8, installmentsDue: 2 })).toBe('2 échéances en retard — 8 jours de retard');
  expect(deadlineHeadline({ state: 'installment_overdue', daysLate: 3, installmentsDue: 1 })).toBe('Échéance en retard — 3 jours de retard');
});
