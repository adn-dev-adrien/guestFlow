// specs/mollie-rolling-reserve-and-incoming-payments.md rules 28, 30-31 — the journal card draws a Mollie entry (clearing
// account, no « share of the stay », a credit with no fiche is not a link) and the page shows the clearing balance of the
// month with its per-client detail and the unattached credits, as the server sent them.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import DialogProvider from '../../../components/DialogProvider';
import { JournalEntryCard, groupEntries } from '../AccountingPage';
import MollieClearingCard from '../MollieClearingCard';

const CREDIT = {
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  reservationId: null, kind: 'mollie', direction: 'mollie', day: 13, month: 11, year: 2026, paidDate: '2026-11-13',
  libelle: 'VERSEMENT MOLLIE T19274230.2610.01 solio-6791-1-transaction-019d1b2f-0001', encaissementTtc: 585.92,
  finalPrice: 0, stayShare: null, balanced: true, client: { firstName: '', lastName: '' },
  platform: { platform: null, gross: null, net: null, commission: null }, sumDebits: 585.92, sumCredits: 585.92,
  lines: [
    { type: 'other', compte: '51200000', accountLabel: 'Banque', libelle: 'VERSEMENT MOLLIE', debit: 585.92, credit: null },
    { type: 'other', compte: '46720000', accountLabel: 'Compte d\'attente Mollie', libelle: 'VERSEMENT MOLLIE', debit: null, credit: 585.92 },
  ],
};

test('rule 28: a Mollie entry reads « Mollie » on the clearing account, with no « % du séjour »', () => {
  render(<MemoryRouter><JournalEntryCard entry={CREDIT} canOpenReservation /></MemoryRouter>);
  expect(screen.getByText('Mollie')).toBeInTheDocument();
  expect(screen.getByText('Compte d’attente Mollie')).toBeInTheDocument();
  expect(screen.queryByText(/% du séjour/)).not.toBeInTheDocument();
  expect(screen.getByText('Équilibré')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('two Mollie credits of the same day keep distinct keys', () => {
  const blocks = groupEntries([CREDIT, { ...CREDIT, libelle: 'AUTRE' }]);
  expect(new Set(blocks.map((b) => b.key)).size).toBe(2);
});

const MOLLIE = {
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  clearing: { account: '46720000', asOf: '2026-11-30', balance: 343.28, clients: [
    { reservationId: 102, clientName: 'Lucia Rossi', balanceCents: 19680, balance: 196.8 },
    { reservationId: 101, clientName: 'Jean Dupont', balanceCents: 14648, balance: 146.48 },
  ] },
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  unattached: [{ date: '2026-11-18', amountCents: 62478, amount: 624.78, qontoReference: 'solio-6791-1-transaction-01a2c4e8', settlementReference: 'T19274230.2611.07', counterparty: 'Stichting Mollie Payments' }],
};

const renderClearing = (props = {}) => {
  const onOpenReservation = vi.fn();
  render(<DialogProvider><MollieClearingCard mollie={MOLLIE} canOpenReservation onOpenReservation={onOpenReservation} {...props} /></DialogProvider>);
  return { onOpenReservation };
};

test('rule 30: the clearing balance at month end and the clients whose reserve is still held', async () => {
  const { onOpenReservation } = renderClearing();
  expect(screen.getByText(/Solde du compte 46720000 au 30\/11\/2026/)).toBeInTheDocument();
  expect(screen.getByText(/343,28/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Lucia Rossi' }));
  expect(onOpenReservation).toHaveBeenCalledWith(102);
});

test('rule 30: the accountant role reads the detail without a link to the fiche', () => {
  renderClearing({ canOpenReservation: false });
  expect(screen.getByText('Lucia Rossi')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Lucia Rossi' })).not.toBeInTheDocument();
});

test('rule 31: an unattached credit is listed with its references and produces no line', () => {
  renderClearing();
  const section = screen.getByText('Versement Mollie non rattaché').parentElement;
  expect(within(section).getByText(/Stichting Mollie Payments/)).toBeInTheDocument();
  expect(within(section).getByText(/624,78/)).toBeInTheDocument();
  expect(within(section).getByText(/Aucune écriture n’est produite/)).toBeInTheDocument();
  expect(within(section).getByRole('button', { name: /Copier la référence Lot Mollie T19274230.2611.07/ })).toBeInTheDocument();
});

test('nothing is drawn without a live Mollie journal', () => {
  const { container } = render(<MollieClearingCard mollie={null} />);
  expect(container).toBeEmptyDOMElement();
});
