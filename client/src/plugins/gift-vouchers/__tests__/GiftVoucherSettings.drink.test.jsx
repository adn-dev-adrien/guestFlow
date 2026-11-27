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

test('G24 — while the catalogue loads the stored option is « Option enregistrée », never its reference, and nothing alarming is said', async () => {
  giftVouchersApi.getSettings.mockResolvedValue({ ...stored, leftoverDrinkArticleRef: 'option:6' });
  giftVouchersApi.catalogue.mockReturnValue(new Promise(() => {}));
  renderWithShell(<GiftVoucherSettings />);
  const field = await screen.findByLabelText('Boisson offerte sur l’écart');
  expect(field).toHaveTextContent('Option enregistrée');
  expect(document.body.textContent).not.toMatch(/option:\d+/);
  expect(screen.queryByText(/n’est plus vendable/)).not.toBeInTheDocument();
});

test('G24 — once loaded, an option no longer sold is named and a plain sentence says it will not be given; a deleted one is « supprimée du catalogue »', async () => {
  giftVouchersApi.getSettings.mockResolvedValue({ ...stored, leftoverDrinkArticleRef: 'option:6' });
  const { unmount } = renderWithShell(<GiftVoucherSettings />);
  expect(await screen.findByText(/Cette option n’est plus vendable hors séjour/)).toBeInTheDocument();
  expect(screen.getByLabelText('Boisson offerte sur l’écart')).toHaveTextContent('Bougie');
  unmount();
  giftVouchersApi.getSettings.mockResolvedValue({ ...stored, leftoverDrinkArticleRef: 'option:99' });
  renderWithShell(<GiftVoucherSettings />);
  expect(await screen.findByLabelText('Boisson offerte sur l’écart')).toHaveTextContent('Option supprimée du catalogue');
  expect(document.body.textContent).not.toMatch(/option:\d+/);
});
