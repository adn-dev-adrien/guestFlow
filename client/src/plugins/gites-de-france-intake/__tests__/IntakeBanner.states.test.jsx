// specs/server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
// specs/gites-de-france-mail-intake.md rules 11–13 — applied, proposal, error, nothing.
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { BASE } from './intakeFixtures';

const api = vi.hoisted(() => ({ getGdfIntakeForReservation: vi.fn(), applyGdfIntake: vi.fn(), dismissGdfIntake: vi.fn() }));
vi.mock('../../sdk', async () => ({ api, formatCurrency: (n) => `${n} €`, IntakeBanner: (await vi.importActual('../../../components/IntakeBanner')).default }));

import IntakeBanner from '../IntakeBanner';

afterEach(() => vi.clearAllMocks());

test('applied: says where the values come from, lists the lines added as is, can be closed', async () => {
  api.getGdfIntakeForReservation.mockResolvedValueOnce({ intake: { ...BASE, status: 'applied', customLines: [{ label: 'Panier petit-déjeuner', amount: 24 }] } })
    .mockResolvedValue({ intake: null });
  api.dismissGdfIntake.mockResolvedValue({ ok: true });
  render(<IntakeBanner reservationId={22308} />);
  expect(await screen.findByText(/Rempli depuis le mail Gîtes de France du 14\/10 à 18:32/)).toBeInTheDocument();
  expect(screen.getByText(/« Panier petit-déjeuner » 24 €/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(api.dismissGdfIntake).toHaveBeenCalledWith(1);
  await waitFor(() => expect(screen.queryByText(/Rempli depuis/)).not.toBeInTheDocument());
});

test('proposal on a fiche already edited: Appliquer writes, Ignorer dismisses', async () => {
  api.getGdfIntakeForReservation.mockResolvedValue({ intake: { ...BASE, status: 'proposed' } });
  api.applyGdfIntake.mockResolvedValue({ status: 'applied' });
  render(<IntakeBanner reservationId={22308} onReservationChanged={() => {}} />);
  expect(await screen.findByText(/déjà modifiée à la main/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
  expect(api.applyGdfIntake).toHaveBeenCalledWith(1);
});

test('error: shows the reason', async () => {
  api.getGdfIntakeForReservation.mockResolvedValue({ intake: { ...BASE, status: 'error', error: 'Aucun logement n’est relié au gîte n°309700' } });
  render(<IntakeBanner reservationId={22308} />);
  expect(await screen.findByText(/n’a pas pu être appliqué : Aucun logement/)).toBeInTheDocument();
});

test('no intake, or one still pending: nothing at all', async () => {
  api.getGdfIntakeForReservation.mockResolvedValue({ intake: { ...BASE, status: 'pending' } });
  const { container } = render(<IntakeBanner reservationId={22308} />);
  await act(() => api.getGdfIntakeForReservation.mock.results.at(-1).value);
  expect(api.getGdfIntakeForReservation).toHaveBeenCalled();
  expect(container).toBeEmptyDOMElement();
});
