// specs/gift-vouchers.md rules 6, 7, 14, 22, 23 — the settings page: values read from the plugin's settings route, the
// ideas editor (a stay to price, never a bare amount), the page bar saving, the server's message on its field.
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import GiftVoucherSettings from '../GiftVoucherSettings';
import { renderWithShell } from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: { getSettings: vi.fn(), saveSettings: vi.fn(), getProperties: vi.fn() },
}));

const stored = {
  validityMonths: '18', minAmountCents: '2000', maxAmountCents: '200000', pageUrl: '', bookingUrl: '',
  ideas: JSON.stringify([{ label: 'Week-end', propertyId: 7, nights: 2, guests: 2 }]),
  mailSubjectFr: 'Objet', mailBodyFr: 'Corps', mailSubjectEn: 'Subject', mailBodyEn: 'Body',
};

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getSettings.mockResolvedValue(stored);
  giftVouchersApi.getProperties.mockResolvedValue([{ id: 7, name: 'L’Estiva' }, { id: 8, name: 'Le Gîte' }]);
  giftVouchersApi.saveSettings.mockResolvedValue(stored);
});

test('shows the stored values, amounts in euros, and Save stays disabled until something changes', async () => {
  renderWithShell(<GiftVoucherSettings />);
  expect(await screen.findByLabelText('Validité (mois)')).toHaveValue(18);
  expect(screen.getByLabelText('Montant minimal (€)')).toHaveValue('20');
  expect(screen.getByLabelText('Montant maximal (€)')).toHaveValue('2000');
  expect(screen.getByDisplayValue('Week-end')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('the page bar saves the amounts in cents and the ideas as a list of stays', async () => {
  renderWithShell(<GiftVoucherSettings />);
  const months = await screen.findByLabelText('Validité (mois)');
  months.focus();
  await userEvent.clear(months);
  await userEvent.type(months, '24');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.saveSettings).toHaveBeenCalled());
  const sent = giftVouchersApi.saveSettings.mock.calls[0][0];
  expect(sent.validityMonths).toBe('24');
  expect(sent.minAmountCents).toBe('2000');
  expect(sent.maxAmountCents).toBe('200000');
  expect(JSON.parse(sent.ideas)).toEqual([{ label: 'Week-end', propertyId: 7, nights: 2, guests: 2 }]);
});

test('an idea is added with a lodging, nights and guests — no amount field exists — and can be removed', async () => {
  renderWithShell(<GiftVoucherSettings />);
  await screen.findByDisplayValue('Week-end');
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter une idée' }));
  expect(screen.getByLabelText('Libellé 2')).toBeInTheDocument();
  expect(screen.getByLabelText('Nuits 2')).toBeInTheDocument();
  expect(screen.getByLabelText('Personnes 2')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Montant d’une idée/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer cette idée 2' }));
  expect(screen.queryByLabelText('Libellé 2')).not.toBeInTheDocument();
});

test('the server message for a key is shown on its field and the draft is kept', async () => {
  giftVouchersApi.saveSettings.mockRejectedValue(Object.assign(new Error('INVALID_SETTING'), { errors: { validityMonths: 'La validité va de 1 à 120 mois.' } }));
  renderWithShell(<GiftVoucherSettings />);
  const months = await screen.findByLabelText('Validité (mois)');
  months.focus();
  await userEvent.clear(months);
  await userEvent.type(months, '999');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('La validité va de 1 à 120 mois.')).toBeInTheDocument();
  expect(months).toHaveValue(999);
});

test('a refused idea list is shown under the ideas', async () => {
  giftVouchersApi.saveSettings.mockRejectedValue(Object.assign(new Error('INVALID_SETTING'), { errors: { ideas: 'Chaque idée désigne un logement.' } }));
  renderWithShell(<GiftVoucherSettings />);
  await screen.findByDisplayValue('Week-end');
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter une idée' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Chaque idée désigne un logement.')).toBeInTheDocument();
});
