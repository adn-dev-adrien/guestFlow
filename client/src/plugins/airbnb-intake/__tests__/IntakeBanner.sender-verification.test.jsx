// specs/airbnb-mail-intake.md rule 22 — a proposal from an unauthenticated sender warns.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const api = vi.hoisted(() => ({ getAirbnbIntakeForReservation: vi.fn(), applyAirbnbIntake: vi.fn(), dismissAirbnbIntake: vi.fn() }));
vi.mock('../../sdk', async () => ({ api, IntakeBanner: (await vi.importActual('../../../components/IntakeBanner')).default }));

import IntakeBanner from '../IntakeBanner';

afterEach(() => vi.clearAllMocks());

const BASE = { id: 1, receivedLabel: '14/10', code: 'HMABC12345', airbnbUrl: null, error: null };

test('an unauthenticated sender: « Expéditeur non vérifié », still appliable by hand', async () => {
  api.getAirbnbIntakeForReservation.mockResolvedValue({ intake: { ...BASE, status: 'proposed', senderUnverified: true } });
  render(<IntakeBanner reservationId={22326} />);
  expect(await screen.findByText('Expéditeur non vérifié')).toBeInTheDocument();
  expect(screen.getByText(/n’a pas été signé par Airbnb/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Appliquer' })).toBeInTheDocument();
});

test('a verified sender on an edited fiche keeps the usual proposal text', async () => {
  api.getAirbnbIntakeForReservation.mockResolvedValue({ intake: { ...BASE, status: 'proposed', senderUnverified: false } });
  render(<IntakeBanner reservationId={22326} />);
  expect(await screen.findByText(/déjà modifiée à la main/)).toBeInTheDocument();
  expect(screen.queryByText('Expéditeur non vérifié')).not.toBeInTheDocument();
});
