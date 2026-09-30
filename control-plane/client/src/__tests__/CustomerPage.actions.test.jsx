// specs/control-plane-plans-and-access.md rules 7, 15, 19 and 20 — the customer page: the creation
// steps and their actions, a payment with the server's preview, the refused override without a
// reason, and deprovisioning confirmed by the slug.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import CustomerPage from '../pages/CustomerPage';
import api from '../api';
import { renderAt, setWidth, customerFixture as customer } from './consoleFixtures';

vi.mock('../api', () => ({ default: {
  customer: vi.fn(), stepAction: vi.fn(), recordPayment: vi.fn(), extend: vi.fn(), forceActive: vi.fn(), changePlan: vi.fn(),
  deprovision: vi.fn(), reactivate: vi.fn(), cancelErase: vi.fn(), eraseNow: vi.fn(), licenceUrl: (id) => `/api/customers/${id}/licence`,
} }));

const page = () => renderAt(<CustomerPage />, { path: '/clients/:id', route: '/clients/3' });

beforeEach(() => { setWidth(1280); vi.clearAllMocks(); api.customer.mockResolvedValue(customer); });

it('rule 7 — a failed step is retried, a manual one is marked done', async () => {
  api.stepAction.mockResolvedValue(customer);
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(api.stepAction).toHaveBeenCalledWith('3', 'licence', 'retry'));
  fireEvent.click(screen.getByRole('button', { name: 'Marquer fait' }));
  await waitFor(() => expect(api.stepAction).toHaveBeenCalledWith('3', 'instance', 'done'));
});

it('rule 15 — the payment dialog shows the server’s preview for the chosen length', async () => {
  api.recordPayment.mockResolvedValue({ ...customer, state: 'active', stateLabel: 'Actif' });
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer un paiement' }));
  expect(await screen.findByText(/Nouvelle échéance : 29\/10\/2026/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /12 mois/ }));
  expect(screen.getByText(/Nouvelle échéance : 29\/09\/2027/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.recordPayment).toHaveBeenCalledWith(3, { months: 12, reference: '' }));
  expect(await screen.findByText('Paiement enregistré.')).toBeInTheDocument();
});

it('rule 19 — an override without a reason is refused with the server’s message, and the dialog stays', async () => {
  api.extend.mockRejectedValue(new Error('Le motif est obligatoire.'));
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Prolonger' }));
  fireEvent.click((await screen.findAllByRole('button', { name: 'Prolonger' })).pop());
  expect(await screen.findByText('Le motif est obligatoire.')).toBeInTheDocument();
  expect(screen.getByLabelText('Motif (obligatoire)')).toBeInTheDocument();
});

it('rule 20 — deprovisioning names its steps and needs the slug typed', async () => {
  api.deprovision.mockResolvedValue({ ...customer, state: 'archived', stateLabel: 'Archivé', actions: { ...customer.actions, deprovision: false, reactivate: true } });
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Déprovisionner' }));
  expect(await screen.findByText(/Dans 90 jours, le dossier et ses sauvegardes sont effacés/)).toBeInTheDocument();
  const go = screen.getAllByRole('button', { name: 'Déprovisionner' }).pop();
  expect(go).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Pour confirmer, tapez « moulin »'), { target: { value: 'moulin' } });
  expect(go).toBeEnabled();
  fireEvent.click(go);
  await waitFor(() => expect(api.deprovision).toHaveBeenCalledWith(3, 'moulin'));
});

it('rules 4 and 5 — changing plan warns about what was kept out of plan, and shows included add-ons', async () => {
  api.changePlan.mockResolvedValue(customer);
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Changer de forfait' }));
  expect(await screen.findByText(/retire ce qui était conservé hors forfait : Assurance annulation Neat/)).toBeInTheDocument();
  expect(screen.getByLabelText('Assurance annulation Neat — 9,00 € HT / mois')).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Premium' }));
  expect(screen.getByLabelText('Assurance annulation Neat — inclus dans le forfait')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.changePlan).toHaveBeenCalledWith(3, { planCode: 'premium', billing: 'monthly', addons: [] }));
});
