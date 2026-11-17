import { screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { renderFinance as renderLedger, paidRow, ledgerOf } from './ledgerFixtures';

// specs/mollie-rolling-reserve-and-incoming-payments.md rules 18-19 — a paid link shows its bank tranches under the
// échéance (same drawing as an instalment plan's lines) and the recap line shows « reçus / attendus ». Everything is
// the server's wording; a fiche with nothing pending shows nothing new (rule 19).

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const TRANCHES = [
  { key: 'balance#immediat', tranche: 'immediat', label: 'Versement immédiat', amount: 585.92, state: 'received', tone: 'success', stateLabel: 'reçu le 13/11', text: 'Versement immédiat · 585,92 € · reçu le 13/11', refs: { qonto: 'solio-6791-1-transaction-019d1b2f-0001', mollieSettlement: 'T19274230.2610.01', molliePayment: null } },
  { key: 'balance#retenue', tranche: 'retenue', label: 'Retenue Mollie 20 %', amount: 146.48, state: 'held', tone: 'neutral', stateLabel: "retenue jusqu'au 11/02/2027", text: 'Retenue Mollie 20 % · 146,48 € · prévue vers le 11/02/2027', refs: null },
];
const SCHEDULE = {
  text: 'Payé par carte 732,40 € — 585,92 € reçus · 146,48 € attendus le 11/02/2027',
  segments: [
    { text: 'Payé par carte 732,40 €', tone: 'default' },
    { text: '585,92 € reçus', tone: 'success' },
    { text: '146,48 € attendus le 11/02/2027', tone: 'muted' },
  ],
};

const ficheWith = ({ tranches = TRANCHES, schedule = SCHEDULE } = {}) => {
  const ledger = ledgerOf([paidRow('balance', 'Solde', 732.4, { ...(tranches ? { bankTranches: tranches } : {}) })]);
  return { ...ledger, ...(schedule ? { schedule } : {}) };
};

test('rule 18: the two tranches are drawn under the paid row, with the server\'s labels and states', () => {
  renderLedger({ ledger: ficheWith(), editingReservationId: 7, reservationId: 7 });
  const lines = within(screen.getByRole('list', { name: 'Versements de Solde' })).getAllByRole('listitem');
  expect(lines).toHaveLength(2);
  expect(within(lines[0]).getByText('Versement immédiat')).toBeInTheDocument();
  expect(within(lines[0]).getByText('585,92 €')).toBeInTheDocument();
  expect(within(lines[0]).getByText('reçu le 13/11')).toBeInTheDocument();
  expect(within(lines[1]).getByText('Retenue Mollie 20 %')).toBeInTheDocument();
  expect(within(lines[1]).getByText('146,48 €')).toBeInTheDocument();
  expect(within(lines[1]).getByText("retenue jusqu'au 11/02/2027")).toBeInTheDocument();
});

test('rule 12: a reconciled tranche shows the identifiers of its credit; a pending one shows none', () => {
  renderLedger({ ledger: ficheWith(), editingReservationId: 7, reservationId: 7 });
  const lines = screen.getAllByRole('listitem').filter((li) => li.dataset.line);
  expect(within(lines[0]).getByRole('button', { name: /Copier la référence Qonto solio-6791-1-transaction-019d1b2f-0001/ })).toBeInTheDocument();
  expect(within(lines[0]).getByRole('button', { name: /Copier la référence Lot Mollie T19274230.2610.01/ })).toBeInTheDocument();
  expect(within(lines[1]).queryByRole('button', { name: /Copier la référence/ })).not.toBeInTheDocument();
});

test('rule 19: the recap line is drawn in segments toned by the server', () => {
  renderLedger({ ledger: ficheWith(), editingReservationId: 7, reservationId: 7 });
  const recap = screen.getByTestId('bank-schedule');
  expect(recap).toHaveTextContent('Payé par carte 732,40 € — 585,92 € reçus · 146,48 € attendus le 11/02/2027');
  expect(within(recap).getByText('585,92 € reçus')).toHaveAttribute('data-tone', 'success');
  expect(within(recap).getByText('146,48 € attendus le 11/02/2027')).toHaveAttribute('data-tone', 'muted');
});

test('rule 19: a fiche with nothing pending shows nothing new', () => {
  renderLedger({ ledger: ficheWith({ tranches: null, schedule: null }), editingReservationId: 7, reservationId: 7 });
  expect(screen.queryByTestId('bank-schedule')).not.toBeInTheDocument();
  expect(screen.queryByTestId('schedule-lines')).not.toBeInTheDocument();
});
