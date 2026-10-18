// specs/reservation-number-and-search.md (amended 2026-10-18) — once a number is set it may be the
// platform's own (an intake writes Booking's), so the hint no longer claims it was generated.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ReservationFormProvider } from '../ReservationFormContext';
import StaySection from '../StaySection';
import { makeMockContext } from '../mockReservationForm';

vi.mock('../../MiniPlanningStrip', () => ({ default: () => <div data-testid="mini-planning-strip" /> }));

const renderStay = (overrides) => render(
  <ReservationFormProvider value={makeMockContext(overrides)}>
    <StaySection />
  </ReservationFormProvider>,
);

test('a fiche carrying a number says it is editable, without « généré »', () => {
  renderStay({ form: { reservationNumber: '6392081711' } });
  expect(screen.getByLabelText('Numéro de réservation')).toHaveValue('6392081711');
  expect(screen.getByText('Modifiable')).toBeInTheDocument();
  expect(screen.queryByText(/Généré automatiquement/)).toBeNull();
});

test('a fiche without a number still says one is given at save', () => {
  renderStay({ form: { reservationNumber: '' } });
  expect(screen.getByText('Attribué automatiquement à l\'enregistrement')).toBeInTheDocument();
});
