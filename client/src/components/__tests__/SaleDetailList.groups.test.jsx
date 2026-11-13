// specs/pricing-components.md §3 rules 13, 85 (mock M6) — an article sold on several lines reads under the server's title with its total, each line
// below it with its own status and moment; an offered line stays in its group, struck through; the SAS section groups per block.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import SaleDetailList from '../SaleDetailList';
import StaySalesSection from '../StaySalesSection';

const line = (over) => ({
  kind: 'option', label: 'Bière locale', quantity: 1, sourceLabel: 'Fiche', status: 'dueAtDeparture', statusLabel: 'À payer au départ', collectAt: 'departure',
  momentLabel: 'Au départ', discountCents: 0, stayDiscountShareCents: 0, grossCents: 650, ...over,
});
const detail = {
  lines: [
    { ref: 'accommodation', kind: 'accommodation', label: 'Hébergement', quantity: 3, totalCents: 30000, sourceLabel: 'Fiche', status: 'inPlan', statusLabel: 'Dans l’acompte et le solde', discountCents: 0, stayDiscountShareCents: 0 },
    line({ ref: 'option:1', totalCents: 650, groupLabel: '1 × 6,50 €' }),
    line({ ref: 'option:2', quantity: 2, totalCents: 1400, grossCents: 1400, groupLabel: '2 × 7,00 €', source: 'Boutique', sourceLabel: 'Boutique' }),
    line({ ref: 'option:3', totalCents: 0, offered: true, status: 'offered', statusLabel: 'Offerte', groupLabel: '1 × 6,50 €' }),
    line({ ref: 'option:9', label: 'Panier vin', totalCents: 2500, grossCents: 2500 }),
  ],
  groups: [{ id: 'option:5', label: 'Bière locale', count: 3, title: 'Bière locale — 4 : 1 × 6,50 € + 2 × 7,00 € + 1 × 6,50 €', totalCents: 2050, refs: ['option:1', 'option:2', 'option:3'] }],
  totals: { dueCents: 2050 },
};

test('the group shows the server’s title and total, then every line with its own status; a single article stays a plain row', () => {
  render(<SaleDetailList detail={detail} />);
  expect(screen.getByText('Bière locale — 4 : 1 × 6,50 € + 2 × 7,00 € + 1 × 6,50 €')).toBeInTheDocument();
  const group = screen.getByRole('list', { name: 'Bière locale' });
  expect(within(group).getAllByRole('listitem')).toHaveLength(3);
  expect(within(group).getByText('2 × 7,00 €')).toBeInTheDocument();
  expect(within(group).getByText('Boutique')).toBeInTheDocument();
  expect(screen.getByText('Panier vin')).toBeInTheDocument();
});

test('an offered line stays in its group with its catalogue amount struck through beside 0 €', () => {
  render(<SaleDetailList detail={detail} />);
  const offered = within(screen.getByRole('list', { name: 'Bière locale' })).getByText('Offerte').closest('li');
  const struck = offered.querySelector('del');
  expect(struck).not.toBeNull();
  expect(struck.textContent).toMatch(/6,50/);
  expect(within(offered).getByText(/0,00/)).toBeInTheDocument();
});

test('without groups the list reads as it always did', () => {
  const { groups, ...flat } = detail;
  const { container } = render(<SaleDetailList detail={flat} />);
  expect(container.querySelectorAll('li')).toHaveLength(5);
  expect(screen.getByText(/Bière locale × 2/)).toBeInTheDocument();
});

test('the SAS section groups per block: what is left to collect, what is already paid', () => {
  const section = {
    title: 'Ventes du séjour — au départ',
    lines: [
      { ref: 'a', label: 'Bière locale', totalCents: 650, statusLabel: 'À payer au départ', block: 'due', groupLabel: '1 × 6,50 €' },
      { ref: 'b', label: 'Bière locale', totalCents: 650, statusLabel: 'À payer au départ', block: 'due', groupLabel: '1 × 6,50 €' },
      { ref: 'c', label: 'Bière locale', totalCents: 700, statusLabel: 'Payée le 12/11', block: 'paid', groupLabel: '1 × 7,00 €' },
      { ref: 'd', label: 'Bière locale', totalCents: 700, statusLabel: 'Payée le 12/11', block: 'paid', groupLabel: '1 × 7,00 €' },
    ],
    groups: [
      { id: 'option:5', block: 'due', label: 'Bière locale', count: 2, title: 'Bière locale — 2 × 6,50 € (2 lignes)', totalCents: 1300, refs: ['a', 'b'] },
      { id: 'option:5', block: 'paid', label: 'Bière locale', count: 2, title: 'Bière locale — 2 × 7,00 € (2 lignes)', totalCents: 1400, refs: ['c', 'd'] },
    ],
    totalCents: 2700,
    dueCents: 1300,
  };
  render(<StaySalesSection section={section} />);
  expect(screen.getByText('À percevoir')).toBeInTheDocument();
  expect(screen.getByText('Déjà payé · 2 lignes')).toBeInTheDocument();
  expect(screen.getByText('Bière locale — 2 × 6,50 € (2 lignes)')).toBeInTheDocument();
  expect(screen.getByText('Bière locale — 2 × 7,00 € (2 lignes)')).toBeInTheDocument();
  expect(screen.getAllByRole('list', { name: 'Bière locale' })).toHaveLength(2);
});

test('worst case: a very long article name wraps inside its group title', () => {
  const long = { ...detail, groups: [{ ...detail.groups[0], title: `${'Bière artisanale '.repeat(15)}— 2 lignes` }] };
  render(<SaleDetailList detail={long} />);
  expect(screen.getByText(/Bière artisanale Bière/)).toBeInTheDocument();
});
