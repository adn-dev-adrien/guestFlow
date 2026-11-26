// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rule 3 — « CB sur place via Mollie depuis » (`mollieCardOnSiteSince`;
// empty = off): loaded from the server, saved with the card, the server's refusal shown on the field.
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
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  api.getToday.mockResolvedValue({ today: '2026-11-16' });
  api.getReconciliationBankAccounts.mockResolvedValue([]);
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  api.getPluginSettings.mockResolvedValue({ reconciliationStartDate: '2026-10-01', mollieReservePercent: '20', mollieReserveHoldDays: '90', mollieCardOnSiteSince: '2026-11-01' });
  api.savePluginSettings.mockResolvedValue({});
});

test('the date loads from the server and is saved with the card; empty means off', async () => {
  renderCard();
  const field = await screen.findByLabelText('CB sur place via Mollie depuis');
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  expect(field).toHaveValue('2026-11-01');
  expect(screen.getByText('Vide : désactivé.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledWith('online-payment', expect.objectContaining({ mollieCardOnSiteSince: '2026-11-01' })));
});

test('the server\'s refusal is shown on the field, with the typed value kept, and clears when it is edited', async () => {
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  api.getPluginSettings.mockResolvedValue({ reconciliationStartDate: '2026-10-01', mollieCardOnSiteSince: '' });
  api.savePluginSettings.mockRejectedValue(Object.assign(new Error('INVALID_SETTING'), { errors: { mollieCardOnSiteSince: 'La date doit être un jour valide qui n\'est pas dans le futur' } }));
  renderCard();
  const field = await screen.findByLabelText('CB sur place via Mollie depuis');
  expect(field).toHaveValue('');
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  fireEvent.change(field, { target: { value: '2027-01-01' } });
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('La date doit être un jour valide qui n\'est pas dans le futur')).toBeInTheDocument();
  expect(field).toHaveAttribute('aria-invalid', 'true');
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  fireEvent.change(field, { target: { value: '2026-11-01' } });
  expect(screen.queryByText('La date doit être un jour valide qui n\'est pas dans le futur')).not.toBeInTheDocument();
});
