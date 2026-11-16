// specs/mollie-rolling-reserve-and-incoming-payments.md rules 2-3 — the reserve settings (rate, hold, since): loaded
// from the server, saved with the card, the server's refusal shown on the field with the stored values kept, and the
// note that a change applies to later payments.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DialogProvider from '../../../components/DialogProvider';
import ReconciliationSettingsCard from '../ReconciliationSettingsCard';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getToday: vi.fn(), getPluginSettings: vi.fn(), savePluginSettings: vi.fn(), getReconciliationBankAccounts: vi.fn() },
}));
import api from '../../../api';

const renderCard = () => render(<DialogProvider><ReconciliationSettingsCard connected /></DialogProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  api.getToday.mockResolvedValue({ today: '2026-11-16' });
  api.getReconciliationBankAccounts.mockResolvedValue([]);
  api.getPluginSettings.mockResolvedValue({ reconciliationStartDate: '2026-10-01', mollieReservePercent: '20', mollieReserveHoldDays: '90', mollieReserveSince: '' });
  api.savePluginSettings.mockResolvedValue({});
});

test('rule 2: the rate and the hold load from the server and a change applies to later payments', async () => {
  renderCard();
  expect(await screen.findByLabelText('Part retenue (%)')).toHaveValue('20');
  expect(screen.getByLabelText('Durée de la retenue (jours)')).toHaveValue('90');
  expect(screen.getByText(/Un changement vaut pour les paiements suivants/)).toBeInTheDocument();
});

test('rule 3: the typed values are saved with the card', async () => {
  renderCard();
  const rate = await screen.findByLabelText('Part retenue (%)');
  await userEvent.clear(rate);
  await userEvent.type(rate, '15');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledWith('online-payment', expect.objectContaining({ mollieReservePercent: '15', mollieReserveHoldDays: '90', mollieReserveSince: '' })));
});

test('rule 3: the server\'s refusals are shown on their fields, and clear when the field is edited', async () => {
  api.savePluginSettings.mockRejectedValue(Object.assign(new Error('INVALID_SETTING'), { errors: {
    mollieReservePercent: 'Le taux doit être compris entre 0 et 50 %',
    mollieReserveHoldDays: 'La durée est un nombre de jours entre 1 et 365',
    mollieReserveSince: 'La date doit être un jour valide qui n\'est pas dans le futur',
  } }));
  renderCard();
  const rate = await screen.findByLabelText('Part retenue (%)');
  await userEvent.clear(rate);
  await userEvent.type(rate, '80');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Le taux doit être compris entre 0 et 50 %')).toBeInTheDocument();
  expect(screen.getByText('La durée est un nombre de jours entre 1 et 365')).toBeInTheDocument();
  expect(screen.getByText('La date doit être un jour valide qui n\'est pas dans le futur')).toBeInTheDocument();
  expect(rate).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(rate, { target: { value: '20' } });
  expect(screen.queryByText('Le taux doit être compris entre 0 et 50 %')).not.toBeInTheDocument();
});
