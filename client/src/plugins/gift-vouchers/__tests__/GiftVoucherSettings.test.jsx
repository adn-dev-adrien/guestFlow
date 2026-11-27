// specs/gift-vouchers/gift-vouchers.md rule 22, specs/gift-vouchers/gift-voucher-campaigns.md rules 9, 56 — the settings page: only the keys the plugin declares (the page of the voucher on the site and the
// base of the permanent links) are read and sent; validity, amounts, VAT, ideas, the mail template and `bookingUrl` are gone; the server's message is shown on its field.
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import GiftVoucherSettings from '../GiftVoucherSettings';
import { renderWithShell } from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: { getSettings: vi.fn(), saveSettings: vi.fn(), catalogue: vi.fn() },
}));

const stored = { pageUrl: 'https://site.example.test/bon-cadeau', linkBase: 'bon-cadeau' };

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getSettings.mockResolvedValue(stored);
  giftVouchersApi.saveSettings.mockResolvedValue(stored);
  giftVouchersApi.catalogue.mockResolvedValue({ elements: [{ articleRef: 'option:5', kind: 'option', label: 'Boisson chaude', sellable: true }, { articleRef: 'option:6', kind: 'option', label: 'Bougie', sellable: false }] });
});

test('shows the two declared settings and nothing that moved to the campaign', async () => {
  renderWithShell(<GiftVoucherSettings />);
  expect(await screen.findByLabelText('Page du bon sur le site')).toHaveValue('https://site.example.test/bon-cadeau');
  expect(screen.getByLabelText('Base des liens permanents')).toHaveValue('bon-cadeau');
  ['Validité (mois)', 'Montant minimal (€)', 'TVA des bons cadeaux', 'Page de réservation', 'Objet (français)'].forEach((label) => {
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
  });
  expect(screen.queryByText('Idées de séjour')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('the link base falls back to « bon-cadeau » when the server holds none', async () => {
  giftVouchersApi.getSettings.mockResolvedValue({ pageUrl: '' });
  renderWithShell(<GiftVoucherSettings />);
  expect(await screen.findByLabelText('Base des liens permanents')).toHaveValue('bon-cadeau');
});

test('saving sends only the declared keys', async () => {
  renderWithShell(<GiftVoucherSettings />);
  const base = await screen.findByLabelText('Base des liens permanents');
  await userEvent.clear(base);
  await userEvent.type(base, 'cadeau');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.saveSettings).toHaveBeenCalled());
  expect(giftVouchersApi.saveSettings.mock.calls[0][0]).toEqual({ pageUrl: 'https://site.example.test/bon-cadeau', linkBase: 'cadeau', leftoverDrinkArticleRef: '' });
});

test('the server message for a key is shown on its field and the draft is kept', async () => {
  giftVouchersApi.saveSettings.mockRejectedValue(Object.assign(new Error('INVALID_SETTING'), { errors: { linkBase: 'Début des liens permanents : minuscules, chiffres et tirets.' } }));
  renderWithShell(<GiftVoucherSettings />);
  const base = await screen.findByLabelText('Base des liens permanents');
  await userEvent.clear(base);
  await userEvent.type(base, 'Bon Cadeau');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Début des liens permanents : minuscules, chiffres et tirets.')).toBeInTheDocument();
  expect(base).toHaveValue('Bon Cadeau');
});

// week-weekend-and-print spec rule 16 — the option a cheaper slot gives away: a menu of the options the engine sells outside a stay, « Aucune » by default.
test('« Boisson offerte sur l’écart » lists the sellable options only and is saved as typed', async () => {
  renderWithShell(<GiftVoucherSettings />);
  await userEvent.click(await screen.findByLabelText('Boisson offerte sur l’écart'));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Aucune : l’écart est seulement noté sur le bon', 'Boisson chaude']);
  await userEvent.click(screen.getByRole('option', { name: 'Boisson chaude' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.saveSettings).toHaveBeenCalled());
  expect(giftVouchersApi.saveSettings.mock.calls[0][0]).toMatchObject({ leftoverDrinkArticleRef: 'option:5' });
});
