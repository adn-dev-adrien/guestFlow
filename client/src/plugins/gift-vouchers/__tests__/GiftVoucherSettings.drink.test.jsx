// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 16 — the option a cheaper slot gives away: a menu of the options the engine sells outside a stay, « Aucune » by default,
// and the stored option always listed — even one the catalogue no longer sells.
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

test('« Boisson offerte sur l’écart » lists the sellable options only and is saved as typed', async () => {
  renderWithShell(<GiftVoucherSettings />);
  await userEvent.click(await screen.findByLabelText('Boisson offerte sur l’écart'));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Aucune : l’écart est seulement noté sur le bon', 'Boisson chaude']);
  await userEvent.click(screen.getByRole('option', { name: 'Boisson chaude' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.saveSettings).toHaveBeenCalled());
  expect(giftVouchersApi.saveSettings.mock.calls[0][0]).toMatchObject({ leftoverDrinkArticleRef: 'option:5' });
});

test('the stored option is listed with its name even when the catalogue no longer sells it', async () => {
  giftVouchersApi.getSettings.mockResolvedValue({ ...stored, leftoverDrinkArticleRef: 'option:6' });
  renderWithShell(<GiftVoucherSettings />);
  await userEvent.click(await screen.findByLabelText('Boisson offerte sur l’écart'));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Aucune : l’écart est seulement noté sur le bon', 'Boisson chaude', 'Bougie']);
  expect(screen.getByRole('option', { name: 'Bougie' })).toHaveAttribute('aria-selected', 'true');
});
