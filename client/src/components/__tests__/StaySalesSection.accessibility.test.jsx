// specs/pricing/pricing-components.md §3 rules 32, 85 (UI-13) — the repeated buttons of a section are told apart by the line they act on, and the confirmation takes the focus.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import StaySalesSection from '../StaySalesSection';

const section = {
  title: 'Ventes du séjour',
  lines: [
    { ref: 'option:1', label: 'Panier vin', totalCents: 800, statusLabel: 'À payer au départ', sourceLabel: 'Fiche', block: 'due' },
    { ref: 'option:2', label: 'Panier fromage', totalCents: 900, statusLabel: 'À payer au départ', sourceLabel: 'Fiche', block: 'due' },
    { ref: 'option:8', label: 'Bière locale', totalCents: 1300, statusLabel: 'Payée', sourceLabel: 'SAS', block: 'paid' },
  ],
  groups: [],
  totalCents: 3000,
  dueCents: 1700,
};

test('each « Percevoir maintenant » is described by the line it moves', () => {
  render(<StaySalesSection section={section} onCollectNow={vi.fn()} />);
  const buttons = screen.getAllByRole('button', { name: 'Percevoir maintenant' });
  expect(buttons[0]).toHaveAccessibleDescription(/Panier vin/);
  expect(buttons[1]).toHaveAccessibleDescription(/Panier fromage/);
});

test('« Offrir » is described by its line and the confirmation opens on its safe button', async () => {
  const onOffer = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'OVERPAID', overpaymentTtc: 13 }));
  render(<StaySalesSection section={section} onOffer={onOffer} />);
  const offer = screen.getByRole('button', { name: 'Offrir' });
  expect(offer).toHaveAccessibleDescription(/Bière locale/);
  await userEvent.click(offer);
  expect(await screen.findByRole('button', { name: 'Garder' })).toHaveFocus();
});
