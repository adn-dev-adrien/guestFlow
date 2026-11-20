/**
 * StandaloneSalesTodayCard — « Ventes hors séjour · aujourd'hui » (owner M4): the day's sales as the server words them, newest first, the button that opens the counter dialog, an empty day,
 * a refusal kept inside the card with its retry, and a reload when the page asks for one.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getStandaloneSales: vi.fn() } }));
import api from '../../api';
import StandaloneSalesTodayCard from '../StandaloneSalesTodayCard';

const SALES = [
  { id: 302, ref: 'standalone:302', clientLabel: 'Passage', lines: ['Limonade × 1'], totalCents: 400, remainingCents: 400, statusLabel: 'Reste 4,00 €', tone: 'due' },
  { id: 301, ref: 'standalone:301', clientLabel: 'Claire Martin', lines: ['Bière locale × 2', 'Planche × 1 (offerte)'], totalCents: 1300, remainingCents: 0, statusLabel: 'Payée', tone: 'paid' },
];

beforeEach(() => { vi.clearAllMocks(); });

test('lists the sales with the server\'s status words and totals, and the button opens the dialog', async () => {
  api.getStandaloneSales.mockResolvedValue({ day: '2099-02-13', sales: SALES });
  const onNewSale = vi.fn();
  render(<StandaloneSalesTodayCard onNewSale={onNewSale} />);
  const rows = await screen.findAllByRole('listitem');
  expect(within(rows[0]).getByText('Vente n° 302 · Passage')).toBeInTheDocument();
  expect(within(rows[0]).getByText('Reste 4,00 €')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Bière locale × 2 · Planche × 1 (offerte)')).toBeInTheDocument();
  expect(within(rows[1]).getByText('13,00 €')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Vente hors séjour' }));
  expect(onNewSale).toHaveBeenCalled();
});

test('an empty day says so; a refusal stays inside the card and its retry reads again; a reloadKey reads again', async () => {
  api.getStandaloneSales.mockResolvedValueOnce({ day: 'x', sales: [] });
  const { rerender } = render(<StandaloneSalesTodayCard onNewSale={() => {}} reloadKey={0} />);
  expect(await screen.findByText('Aucune vente aujourd’hui.')).toBeInTheDocument();
  api.getStandaloneSales.mockRejectedValueOnce(new Error('x'));
  rerender(<StandaloneSalesTodayCard onNewSale={() => {}} reloadKey={1} />);
  expect(await screen.findByText('Impossible de charger les ventes du jour.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Vente hors séjour' })).toBeInTheDocument();
  api.getStandaloneSales.mockResolvedValueOnce({ day: 'x', sales: SALES });
  fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
  expect(await screen.findByText('Vente n° 301 · Claire Martin')).toBeInTheDocument();
});
