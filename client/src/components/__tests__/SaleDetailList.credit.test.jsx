// specs/pricing/pricing-components.md §3 rules 31 and 104 e (stabilisation loop t6, UI6-1 / UI6-2) — the fiche's sale panel draws the server's rule-104
// credits as read-only « Déjà réglé » lines after the sold lines, and « Reste à payer » is the server's `totals.dueCents` (what the stay still asks,
// credits already off): the screen sums nothing.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import SaleDetailList from '../SaleDetailList';

const detail = {
  lines: [
    { ref: 'option:7', kind: 'option', label: 'Bière ronde', quantity: 5, totalCents: 2000, sourceLabel: 'Fiche', status: 'paid', statusLabel: 'Payée', collectAt: 'arrival', momentLabel: 'À l’arrivée', movable: false, moments: [] },
    { ref: 'custom:5', kind: 'custom', label: 'Panier du terroir', quantity: 1, totalCents: 4500, sourceLabel: 'Fiche', status: 'dueAtArrival', statusLabel: 'À payer à l’arrivée', collectAt: 'arrival', momentLabel: 'À l’arrivée', movable: true, moments: ['arrival', 'departure'] },
  ],
  groups: [],
  credits: [{ ref: 'credit:arrival', bucket: 'arrival', label: 'Déjà réglé (Bière ronde)', paidLabels: ['Bière ronde'], totalCents: -1000 }],
  totals: { totalCents: 6500, settledCents: 2000, dueCents: 3500 },
};

test('UI6-1 — the credit is a read-only line « Déjà réglé (…) » at its negative amount, with no moment button', () => {
  render(<SaleDetailList detail={detail} onChangeMoment={() => {}} />);
  const row = screen.getByText('Déjà réglé (Bière ronde)').closest('li');
  expect(within(row).getByText(/-10,00/)).toBeInTheDocument();
  expect(within(row).getByText('Déjà réglé')).toBeInTheDocument();
  expect(within(row).queryByRole('button')).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Moment de/ })).toHaveLength(1);
});

test('UI6-2 — « Reste à payer » is the served figure, never the lines summed', () => {
  render(<SaleDetailList detail={detail} />);
  const total = screen.getByText('Reste à payer').parentElement;
  expect(within(total).getByText(/35,00/)).toBeInTheDocument();
});

test('a detail without credits draws no credit line', () => {
  render(<SaleDetailList detail={{ ...detail, credits: [] }} />);
  expect(screen.queryByText(/Déjà réglé/)).toBeNull();
});
