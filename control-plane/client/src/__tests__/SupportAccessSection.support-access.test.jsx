// specs/hosting-h2-account-security.md rules 12-14 — the console's « Accès du support » block: ask
// with a reason (refused when empty, with the server's words), the pending state, and « Ouvrir
// l'espace » only while the customer's access is open, opening the signed link in a new tab.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import SupportAccessSection from '../components/SupportAccessSection';
import api from '../api';
import { renderAt, setWidth } from './consoleFixtures';

vi.mock('../api', () => ({ default: { supportState: vi.fn(), supportRequest: vi.fn(), supportLink: vi.fn() } }));

const NONE = { available: true, state: 'none', stateLabel: 'Aucun accès', lastLabel: null, canOpen: false };

beforeEach(() => { setWidth(1280); vi.clearAllMocks(); });

it('rule 12 — a request with its reason; an empty one shows the server\'s refusal on the field', async () => {
  api.supportState.mockResolvedValue(NONE);
  const err = Object.assign(new Error('Motif obligatoire.'), { errors: { reason: 'Motif obligatoire.' } });
  api.supportRequest.mockRejectedValueOnce(err)
    .mockResolvedValueOnce({ ...NONE, state: 'pending', stateLabel: 'En attente de réponse : « Vérifier Booking »' });
  renderAt(<SupportAccessSection customerId={3} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Demander l’accès' }));
  expect(await screen.findByText('Motif obligatoire.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'Vérifier Booking' } });
  fireEvent.click(screen.getByRole('button', { name: 'Demander l’accès' }));
  await waitFor(() => expect(api.supportRequest).toHaveBeenLastCalledWith(3, 'Vérifier Booking'));
  expect(await screen.findByText('En attente de réponse : « Vérifier Booking »')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ouvrir l’espace' })).toBeNull();
});

it('rule 14 — « Ouvrir l\'espace » while open: the signed link opens in a new tab', async () => {
  api.supportState.mockResolvedValue({ ...NONE, state: 'open', stateLabel: 'Ouvert jusqu’au 09/10/2026 14:05', canOpen: true });
  api.supportLink.mockResolvedValue({ url: 'https://aulnes.guestflow.fr/api/auth/support?token=abc', validSeconds: 120 });
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  renderAt(<SupportAccessSection customerId={3} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir l’espace' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://aulnes.guestflow.fr/api/auth/support?token=abc', '_blank', 'noopener'));
  expect(screen.queryByRole('button', { name: 'Demander l’accès' })).toBeNull();
  open.mockRestore();
});

it('rule 17 — an instance that offers nothing says why', async () => {
  api.supportState.mockResolvedValue({ available: false, unavailableReason: 'Instance illisible, ou antérieure aux accès du support.' });
  renderAt(<SupportAccessSection customerId={3} />);
  expect(await screen.findByText('Instance illisible, ou antérieure aux accès du support.')).toBeInTheDocument();
});
