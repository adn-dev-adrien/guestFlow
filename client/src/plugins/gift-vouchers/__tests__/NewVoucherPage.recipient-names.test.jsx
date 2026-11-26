// specs/site/site-outside-resource-booking.md rule 32 — « Nouveau bon »: « Pour » is « Prénom » and « Nom » of the recipient, both required; a server refusal is shown on the field it names;
// the list and the detail show « Prénom Nom », as the server shapes it.
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import NewVoucherPage from '../NewVoucherPage';
import GiftVouchersPage from '../GiftVouchersPage';
import {
  CATALOGUE, OFFER, PAYMENT_METHODS, PRICE, renderWithShell, summary, visual,
} from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: {
    getOffer: vi.fn(), listVisuals: vi.fn(), catalogue: vi.fn(), offerPrice: vi.fn(), previewPrice: vi.fn(), create: vi.fn(), visualImageUrl: vi.fn(() => '/img'), list: vi.fn(), get: vi.fn(),
  },
}));
vi.mock('../../../api', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, default: { ...mod.default, getToday: vi.fn().mockResolvedValue({ today: '2026-11-15' }) } }; // date-literal-ok: a payload the mocked server answers; the screen only shows it
});

const refusal = (message, code) => Object.assign(new Error(message), { code });

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getOffer.mockResolvedValue(OFFER);
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [visual()] });
  giftVouchersApi.catalogue.mockResolvedValue({ elements: CATALOGUE });
  giftVouchersApi.offerPrice.mockResolvedValue(PRICE);
  giftVouchersApi.previewPrice.mockResolvedValue(PRICE);
  giftVouchersApi.create.mockResolvedValue({ id: 42 });
});

const open = async () => {
  renderWithShell(<NewVoucherPage />, { route: '/bons-cadeaux/nouveau', path: '/bons-cadeaux/nouveau' });
  await screen.findByTestId('price-recap');
};

test('the recipient is two required fields of 40 characters, and « Pour » is gone', async () => {
  await open();
  const first = screen.getByLabelText(/^Prénom/);
  const last = screen.getByLabelText(/^Nom/);
  expect([first, last].map((f) => [f.required, f.getAttribute('maxlength')])).toEqual([[true, '40'], [true, '40']]);
  expect(screen.queryByLabelText('Pour')).not.toBeInTheDocument();
});

test('a refused first name is shown on « Prénom », a refused last name on « Nom », and typing clears the refusal', async () => {
  await open();
  giftVouchersApi.create.mockRejectedValueOnce(refusal('Le prénom du destinataire est demandé.', 'RECIPIENT_FIRST_NAME_REQUIRED'));
  await userEvent.click(screen.getByRole('combobox', { name: 'Moyen de paiement' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Espèces' }));
  await userEvent.click(screen.getByRole('button', { name: 'Créer le bon' }));
  expect(await screen.findByText('Le prénom du destinataire est demandé.')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Prénom/)).toBeInvalid();
  await userEvent.type(screen.getByLabelText(/^Prénom/), 'Léa');
  expect(screen.queryByText('Le prénom du destinataire est demandé.')).not.toBeInTheDocument();
  giftVouchersApi.create.mockRejectedValueOnce(refusal('Le nom du destinataire est demandé.', 'RECIPIENT_LAST_NAME_REQUIRED'));
  await userEvent.click(screen.getByRole('button', { name: 'Créer le bon' }));
  expect(await screen.findByText('Le nom du destinataire est demandé.')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Nom/)).toBeInvalid();
  await waitFor(() => expect(giftVouchersApi.create).toHaveBeenCalledTimes(2));
  expect(giftVouchersApi.create.mock.calls[1][0]).toMatchObject({ recipientFirstName: 'Léa', recipientLastName: '' });
});

test('the voucher list shows the recipient as « Prénom Nom », the server’s label', async () => {
  giftVouchersApi.list.mockResolvedValue({ items: [summary()], outstandingCents: 15000, paymentMethods: PAYMENT_METHODS });
  renderWithShell(<GiftVouchersPage />);
  expect(await screen.findByText(/Paul Durand/)).toBeInTheDocument();
});
