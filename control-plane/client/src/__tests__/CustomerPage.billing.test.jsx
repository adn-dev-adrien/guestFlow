// specs/control-plane-plans-and-access.md rules 7, 17 and 34 — the customer page's billing: the
// invoices with their status and Qonto links, « Relancer maintenant » after a preview, « Vérifier le
// paiement », and the billing identity edited with the server's refusal.
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import CustomerPage from '../pages/CustomerPage';
import api from '../api';
import { renderAt, setWidth, customerFixture } from './consoleFixtures';

vi.mock('../api', () => ({ default: {
  customer: vi.fn(), remindPreview: vi.fn(), remind: vi.fn(), checkPayment: vi.fn(), setBilling: vi.fn(), sendEmail: vi.fn(), ignoreEmail: vi.fn(),
  licenceUrl: (id) => `/api/customers/${id}/licence`,
} }));

const invoiced = {
  ...customerFixture,
  invoices: [
    { id: 9, number: 'F-2026-0051', period: '07/10/2026 → 07/11/2026', amount: '59,00 € HT', total: '70,80 €', status: 'open', statusLabel: 'À payer', provider: 'qonto', detail: '', invoiceUrl: 'https://pay.test/i/9', payUrl: 'https://pay.test/l/9' },
    { id: 8, number: '—', period: '07/09/2026 → 07/10/2026', amount: '59,00 €', total: '—', status: 'paid', statusLabel: 'Payée', provider: 'manual', detail: 'Enregistré à la main « virement »', invoiceUrl: null, payUrl: null },
  ],
  emails: [
    { id: 4, name: 'Facture', status: 'pending', statusLabel: 'À valider', at: '30/09/2026 04:00', recipient: 'jo@moulin.fr', subject: 'Votre facture', body: 'Bonjour', operator: null, error: null },
    { id: 3, name: 'Relance J+7', status: 'dropped', statusLabel: 'Retiré de la file', at: '29/09/2026 04:00', recipient: 'jo@moulin.fr', subject: 's', body: 'b', operator: null, error: 'la facture est payée' },
  ],
  actions: { ...customerFixture.actions, remind: true, remindHint: null, checkPayment: true },
};
const page = () => renderAt(<CustomerPage />, { path: '/clients/:id', route: '/clients/3' });

beforeEach(() => { setWidth(1280); vi.clearAllMocks(); });

it('rule 17 — the invoices show their number, status and Qonto links; the emails their outcome', async () => {
  api.customer.mockResolvedValue(invoiced);
  page();
  const list = await screen.findByRole('list', { name: 'Factures' });
  expect(within(list).getByText('F-2026-0051')).toBeInTheDocument();
  expect(within(list).getByText('À payer')).toBeInTheDocument();
  expect(within(list).getByRole('link', { name: 'Lien de paiement' })).toHaveAttribute('href', 'https://pay.test/l/9');
  expect(within(list).getByRole('link', { name: 'Facture' })).toHaveAttribute('href', 'https://pay.test/i/9');
  expect(screen.getByText('Retiré de la file')).toBeInTheDocument();
  expect(screen.getByText('À valider')).toBeInTheDocument();
});

it('rule 17 — « Relancer maintenant » is disabled without an open invoice', async () => {
  api.customer.mockResolvedValue(customerFixture);
  page();
  expect(await screen.findByRole('button', { name: 'Relancer maintenant' })).toBeDisabled();
});

it('rule 17 — « Relancer maintenant » shows the server’s text, then sends it', async () => {
  api.customer.mockResolvedValue(invoiced);
  api.remindPreview.mockResolvedValue({ preview: { to: 'jo@moulin.fr', subject: 'Relance : facture GuestFlow F-2026-0051', body: 'Bonjour Jo,' } });
  api.remind.mockResolvedValue(invoiced);
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Relancer maintenant' }));
  expect(await screen.findByText('Relance : facture GuestFlow F-2026-0051')).toBeInTheDocument();
  expect(api.remind).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole('button', { name: 'Envoyer' }).pop());
  await waitFor(() => expect(api.remind).toHaveBeenCalledWith(3));
  expect(await screen.findByText('Relance envoyée.')).toBeInTheDocument();
});

it('rule 34 — « Vérifier le paiement » says what Qonto answered', async () => {
  api.customer.mockResolvedValue(invoiced);
  api.checkPayment.mockResolvedValue({ ...invoiced, notice: 'Qonto : facture F-2026-0051 toujours à payer.' });
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Vérifier le paiement' }));
  expect(await screen.findByText('Qonto : facture F-2026-0051 toujours à payer.')).toBeInTheDocument();
});

it('rule 7 — the billing identity is edited; a refusal keeps the dialog open with the server’s message', async () => {
  api.customer.mockResolvedValue(customerFixture);
  api.setBilling.mockRejectedValueOnce(Object.assign(new Error('Code postal français : 5 chiffres.'), { errors: {} }));
  api.setBilling.mockResolvedValueOnce(customerFixture);
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
  const postcode = await screen.findByLabelText('Code postal');
  expect(postcode).toHaveValue('07140');
  fireEvent.change(postcode, { target: { value: '7140' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Code postal français : 5 chiffres.')).toBeInTheDocument();
  expect(screen.getByLabelText('Code postal')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Code postal'), { target: { value: '07140' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.setBilling).toHaveBeenLastCalledWith(3, expect.objectContaining({ billingPostcode: '07140', billingStreet: '1 rue du Moulin', billingCountry: 'FR' })));
});
