// specs/mollie-rolling-reserve-and-incoming-payments.md rule 12 — a reconciled tranche shows the identifiers of its bank
// credit (Qonto transaction, Mollie settlement, Mollie payment) shortened with a copy button; a credit without any shows none.
import React from 'react';
import { render, screen } from '@testing-library/react';
import DialogProvider from '../../../components/DialogProvider';
import ReconciliationLine from '../ReconciliationLine';
import { BankRefs } from '../ReconciliationLine';

const BANK = {
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  transactionId: 'c1', amountCents: 58592, date: '2026-11-13', dateLabel: '13/11', counterparty: 'Stichting Mollie Payments',
  reference: 'REF T19274230.2610.01', allocatedCents: 58592, auto: false, alsoCovers: [],
  refs: { qonto: 'solio-6791-1-transaction-019d1b2f-0001', mollieSettlement: 'T19274230.2610.01', molliePayment: 'tr_7UhSN1zuXS' },
};
const ITEM = {
  key: '101|balance#immediat', reservation: { id: 101, clientName: 'Jean Dupont', platform: null }, label: 'Solde · versement immédiat',
  expectedCents: 58592, expectedDateLabel: '15/11', paid: true, state: 'reconciled', stateLabel: 'Rapproché', tone: 'success', isGap: false,
  fixText: null, bank: [BANK], proposal: null, alternatives: [], canUndo: true,
};
const noop = () => {};

test('rule 12: the bank row of a reconciled tranche carries the three identifiers, each with a copy button', () => {
  render(<DialogProvider><ReconciliationLine item={ITEM} onConfirm={noop} onDiscard={noop} onUndo={noop} /></DialogProvider>);
  expect(screen.getByRole('button', { name: /Copier la référence Qonto solio-6791-1-transaction-019d1b2f-0001/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copier la référence Lot Mollie T19274230.2610.01' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copier la référence Paiement Mollie tr_7UhSN1zuXS' })).toBeInTheDocument();
});

test('rule 12: a credit without identifiers (an older fixture) shows none', () => {
  const bare = { ...ITEM, bank: [{ ...BANK, refs: undefined }] };
  render(<DialogProvider><ReconciliationLine item={bare} onConfirm={noop} onDiscard={noop} onUndo={noop} /></DialogProvider>);
  expect(screen.queryByRole('button', { name: /Copier la référence/ })).not.toBeInTheDocument();
});

test('rule 12: BankRefs draws nothing for empty references', () => {
  const { container } = render(<DialogProvider><BankRefs refs={{ qonto: null, mollieSettlement: null, molliePayment: null }} /></DialogProvider>);
  expect(container).toBeEmptyDOMElement();
});
