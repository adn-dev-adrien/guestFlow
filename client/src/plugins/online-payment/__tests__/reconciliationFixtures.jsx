// Shared fixtures of the bank reconciliation suites (specs/qonto-bank-reconciliation.md §6). A sibling
// non-test module; `vi.mock('../../../api')` stays in each test file (Vitest hoists it per file).
// Fictional data only.

export const bankSide = (over = {}) => ({
  transactionId: 'tx-1', amountCents: 59658, date: '2026-11-12', dateLabel: '12/11',
  counterparty: 'Booking.com B.V.', reference: 'NO.Xk29/ID.00000001', ...over,
});

export const item = (over = {}) => ({
  key: '7|balance',
  reservation: { id: 7, clientName: 'Luca Rossi', propertyName: 'Estiva', platform: 'Booking', platformDisplay: 'Booking', reservationNumber: '1234567890' },
  ledgerKey: 'balance', label: 'Versement Booking', channel: 'platform:Booking',
  expectedCents: 59658, expectedDateLabel: '18/11', paid: false, paidDate: null,
  state: 'waiting', stateLabel: 'Attendu', tone: 'neutral', isGap: false, gapCents: 0, receivedCents: 0,
  fixText: null, bank: [], proposal: null, alternatives: [], canUndo: false, ...over,
});

export const proposed = (over = {}) => item({
  state: 'proposed', stateLabel: 'À confirmer', tone: 'info',
  proposal: {
    id: 'tx-1:7|balance', confidence: 'sur', confidenceLabel: 'sûr', reason: 'Seul versement Booking de ce montant', source: 'platform',
    allocations: [{ reservationId: 7, ledgerKey: 'balance', amountCents: 59658 }], amountCents: 59658, bank: bankSide(), alsoCovers: [],
  },
  ...over,
});

export const gap = (over = {}) => item({
  state: 'amount_gap', stateLabel: 'Écart de montant', tone: 'error', isGap: true, paid: true, paidDate: '2026-11-12',
  bank: [{ ...bankSide({ amountCents: 110394 }), allocatedCents: 110394 }], receivedCents: 110394, gapCents: 100000,
  fixText: 'Le virement fait 1 103,94 €, la fiche attend 103,94 €. Corriger le montant sur la fiche.', canUndo: true, ...over,
});

export const done = (over = {}) => item({
  state: 'reconciled', stateLabel: 'Rapproché', tone: 'success', paid: true, paidDate: '2026-11-12',
  bank: [{ ...bankSide(), allocatedCents: 59658 }], receivedCents: 59658, canUndo: true, ...over,
});

export const COUNTS = { todo: 3, gaps: 1, proposed: 1, unmatched: 1, reconciled: 1, waiting: 1, other: 1 };

export const credit = (over = {}) => ({
  transactionId: 'tx-9', amountCents: 21450, remainingCents: 21450, date: '2026-10-21', dateLabel: '21/10',
  counterparty: 'Booking.com B.V.', reference: 'NO.Pq71/ID.00000002', currency: 'EUR', status: 'unmatched', kind: 'platform', platform: 'Booking',
  note: 'Versement attendu d\'une plateforme qu\'aucune fiche ne réclame : fiche manquante ou montant mal saisi.', ...over,
});
