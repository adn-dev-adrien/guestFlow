// specs/gites-de-france-mail-intake.md rules 20–21 — a proposal from an unauthenticated sender warns, and
// a proposal that kept the fiche's e-mail or phone says why.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { BASE } from './intakeFixtures';

const api = vi.hoisted(() => ({ getGdfIntakeForReservation: vi.fn(), applyGdfIntake: vi.fn(), dismissGdfIntake: vi.fn() }));
vi.mock('../../sdk', async () => ({ api, formatCurrency: (n) => `${n} €`, IntakeBanner: (await vi.importActual('../../../components/IntakeBanner')).default }));

import IntakeBanner from '../IntakeBanner';

afterEach(() => vi.clearAllMocks());

test('an unauthenticated sender: « Expéditeur non vérifié », still appliable by hand', async () => {
  api.getGdfIntakeForReservation.mockResolvedValue({ intake: { ...BASE, status: 'proposed', senderUnverified: true } });
  render(<IntakeBanner reservationId={22308} />);
  expect(await screen.findByText('Expéditeur non vérifié')).toBeInTheDocument();
  expect(screen.getByText(/n’est pas signé par la centrale\. Rien n’est rempli tant qu’il n’est pas appliqué\./)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Appliquer' })).toBeInTheDocument();
});

test('a verified sender with contact details kept: the reason is shown, no warning title', async () => {
  api.getGdfIntakeForReservation.mockResolvedValue({ intake: { ...BASE, status: 'proposed', senderUnverified: false, reason: 'E-mail ou téléphone déjà renseigné sur la fiche' } });
  render(<IntakeBanner reservationId={22308} />);
  expect(await screen.findByText('E-mail ou téléphone déjà renseigné sur la fiche')).toBeInTheDocument();
  expect(screen.queryByText('Expéditeur non vérifié')).not.toBeInTheDocument();
});
