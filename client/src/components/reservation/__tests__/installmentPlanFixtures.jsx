// Shared fixture of the « last amount » suites of the échéancier card (specs/payments/direct-installments.md rules 53-60). Not a
// test file: a suite imports it, none of them re-runs another.

const installment = (number, extra = {}) => ({
  id: 40 + number, number, dueDate: `2027-0${number}-10`, amount: 300, status: 'upcoming', statusLabel: 'À venir',
  editable: true, amountEditable: true, amountEdited: true, canRelease: false, dateEdited: false, added: 0,
  paidDate: null, method: null, requestedAt: null, linkUrl: null, clamped: false, ...extra,
});

// 3 × 300 € pinned on a stay of 1 001,50 €: closed, 101,50 € left for the arrival.
export const closedPlan = (overrides = {}) => ({
  eligible: true, canCreate: false, reason: null, countLocked: false, frozen: false,
  total: 1001.5, paid: 0, remaining: 900, gap: 0, minCount: 2, maxCount: 12, count: 3, canRequest: true, arrivalDate: '2027-06-14',
  closed: true, arrivalRest: 101.5, deposit: null,
  installments: [installment(1), installment(2), installment(3, { canRelease: true })],
  ...overrides,
});
