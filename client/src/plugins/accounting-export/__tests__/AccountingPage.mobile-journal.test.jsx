// specs/ds-components.md rule 23 — review #8, m-8: on a phone the journal table (~470 px) sat in a
// card that clips, and the Débit / Crédit amounts were cut (« 13… ») with no way to scroll. On xs each
// line is a stacked row with its amount in full on the right.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { JournalEntryCard } from '../AccountingPage';

const compactScreen = () => {
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query), media: query,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  });
};
afterEach(() => { delete window.matchMedia; });

const ENTRY = {
  reservationId: 4, kind: 'balance', direction: 'payment', day: 3, month: 10, year: 2026,
  libelle: 'Dupont Jean', encaissementTtc: 1350.4, finalPrice: 1350.4, stayShare: 1, balanced: true,
  platform: { platform: null }, sumDebits: 1350.4, sumCredits: 1350.4,
  lines: [
    { type: 'client', compte: '411DUPONT', accountLabel: 'Client', libelle: 'Solde séjour Dupont', debit: 1350.4, credit: null },
    { type: 'revenue', compte: '70610000', accountLabel: 'Hébergement', libelle: 'Hébergement', debit: null, credit: 1227.64 },
    { type: 'vat', compte: '44571100', accountLabel: 'TVA 10 %', libelle: 'TVA', debit: null, credit: 122.76 },
  ],
};

const renderCard = () => render(<MemoryRouter><JournalEntryCard entry={ENTRY} /></MemoryRouter>);

test('rule 23 — on a phone the lines are stacked rows, not a clipped five-column table', () => {
  compactScreen();
  renderCard();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  const lines = screen.getByTestId('journal-lines-compact');
  const [debitRow, revenueRow] = within(lines).getAllByTestId('journal-line');
  expect(within(revenueRow).getByText('Crédit')).toBeInTheDocument();
  expect(within(debitRow).getByText('Débit')).toBeInTheDocument();
  expect(within(debitRow).getByText(/1\s?350,40/)).toBeInTheDocument();
  expect(within(lines).getByText(/122,76/)).toBeInTheDocument();
  expect(within(lines).getByText(/Débit 1\s?350,40 € · Crédit 1\s?350,40 €/)).toBeInTheDocument();
});

test('rule 23 — from sm up the table stays', () => {
  renderCard();
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.queryByTestId('journal-lines-compact')).not.toBeInTheDocument();
});
