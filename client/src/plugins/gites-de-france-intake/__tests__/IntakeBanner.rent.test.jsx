// specs/gites-de-france-mail-intake.md rules 7, 12 — two rents fit the net: one button each.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { BASE } from './intakeFixtures';

const api = vi.hoisted(() => ({ getGdfIntakeForReservation: vi.fn(), applyGdfIntake: vi.fn(), dismissGdfIntake: vi.fn() }));
vi.mock('../../sdk', async () => ({ api, formatCurrency: (n) => `${n} €`, IntakeBanner: (await vi.importActual('../../../components/IntakeBanner')).default }));

import IntakeBanner from '../IntakeBanner';

test('offers both rents with their commission, applies the chosen one and reloads the fiche', async () => {
  api.getGdfIntakeForReservation.mockResolvedValueOnce({ intake: { ...BASE, status: 'needs_rent' } })
    .mockResolvedValue({ intake: { ...BASE, status: 'applied' } });
  api.applyGdfIntake.mockResolvedValue({ status: 'applied' });
  const onChanged = vi.fn();
  render(<IntakeBanner reservationId={22308} onReservationChanged={onChanged} />);

  expect(await screen.findByText('Prix de location : 504 € ou 505 € ?')).toBeInTheDocument();
  expect(screen.getByText('commission 51 €')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Voir le dossier sur ITEA' })).toHaveAttribute('href', BASE.iteaUrl);

  await userEvent.click(screen.getByRole('button', { name: /504 €/ }));
  expect(api.applyGdfIntake).toHaveBeenCalledWith(1, { rent: 504 });
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(await screen.findByText(/Rempli depuis le mail Gîtes de France du 14\/10 à 18:32/)).toBeInTheDocument();
});
