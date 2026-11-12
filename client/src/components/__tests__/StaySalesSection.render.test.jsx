// specs/pricing-components.md §3 rule 32 — the SAS shows the departure sales apart, as the server serves them: title, lines with status, what is due.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import StaySalesSection from '../StaySalesSection';

const section = {
  title: 'Ventes du séjour — au départ',
  lines: [
    { ref: 'option:7', label: 'Bûches', totalCents: 1200, statusLabel: 'À payer au départ', sourceLabel: 'Fiche' },
    { ref: 'option:8', label: 'Bain nordique avec un intitulé volontairement très très long pour vérifier le retour à la ligne sur mobile', totalCents: 4000, statusLabel: 'Payée le 12/11', sourceLabel: 'SAS' },
  ],
  totalCents: 5200,
  dueCents: 1200,
};

test('the section names itself, lists every line with its status and prints the amount still due', () => {
  render(<StaySalesSection section={section} />);
  const region = screen.getByRole('region', { name: 'Ventes du séjour — au départ' });
  expect(within(region).getAllByRole('listitem')).toHaveLength(2);
  expect(within(region).getByText('Bûches')).toBeInTheDocument();
  expect(within(region).getByText(/Payée le 12\/11/)).toBeInTheDocument();
  expect(within(region).getAllByText(/12,00/).length).toBeGreaterThan(0);
  expect(within(region).getByText(/très long/)).toBeInTheDocument();
});

test('nothing renders without a section or without lines', () => {
  const { container, rerender } = render(<StaySalesSection section={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<StaySalesSection section={{ title: 'x', lines: [] }} />);
  expect(container).toBeEmptyDOMElement();
});
