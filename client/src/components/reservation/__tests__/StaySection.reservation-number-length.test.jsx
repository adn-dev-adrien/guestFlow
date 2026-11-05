// specs/reservations-backend-mvc.md rule 24 (audit R23-6) — the field stops at the 64 characters the server holds.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ReservationFormProvider } from '../ReservationFormContext';
import StaySection from '../StaySection';
import { makeMockContext } from './mockReservationForm';

vi.mock('../../MiniPlanningStrip', () => ({ default: () => <div data-testid="mini-planning-strip" /> }));

test('rule 24 — the number input carries maxLength 64', () => {
  render(
    <ReservationFormProvider value={makeMockContext({ form: { reservationNumber: '' } })}>
      <StaySection />
    </ReservationFormProvider>,
  );
  expect(screen.getByLabelText('Numéro de réservation')).toHaveAttribute('maxlength', '64');
});
