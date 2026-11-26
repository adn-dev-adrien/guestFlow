/**
 * StandaloneSalesTodayCard — « À rembourser » (specs/sas/outside-booking-sas.md rule 41, end-review verification V-4): the counter's documents that still owe
 * money back, any day, as the server words them; « Marquer remboursé » asks a confirmation, closes the row and reads the card again.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getStandaloneSales: vi.fn(), closeStandaloneSaleObligation: vi.fn() } }));
import api from '../../api';
import StandaloneSalesTodayCard from '../StandaloneSalesTodayCard';

const OWING = {
  id: 288, ref: 'standalone:288', clientLabel: 'Passage', lines: ['Bière locale × 2'], totalCents: 1300, remainingCents: 0, statusLabel: 'Payée', tone: 'paid', soldDayLabel: 'Vente du 12/02',
  refundObligations: [{ id: 4, amountCents: 1300, label: '13,00 € à rembourser', detail: 'Lien payé après un changement du reste' }],
};

beforeEach(() => { vi.clearAllMocks(); });

test('V-4 — an owing sale of another day is listed with its words; « Marquer remboursé » confirms, closes and reads again', async () => {
  api.getStandaloneSales.mockResolvedValueOnce({ day: '2099-02-13', sales: [], owed: [OWING], owedTitle: 'À rembourser' }).mockResolvedValueOnce({ day: '2099-02-13', sales: [], owed: [], owedTitle: 'À rembourser' });
  api.closeStandaloneSaleObligation.mockResolvedValue({});
  render(<StandaloneSalesTodayCard onNewSale={() => {}} />);
  expect(await screen.findByText('À rembourser')).toBeInTheDocument();
  expect(screen.getByText('Vente n° 288 · Passage')).toBeInTheDocument();
  expect(screen.getByText('Vente du 12/02 · 13,00 € à rembourser · Lien payé après un changement du reste')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Marquer remboursé' }));
  expect(api.closeStandaloneSaleObligation).not.toHaveBeenCalled();
  const buttons = await screen.findAllByRole('button', { name: 'Marquer remboursé' });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(api.closeStandaloneSaleObligation).toHaveBeenCalledWith(288, 4, 'settled'));
  await waitFor(() => expect(screen.queryByText('À rembourser')).not.toBeInTheDocument());
  expect(api.getStandaloneSales).toHaveBeenCalledTimes(2);
});

test('V-4 — a refused close keeps the row and says why', async () => {
  api.getStandaloneSales.mockResolvedValue({ day: '2099-02-13', sales: [], owed: [OWING], owedTitle: 'À rembourser' });
  api.closeStandaloneSaleObligation.mockRejectedValue(new Error('Déjà clos.'));
  render(<StandaloneSalesTodayCard onNewSale={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Marquer remboursé' }));
  const buttons = await screen.findAllByRole('button', { name: 'Marquer remboursé' });
  fireEvent.click(buttons[buttons.length - 1]);
  expect(await screen.findByText('Déjà clos.')).toBeInTheDocument();
  expect(screen.getByText('Vente n° 288 · Passage')).toBeInTheDocument();
});
