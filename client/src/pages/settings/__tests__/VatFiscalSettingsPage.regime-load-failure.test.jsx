/**
 * specs/vat-optional-mode.md rule 45 — a failed regime load is shown with « Réessayer », never a page
 * where the regime badge and the switch simply vanish.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getSettings: vi.fn(), updateSettings: vi.fn(), getVatRegime: vi.fn(), getFinanceGoalContext: vi.fn() },
}));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast, useAppDialogs: () => ({ confirm: vi.fn().mockResolvedValue(true), alert: vi.fn().mockResolvedValue() }) };
});
vi.mock('../../../plugins/sdk/Slot', () => ({ __esModule: true, default: () => null }));

import api from '../../../api';
import VatFiscalSettingsPage from '../VatFiscalSettingsPage';

const PERIOD = { id: 2, regime: 'subject', rate: 10, legalMention: null, label: 'Depuis le 01/01/2026', reservations: 0, deletable: false };

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getFinanceGoalContext.mockResolvedValue(null);
  api.getSettings.mockResolvedValue({
    vat: { regime: 'subject', rate: 10, legalMention: null, franchise: { applies: false } },
    accounting: { fiscalYearEndMonth: 12, revenueGoals: {} },
    updatedAtLabel: 'aujourd’hui',
  });
});

const renderPage = () => render(<MemoryRouter><VatFiscalSettingsPage /></MemoryRouter>);

test('rule 45 — a failed regime load shows an error with « Réessayer », and a retry clears it', async () => {
  api.getVatRegime.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ inForce: PERIOD, latest: PERIOD, periods: [PERIOD], mentions: [] });
  renderPage();
  expect(await screen.findByText('Impossible de charger le régime de TVA.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await vi.waitFor(() => expect(screen.queryByText('Impossible de charger le régime de TVA.')).toBeNull());
  expect(api.getVatRegime).toHaveBeenCalledTimes(2);
});
