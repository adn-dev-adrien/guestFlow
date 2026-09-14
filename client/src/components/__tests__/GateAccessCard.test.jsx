// specs/gate-access-portier.md §3.2 — the fiche's compact « Accès portail » card, read from Portier.
import { vi, beforeEach, test, expect } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getReservationGateAccess: vi.fn(), portierAccessAction: vi.fn() },
}));

import api from '../../api';
import GateAccessCard from '../GateAccessCard';

const ACCESS = {
  id: '6f1c2a9e-3b7d-4c55-9a10-2e8f4b6d7c01', state: 'active', stateLabel: 'actif', deleted: false,
  window: 'Du 12/09 à 16:00 au 14/09 à 11:00', phones: '2 téléphones', lastUse: 'il y a 3 h',
};

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderCard(reservationId = 42) {
  return render(
    <MemoryRouter initialEntries={['/reservations/42']}>
      <DialogProvider>
        <Routes>
          <Route path="/reservations/:id" element={<GateAccessCard reservationId={reservationId} />} />
          <Route path="/portail" element={<Where />} />
        </Routes>
      </DialogProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

test('state, window in force, phones and last use; « Ouvrir dans la liste » leads to the access', async () => {
  const user = userEvent.setup();
  api.getReservationGateAccess.mockResolvedValue({ status: 'ok', banner: '', access: ACCESS });
  renderCard();
  expect(await screen.findByText('Du 12/09 à 16:00 au 14/09 à 11:00')).toBeInTheDocument();
  expect(api.getReservationGateAccess).toHaveBeenCalledWith(42);
  expect(screen.getByText('actif')).toBeInTheDocument();
  expect(screen.getByText('2 téléphones · dernier usage : il y a 3 h')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ouvrir dans la liste' }));
  expect(screen.getByTestId('where')).toHaveTextContent(`/portail?access=${ACCESS.id}`);
});

test('an access deleted in the list: said so, with « Recréer » after a confirmation', async () => {
  const user = userEvent.setup();
  api.getReservationGateAccess.mockResolvedValue({ status: 'ok', banner: '', access: { ...ACCESS, state: 'deleted', stateLabel: 'supprimé', deleted: true } });
  api.portierAccessAction.mockResolvedValue({ access: {} });
  renderCard();
  expect(await screen.findByText('Accès supprimé dans la liste.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Recréer' }));
  expect(await screen.findByText(/nouvelle clé et un nouveau code/)).toBeInTheDocument();
  expect(api.portierAccessAction).not.toHaveBeenCalled();
  const confirmButtons = screen.getAllByRole('button', { name: 'Recréer' });
  await user.click(confirmButtons[confirmButtons.length - 1]);
  await waitFor(() => expect(api.portierAccessAction).toHaveBeenCalledWith(ACCESS.id, 'recreate'));
});

test('a push failing for more than an hour shows its banner, even when Portier does not answer', async () => {
  api.getReservationGateAccess.mockResolvedValue({ status: 'unavailable', banner: "Portier n'a pas reçu la dernière modification" });
  renderCard();
  expect(await screen.findByText("Portier n'a pas reçu la dernière modification")).toBeInTheDocument();
  expect(screen.getByText("Portier ne répond pas : l'état de l'accès n'est pas affiché.")).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
});

test('nothing for a devis, nothing for a role the server keeps out', async () => {
  api.getReservationGateAccess.mockResolvedValueOnce({ status: 'none' });
  const devis = renderCard();
  await waitFor(() => expect(api.getReservationGateAccess).toHaveBeenCalled());
  expect(screen.queryByText('Accès portail')).not.toBeInTheDocument();
  devis.unmount();

  api.getReservationGateAccess.mockRejectedValueOnce(Object.assign(new Error('FORBIDDEN_ROLE'), { status: 403 }));
  renderCard();
  await waitFor(() => expect(api.getReservationGateAccess).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText('Accès portail')).not.toBeInTheDocument());
});
