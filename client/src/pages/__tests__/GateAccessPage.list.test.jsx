// specs/gate-access-portier.md §3.4 — the « Accès portail » list: what it shows, the two key actions and
// their confirmations, the reads on display and on foreground, and Portier unreachable said plainly.
import { vi, beforeEach, test, expect } from 'vitest';
import React from 'react';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPortierAccesses: vi.fn(),
    portierAccessAction: vi.fn(),
    deletePortierAccess: vi.fn(),
    getPortierAccessEvents: vi.fn(),
    getPortierBranding: vi.fn(),
    setPortierBrandingSource: vi.fn(),
    createPortierAccess: vi.fn(),
    updatePortierAccess: vi.fn(),
  },
}));

import api from '../../api';
import { LIST, STAY, MANUAL, renderGateAccessPage } from './gateAccessPageFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  api.getPortierAccesses.mockResolvedValue(LIST);
});

const rowOf = (label) => screen.getByText(label).closest('tr');

test('the list: the house line, the groups, the tags, the validity in words, hours, phones and last use', async () => {
  renderGateAccessPage();
  expect(await screen.findByText('Camille (Gîte · 202609042)')).toBeInTheDocument();
  expect(api.getPortierAccesses).toHaveBeenCalledWith({ view: 'current', kind: 'all' });
  expect(screen.getByText('● Maison connectée depuis 06:12 · portail fermé')).toBeInTheDocument();
  expect(screen.getByText('Actifs')).toBeInTheDocument();
  expect(screen.getByText('Suspendus')).toBeInTheDocument();

  const stay = within(rowOf(STAY.label));
  for (const text of ['guestFlow', 'actif', 'Gîte · 202609042 · code 4K7M-9QT2', STAY.validity, 'à toute heure', '2', 'il y a 3 h']) {
    expect(stay.getByText(text)).toBeInTheDocument();
  }
  const manual = within(rowOf(MANUAL.label));
  expect(manual.getByText('créé par moi')).toBeInTheDocument();
  expect(manual.getByText('Toujours valable')).toBeInTheDocument();
  expect(manual.getByRole('button', { name: 'Reprendre' })).toBeInTheDocument();
  expect(manual.queryByRole('button', { name: 'Suspendre' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Révoquer ce téléphone/)).not.toBeInTheDocument();
});

test('« Régénérer l’accès » says that every phone stops before anything happens, then regenerates', async () => {
  const user = userEvent.setup();
  api.portierAccessAction.mockResolvedValue({ access: { ...STAY, code: 'TXFK-EJMG' } });
  renderGateAccessPage();
  await screen.findByText(STAY.label);

  await user.click(within(rowOf(STAY.label)).getByRole('button', { name: "Régénérer l'accès" }));
  expect(screen.getByText(STAY.confirm.regenerate)).toBeInTheDocument();
  expect(api.portierAccessAction).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.portierAccessAction).toHaveBeenCalledWith(STAY.id, 'regenerate'));
  expect(await screen.findByText('Accès « Camille (Gîte · 202609042) » régénéré : nouveau code TXFK-EJMG.')).toBeInTheDocument();
  await waitFor(() => expect(api.getPortierAccesses).toHaveBeenCalledTimes(2));
});

test('« Nouvelle invitation » has its own confirmation, and « Annuler » changes nothing', async () => {
  const user = userEvent.setup();
  renderGateAccessPage();
  await screen.findByText(STAY.label);

  await user.click(within(rowOf(STAY.label)).getByRole('button', { name: 'Nouvelle invitation' }));
  expect(screen.getByText(STAY.confirm.invite)).toBeInTheDocument();
  expect(screen.queryByText(STAY.confirm.regenerate)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(screen.queryByText(STAY.confirm.invite)).not.toBeInTheDocument();
  expect(api.portierAccessAction).not.toHaveBeenCalled();
});

test('« Supprimer » a stay warns that the reservation will no longer bring it back', async () => {
  const user = userEvent.setup();
  api.deletePortierAccess.mockResolvedValue(null);
  renderGateAccessPage();
  await screen.findByText(STAY.label);
  await user.click(within(rowOf(STAY.label)).getByRole('button', { name: 'Supprimer' }));
  expect(screen.getByText(STAY.confirm.remove)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.deletePortierAccess).toHaveBeenCalledWith(STAY.id));
});

test('suspend and resume go straight to Portier, then the list is read again', async () => {
  const user = userEvent.setup();
  api.portierAccessAction.mockResolvedValue({ access: MANUAL });
  renderGateAccessPage();
  await screen.findByText(MANUAL.label);
  await user.click(within(rowOf(MANUAL.label)).getByRole('button', { name: 'Reprendre' }));
  await waitFor(() => expect(api.portierAccessAction).toHaveBeenCalledWith(MANUAL.id, 'resume'));
  await waitFor(() => expect(api.getPortierAccesses).toHaveBeenCalledTimes(2));
});

test('the page reads Portier again when it comes back to the foreground', async () => {
  renderGateAccessPage();
  await screen.findByText(STAY.label);
  expect(api.getPortierAccesses).toHaveBeenCalledTimes(1);
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(api.getPortierAccesses).toHaveBeenCalledTimes(2));
});

test('Portier unreachable: the page says so, and a list read earlier is not kept on screen as current', async () => {
  renderGateAccessPage();
  await screen.findByText(STAY.label);

  api.getPortierAccesses.mockRejectedValue(Object.assign(new Error('Portier ne répond pas.'), { status: 502 }));
  fireEvent(document, new Event('visibilitychange'));

  expect(await screen.findByText("Portier ne répond pas. La liste n'est pas affichée : rien de mis en cache n'est montré comme actuel.")).toBeInTheDocument();
  expect(screen.queryByText(STAY.label)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
});

test('the finished stays have their own filter', async () => {
  renderGateAccessPage();
  await screen.findByText(STAY.label);
  fireEvent.mouseDown(screen.getByLabelText('Période'));
  fireEvent.click(await screen.findByRole('option', { name: 'Séjours terminés (7 derniers jours)' }));
  await waitFor(() => expect(api.getPortierAccesses).toHaveBeenLastCalledWith({ view: 'finished', kind: 'all' }));
});

test('« Ouvrir dans la liste » from the fiche lands on the access, selected', async () => {
  renderGateAccessPage(`/portail?access=${STAY.id}`);
  await screen.findByText(STAY.label);
  expect(rowOf(STAY.label)).toHaveClass('Mui-selected');
  expect(rowOf(MANUAL.label)).not.toHaveClass('Mui-selected');
});
