// Fixed at the 2026-10-27 spec review (specs/review-2026-10-18-reservations.md rule 8) — the three
// selects of the « Séjour » card carry an accessible name: each InputLabel has an id the Select
// points at (`labelId`). Without it a screen reader announced three unnamed comboboxes.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ReservationFormProvider } from '../ReservationFormContext';
import StaySection from '../StaySection';
import { makeMockContext } from './mockReservationForm';

vi.mock('../../MiniPlanningStrip', () => ({ default: () => <div data-testid="mini-planning-strip" /> }));

test('Logement, Heure d’arrivée and Heure de départ are named comboboxes', () => {
  render(
    <ReservationFormProvider value={makeMockContext()}>
      <StaySection />
    </ReservationFormProvider>,
  );
  expect(screen.getByRole('combobox', { name: 'Logement' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /^Heure d'arrivée/ })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /^Heure de départ/ })).toBeInTheDocument();
});
