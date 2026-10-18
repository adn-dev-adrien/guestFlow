// specs/hosting-h1-fleet-runtime.md rules 24 and 29 — the customer page offers « Renvoyer
// l’invitation » and « Réinitialiser l’accès » (after a confirmation) once the first administrator
// exists, and « Redémarrer » on a process that failed.
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import CustomerPage from '../pages/CustomerPage';
import api from '../api';
import { renderAt, setWidth, customerFixture } from './consoleFixtures';

vi.mock('../api', () => ({ default: {
  customer: vi.fn(), resendInvitation: vi.fn(), resetAccess: vi.fn(), restartProcess: vi.fn(), supportState: vi.fn(),
  licenceUrl: (id) => `/api/customers/${id}/licence`,
} }));

const page = () => renderAt(<CustomerPage />, { path: '/clients/:id', route: '/clients/3' });
const withAccess = { ...customerFixture, actions: { ...customerFixture.actions, resendInvitation: true, resetAccess: true } };
const crashed = {
  ...customerFixture,
  hosting: { version: '3.10.1', port: 4792, canRestore: true, lines: [{ label: 'Processus', value: 'En échec' }] },
  actions: { ...customerFixture.actions, restartProcess: true },
};

beforeEach(() => { setWidth(1280); vi.clearAllMocks(); api.supportState.mockResolvedValue({ available: false, unavailableReason: '—' }); });

it('rule 24 — « Renvoyer l’invitation » sends it and says so', async () => {
  api.customer.mockResolvedValue(withAccess);
  api.resendInvitation.mockResolvedValue({ ...withAccess, notice: 'Invitation renvoyée à jo@moulin.fr.' });
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Renvoyer l’invitation' }));
  await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledWith(3));
  expect(await screen.findByText('Invitation renvoyée à jo@moulin.fr.')).toBeInTheDocument();
});

it('rule 24 — « Réinitialiser l’accès » asks first; a refusal is shown', async () => {
  api.customer.mockResolvedValue(withAccess);
  api.resetAccess.mockRejectedValue(new Error('Accès non réinitialisé : la version de l’instance ne le permet pas.'));
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Réinitialiser l’accès' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/l’ancien ne sert plus et le second facteur est désactivé/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Réinitialiser' }));
  await waitFor(() => expect(api.resetAccess).toHaveBeenCalledWith(3));
  expect(await screen.findByText('Accès non réinitialisé : la version de l’instance ne le permet pas.')).toBeInTheDocument();
});

it('rule 24 — no access action before the first administrator exists', async () => {
  api.customer.mockResolvedValue(customerFixture);
  page();
  await screen.findByText('Le Moulin', { selector: 'h1, h6, span, p, div' }).catch(() => null);
  expect(screen.queryByRole('button', { name: 'Renvoyer l’invitation' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Réinitialiser l’accès' })).toBeNull();
});

it.each([1280, 390])('rule 29 — at %ipx a failed process offers « Redémarrer »', async (width) => {
  setWidth(width);
  api.customer.mockResolvedValue(crashed);
  api.restartProcess.mockResolvedValue({ ...crashed, actions: { ...crashed.actions, restartProcess: false }, notice: 'Processus redémarré ; l’instance répond.' });
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Redémarrer' }));
  await waitFor(() => expect(api.restartProcess).toHaveBeenCalledWith(3));
  expect(await screen.findByText('Processus redémarré ; l’instance répond.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Redémarrer' })).toBeNull());
});
