// specs/control-plane-plans-and-access.md rules 7 and 21 — the new customer form: the server checks
// the slug as it is typed and computes the period and the price; a refused save names the field.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import NewCustomerPage from '../pages/NewCustomerPage';
import api from '../api';
import { renderAt } from './consoleFixtures';

vi.mock('../api', () => ({ default: { catalogue: vi.fn(), previewCustomer: vi.fn(), createCustomer: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  api.catalogue.mockResolvedValue({ plans: [{ code: 'essentiel', name: 'Essentiel' }, { code: 'pro', name: 'Pro' }] });
  api.previewCustomer.mockImplementation(async (form) => ({
    errors: form.slug === 'admin' ? { slug: 'Adresse réservée.' } : {},
    summary: { price: 'Pro · 59,00 € HT / mois', period: 'Essai gratuit du 29/09/2026 au 29/10/2026 ; la première période payée (12 mois) commence au paiement.', catalogue: 'Prix du catalogue v1.', url: `https://${form.slug}.guestflow.fr` },
    addonChoices: [
      { pluginId: 'neat', name: 'Assurance annulation Neat', priceLabel: '9,00 € HT / mois', included: false },
      { pluginId: 'linen', name: 'Linge et blanchisserie', priceLabel: '5,00 € HT / mois', included: true },
    ],
    defaults: { startsAt: '2026-09-29' },
  }));
});

it('rule 21 — a reserved slug is refused as it is typed', async () => {
  renderAt(<NewCustomerPage />);
  fireEvent.change(await screen.findByLabelText(/Adresse \(slug\)/), { target: { value: 'admin' } });
  expect(await screen.findByText('Adresse réservée.')).toBeInTheDocument();
});

it('rules 4 and 7 — the server’s summary and add-ons are shown, and the start date defaults to its today', async () => {
  renderAt(<NewCustomerPage />);
  expect(await screen.findByText(/Essai gratuit du 29\/09\/2026/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Début')).toHaveValue('2026-09-29'));
  expect(screen.getByLabelText('Assurance annulation Neat — 9,00 € HT / mois')).toBeEnabled();
  expect(screen.getByLabelText('Linge et blanchisserie — inclus dans le forfait')).toBeDisabled();
});

it('rule 7 — a refused save shows the message and the field error', async () => {
  const err = Object.assign(new Error('Adresse email invalide.'), { errors: { contactEmail: 'Adresse email invalide.' } });
  api.createCustomer.mockRejectedValue(err);
  renderAt(<NewCustomerPage />);
  await screen.findByText(/Essai gratuit/);
  fireEvent.click(screen.getByRole('button', { name: 'Créer le client' }));
  expect(await screen.findAllByText('Adresse email invalide.')).not.toHaveLength(0);
});

it('rule 7 — a saved customer opens on its page', async () => {
  api.createCustomer.mockResolvedValue({ id: 7 });
  renderAt(<NewCustomerPage />, { path: '/clients/nouveau', route: '/clients/nouveau' });
  await screen.findByText(/Essai gratuit/);
  fireEvent.click(screen.getByRole('button', { name: 'Créer le client' }));
  expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
});
