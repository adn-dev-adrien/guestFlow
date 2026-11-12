// specs/pricing-components.md §3 rules 31, 37 — SaleDetailList renders the server's payload and offers the moment menu on an unpaid line only.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import SaleDetailList from '../SaleDetailList';

const detail = {
  lines: [
    { ref: 'accommodation', kind: 'accommodation', label: 'Hébergement', quantity: 3, totalCents: 30000, sourceLabel: 'Fiche', status: 'inPlan', statusLabel: 'Dans l’acompte et le solde', discountCents: 0, stayDiscountShareCents: 0 },
    { ref: 'option:7', kind: 'option', label: 'Bain nordique', quantity: 1, totalCents: 4000, sourceLabel: 'Fiche', status: 'dueAtArrival', statusLabel: 'À payer à l’arrivée', collectAt: 'arrival', momentLabel: 'À l’arrivée', discountCents: 1000, stayDiscountShareCents: 0 },
    { ref: 'option:8', kind: 'option', label: 'Panier vin', quantity: 2, totalCents: 5000, sourceLabel: 'Boutique', status: 'paid', statusLabel: 'Payée le 12/11', collectAt: 'departure', momentLabel: 'Au départ', discountCents: 0, stayDiscountShareCents: 0 },
  ],
  totals: { dueCents: 34000 },
};

test('every line shows its label, amount, source and status as the server gave them', () => {
  render(<SaleDetailList detail={detail} />);
  expect(screen.getByText('Bain nordique')).toBeInTheDocument();
  expect(screen.getByText('À payer à l’arrivée')).toBeInTheDocument();
  expect(screen.getByText('Boutique')).toBeInTheDocument();
  expect(screen.getByText(/Remise/)).toBeInTheDocument();
  expect(screen.getByText('Reste à payer')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

test('the moment menu exists on an unpaid line only and reports the choice', async () => {
  const onChangeMoment = vi.fn();
  render(<SaleDetailList detail={detail} onChangeMoment={onChangeMoment} />);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Moment de Bain nordique' }));
  const menu = await screen.findByRole('menu');
  await userEvent.click(within(menu).getByText('À payer au départ'));
  expect(onChangeMoment).toHaveBeenCalledWith(expect.objectContaining({ ref: 'option:7' }), 'departure');
});

test('choosing the moment the line already has changes nothing', async () => {
  const onChangeMoment = vi.fn();
  render(<SaleDetailList detail={detail} onChangeMoment={onChangeMoment} />);
  await userEvent.click(screen.getByRole('button', { name: 'Moment de Bain nordique' }));
  await userEvent.click(within(await screen.findByRole('menu')).getByText('À payer à l’arrivée'));
  expect(onChangeMoment).not.toHaveBeenCalled();
});

test('worst case: a very long label and no line at all do not break the list', () => {
  const long = { lines: [{ ...detail.lines[1], label: 'Panier gourmand '.repeat(20) }], totals: { dueCents: 0 } };
  const { container } = render(<SaleDetailList detail={long} />);
  expect(container.querySelectorAll('li')).toHaveLength(1);
  render(<SaleDetailList detail={null} />);
});
