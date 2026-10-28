// specs/plugin-operator-provisioning.md rule 13 — « Nouveau client »: the modules the plan allows are
// ticked, the operator may untick some, changing the plan re-ticks, and the save sends the choice.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import NewCustomerPage from '../pages/NewCustomerPage';
import api from '../api';
import { renderAt } from './consoleFixtures';

vi.mock('../api', () => ({ default: { catalogue: vi.fn(), previewCustomer: vi.fn(), createCustomer: vi.fn() } }));

const choices = (ids, ticked) => ids.map((id) => ({ id, name: id === 'linen' ? 'Linge et blanchisserie' : 'Arrivée et départ guidés', ticked: ticked.includes(id), allowed: true }));

beforeEach(() => {
  vi.clearAllMocks();
  api.catalogue.mockResolvedValue({ plans: [{ code: 'essentiel', name: 'Essentiel' }, { code: 'pro', name: 'Pro' }] });
  api.previewCustomer.mockImplementation(async (form) => {
    const ids = form.planCode === 'pro' ? ['linen', 'sas'] : ['sas'];
    const ticked = form.modules || ids;
    return {
      errors: {},
      summary: { price: 'Pro', period: 'Essai gratuit.', catalogue: 'Prix v1.', url: 'https://x.guestflow.fr' },
      addonChoices: [],
      moduleChoices: choices(ids, ticked),
      moduleSummary: `${ticked.length} module${ticked.length > 1 ? 's' : ''} actif${ticked.length > 1 ? 's' : ''} à la création.`,
      defaults: { startsAt: '2026-10-28' },
    };
  });
});

it('rule 13 — every module the plan allows is ticked, with the server’s count', async () => {
  renderAt(<NewCustomerPage />);
  expect(await screen.findByLabelText('Linge et blanchisserie')).toBeChecked();
  expect(screen.getByLabelText('Arrivée et départ guidés')).toBeChecked();
  expect(screen.getByText('2 modules actifs à la création.')).toBeInTheDocument();
});

it('rule 13 — unticking keeps the line visible and sends the remaining choice on save', async () => {
  api.createCustomer.mockResolvedValue({ id: 9 });
  renderAt(<NewCustomerPage />, { path: '/clients/nouveau', route: '/clients/nouveau' });
  fireEvent.click(await screen.findByLabelText('Linge et blanchisserie'));
  await waitFor(() => expect(screen.getByLabelText('Linge et blanchisserie')).not.toBeChecked());
  expect(await screen.findByText('1 module actif à la création.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Créer le client' }));
  await waitFor(() => expect(api.createCustomer).toHaveBeenCalled());
  expect(api.createCustomer.mock.calls[0][0].modules).toEqual(['sas']);
});

it('rule 13 — changing the plan re-ticks the new plan’s set', async () => {
  renderAt(<NewCustomerPage />);
  fireEvent.click(await screen.findByLabelText('Linge et blanchisserie'));
  await screen.findByText('1 module actif à la création.');
  fireEvent.click(screen.getByRole('button', { name: 'Essentiel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pro' }));
  expect(await screen.findByText('2 modules actifs à la création.')).toBeInTheDocument();
  expect(screen.getByLabelText('Linge et blanchisserie')).toBeChecked();
});
