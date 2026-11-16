// specs/gift-vouchers.md rule 43 — the « TVA des bons cadeaux » field: 10 by default, each refusal with its own sentence while typing
// (a UX hint — the server judges again and its sentence wins), saved as typed, and the hint that it applies to vouchers sold from now on.
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
  validityMonths: '18', vatRatePercent: '10', minAmountCents: '2000', maxAmountCents: '200000', pageUrl: '', bookingUrl: '', ideas: '[]',
  mailSubjectFr: 'Objet', mailBodyFr: 'Corps', mailSubjectEn: 'Subject', mailBodyEn: 'Body',
};

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getSettings.mockResolvedValue(stored);
  giftVouchersApi.getProperties.mockResolvedValue([]);
  giftVouchersApi.saveSettings.mockResolvedValue(stored);
});

async function typeRate(text) {
  const field = await screen.findByLabelText('TVA des bons cadeaux');
  field.focus();
  await userEvent.clear(field);
  if (text) await userEvent.type(field, text);
  return field;
}

test('shows the rate in force and says it applies to the vouchers sold from now on', async () => {
  renderWithShell(<GiftVoucherSettings />);
  expect(await screen.findByLabelText('TVA des bons cadeaux')).toHaveValue('10');
  expect(screen.getByText('S’applique aux bons vendus à partir de l’enregistrement. Un bon déjà vendu garde son taux.')).toBeInTheDocument();
});

test.each([
  ['', 'Saisir un taux (0 si les bons ne portent pas de TVA).'],
  ['abc', 'Saisir un nombre, par exemple 10 ou 5,5.'],
  ['10,555', 'Deux décimales au plus.'],
  ['120', 'Saisir un taux entre 0 et 100 %.'],
])('« %s » is refused with its own sentence and nothing can be saved', async (text, sentence) => {
  renderWithShell(<GiftVoucherSettings />);
  const field = await typeRate(text);
  expect(await screen.findByText(sentence)).toBeInTheDocument();
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('a valid rate with a comma is saved as typed, and the refusal goes away', async () => {
  renderWithShell(<GiftVoucherSettings />);
  await typeRate('120');
  await screen.findByText('Saisir un taux entre 0 et 100 %.');
  const field = await typeRate('5,5');
  expect(screen.queryByText('Saisir un taux entre 0 et 100 %.')).not.toBeInTheDocument();
  expect(field).toHaveValue('5,5');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.saveSettings).toHaveBeenCalled());
  expect(giftVouchersApi.saveSettings.mock.calls[0][0].vatRatePercent).toBe('5,5');
});

test('the server’s sentence for the rate is shown on the field when it refuses', async () => {
  giftVouchersApi.saveSettings.mockRejectedValue(Object.assign(new Error('INVALID_SETTING'), { errors: { vatRatePercent: 'Deux décimales au plus.' } }));
  renderWithShell(<GiftVoucherSettings />);
  await typeRate('7');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Deux décimales au plus.')).toBeInTheDocument();
});
