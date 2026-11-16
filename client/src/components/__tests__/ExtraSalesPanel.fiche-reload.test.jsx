// specs/pricing-components.md §3 rules 27, 30, 85 — every accepted write of the panel makes the fiche re-read (a later save must not drop the sold line);
// a closed fiche offers no sale; a failed read shows an error with a retry.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ default: { getSaleDetail: vi.fn(), patchExtraLine: vi.fn(), quoteExtraSale: vi.fn(), sellExtra: vi.fn() } }));
import api from '../../api';
import ExtraSalesPanel from '../ExtraSalesPanel';

const articles = [{ articleRef: 'option:5', label: 'Bain nordique' }];
const unpaid = { ref: 'option:5', kind: 'option', label: 'Bain nordique', quantity: 1, totalCents: 4000, sourceLabel: 'Fiche', status: 'dueAtArrival', statusLabel: 'À payer à l’arrivée', collectAt: 'arrival', momentLabel: 'À l’arrivée', movable: true, moments: ['arrival', 'departure'], discountCents: 0, stayDiscountShareCents: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  api.getSaleDetail.mockResolvedValue({ lines: [unpaid], totals: { dueCents: 4000 } });
  api.quoteExtraSale.mockResolvedValue({ totalCents: 4000, lines: [{ momentLabel: 'À payer à l’arrivée', merged: false }] });
});

test('a sold product tells the fiche to reload', async () => {
  const onChanged = vi.fn();
  api.sellExtra.mockResolvedValue({ saleDetail: { lines: [unpaid], totals: { dueCents: 4000 } } });
  render(<ExtraSalesPanel reservationId={12} articles={articles} onChanged={onChanged} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un produit' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'Produit' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Bain nordique' }));
  await waitFor(() => expect(api.quoteExtraSale).toHaveBeenCalled());
  await screen.findByText(/40,00/, { selector: '[role="dialog"] *' });
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

test('a changed moment tells the fiche to reload; a refused one does not', async () => {
  const onChanged = vi.fn();
  api.patchExtraLine.mockRejectedValueOnce(new Error('Refusé.'));
  api.patchExtraLine.mockResolvedValueOnce({ saleDetail: { lines: [{ ...unpaid, collectAt: 'departure', momentLabel: 'Au départ' }], totals: { dueCents: 4000 } } });
  render(<ExtraSalesPanel reservationId={12} articles={articles} onChanged={onChanged} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Moment de Bain nordique' }));
  await userEvent.click(within(await screen.findByRole('menu')).getByText('À payer au départ'));
  expect(await screen.findByText('Refusé.')).toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Moment de Bain nordique' }));
  await userEvent.click(within(await screen.findByRole('menu')).getByText('À payer au départ'));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

test('a locked fiche offers neither the add button nor the moment menu', async () => {
  render(<ExtraSalesPanel reservationId={12} articles={articles} locked />);
  await screen.findByText('Bain nordique');
  expect(screen.queryByRole('button', { name: 'Ajouter un produit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Moment de Bain nordique' })).toBeNull();
});

test('a failed read shows an error and « Réessayer » reads again', async () => {
  api.getSaleDetail.mockRejectedValueOnce(new Error('boom'));
  render(<ExtraSalesPanel reservationId={12} articles={articles} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Ventes du séjour indisponibles.');
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Bain nordique')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});
