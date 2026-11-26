// specs/pricing/pricing-components.md §3 rules 32 and 104 e (stabilisation loop t6, UI6-3) — the rule-104 credit under « Déjà payé » in « Ventes du séjour —
// au départ » is money already received, not a line: it offers no « Offrir » (the server marks it `offerable: false`) and reads its label once.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import StaySalesSection from '../StaySalesSection';

const section = {
  title: 'Ventes du séjour — au départ',
  lines: [
    { ref: 'custom:5', label: 'Balade', totalCents: 6500, settledCents: 0, status: 'dueAtDeparture', statusLabel: 'À payer au départ', sourceLabel: 'Fiche', block: 'due' },
    { ref: 'option:8', label: 'Bière locale', totalCents: 1300, settledCents: 1300, status: 'paid', statusLabel: 'Payée', sourceLabel: 'SAS', block: 'paid' },
    { ref: 'credit:departure', label: 'Déjà réglé (Bière ronde)', totalCents: -3000, settledCents: 0, status: 'credit', statusLabel: null, sourceLabel: null, offered: false, offerable: false, block: 'paid' },
  ],
  groups: [],
  totalCents: 4800,
  dueCents: 3500,
};

test('UI6-3 — the credit row has no « Offrir »; a paid line keeps its own', () => {
  render(<StaySalesSection section={section} onOffer={vi.fn()} onCollectNow={vi.fn()} />);
  const credit = screen.getByText('Déjà réglé (Bière ronde)').closest('li');
  expect(within(credit).queryByRole('button', { name: 'Offrir' })).toBeNull();
  expect(within(credit).getByText(/-30,00/)).toBeInTheDocument();
  expect(credit.textContent).not.toMatch(/null|· Déjà réglé/);
  const paid = screen.getByText('Bière locale').closest('li');
  expect(within(paid).getByRole('button', { name: 'Offrir' })).toBeInTheDocument();
});
