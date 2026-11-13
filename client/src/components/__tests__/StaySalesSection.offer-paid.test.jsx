// specs/pricing-components.md §3 rules 14, 23 and 32, PR C mock M3 (docs/rapports/2026-11-13-m3-sas-sur-lignes.html) — a line already paid can be offered from
// the SAS: the server's refusal (409 OVERPAID) opens the confirmation with ITS figure, the confirmed offer asks again with `force`, and what the stay owes
// back is announced (the fiche pays it). Without the handler a paid line offers nothing.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import StaySalesSection from '../StaySalesSection';

const section = (over = {}) => ({
  title: 'Déjà payé',
  lines: [{ ref: 'option:8', label: 'Bière locale', totalCents: 1300, statusLabel: 'Payée', sourceLabel: 'SAS', block: 'paid' }],
  groups: [],
  totalCents: 1300,
  dueCents: 0,
  refundOwedCents: 0,
  ...over,
});
const overpaid = () => Object.assign(new Error('Trop-perçu'), { code: 'OVERPAID', overpaymentTtc: 13 });

test('a paid line offers « Offrir »; an accepted offer needs no confirmation', async () => {
  const onOffer = vi.fn().mockResolvedValue();
  render(<StaySalesSection section={section()} onOffer={onOffer} />);
  await userEvent.click(screen.getByRole('button', { name: 'Offrir' }));
  expect(onOffer).toHaveBeenCalledWith('option:8', false);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('OVERPAID opens the confirmation with the server figure; confirming asks again with force, keeping it closes it', async () => {
  const onOffer = vi.fn().mockRejectedValueOnce(overpaid()).mockResolvedValue();
  render(<StaySalesSection section={section()} onOffer={onOffer} />);
  await userEvent.click(screen.getByRole('button', { name: 'Offrir' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog.textContent).toMatch(/Ligne déjà payée : l’offrir rend 13,00\s€ au client\./);
  await userEvent.click(screen.getByRole('button', { name: /Offrir · 13,00\s€ à rembourser/ }));
  expect(onOffer).toHaveBeenLastCalledWith('option:8', true);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('« Garder » closes the confirmation without a second call; another refusal shows its message under the line', async () => {
  const onOffer = vi.fn().mockRejectedValueOnce(overpaid()).mockRejectedValueOnce(new Error('Ligne introuvable'));
  render(<StaySalesSection section={section()} onOffer={onOffer} />);
  await userEvent.click(screen.getByRole('button', { name: 'Offrir' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Garder' }));
  expect(onOffer).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Offrir' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Ligne introuvable');
});

test('the refund the stay owes is announced even when no paid line is left; without the handler a paid line offers nothing', () => {
  const { rerender } = render(<StaySalesSection section={section({ lines: [], refundOwedCents: 1300 })} onOffer={vi.fn()} />);
  expect(screen.getByText(/À rembourser \(depuis la fiche\) : 13,00\s€/)).toBeTruthy();
  rerender(<StaySalesSection section={section()} />);
  expect(screen.queryByRole('button', { name: 'Offrir' })).toBeNull();
});
