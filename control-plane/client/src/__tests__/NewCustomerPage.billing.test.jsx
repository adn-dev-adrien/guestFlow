// specs/control-plane-plans-and-access.md rule 7 — the new customer's billing identity: the address
// Qonto needs, the postcode checked by the server as it is typed, sent with the form.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import NewCustomerPage from '../pages/NewCustomerPage';
import api from '../api';
import { renderAt } from './consoleFixtures';

vi.mock('../api', () => ({ default: { catalogue: vi.fn(), previewCustomer: vi.fn(), createCustomer: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  api.catalogue.mockResolvedValue({ plans: [{ code: 'pro', name: 'Pro' }] });
  api.previewCustomer.mockImplementation(async (form) => ({
    errors: form.billingCountry === 'FR' && form.billingPostcode && !/^\d{5}$/.test(form.billingPostcode) ? { billingPostcode: 'Code postal français : 5 chiffres.' } : {},
    summary: null,
    addonChoices: [],
    countries: [{ code: 'FR', name: 'France' }, { code: 'BE', name: 'Belgique' }],
    defaults: { startsAt: '2026-09-30', billingCountry: 'FR' },
  }));
});

it('rule 7 — the French postcode is refused as typed, and the address goes with the form', async () => {
  api.createCustomer.mockResolvedValue({ id: 5 });
  renderAt(<NewCustomerPage />, { path: '/clients/nouveau', route: '/clients/nouveau' });
  fireEvent.change(await screen.findByLabelText(/^Code postal/), { target: { value: '7140' } });
  expect(await screen.findByText('Code postal français : 5 chiffres.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Code postal/), { target: { value: '07140' } });
  await waitFor(() => expect(screen.queryByText('Code postal français : 5 chiffres.')).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/^Adresse \*/), { target: { value: '12 chemin des Crêtes' } });
  fireEvent.change(screen.getByLabelText(/^Ville/), { target: { value: 'Les Vans' } });
  fireEvent.click(screen.getByRole('button', { name: 'Créer le client' }));
  await waitFor(() => expect(api.createCustomer).toHaveBeenCalledWith(expect.objectContaining({
    billingStreet: '12 chemin des Crêtes', billingPostcode: '07140', billingCity: 'Les Vans', billingCountry: 'FR',
  })));
});
