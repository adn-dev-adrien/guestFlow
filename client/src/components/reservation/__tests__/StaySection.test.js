import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import StaySection from '../StaySection';
import { makeMockContext } from '../mockReservationForm';

jest.mock('../../MiniPlanningStrip', () => () => <div data-testid="mini-planning-strip" />);

function renderStay(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <ReservationFormProvider value={ctx}>
      <StaySection />
    </ReservationFormProvider>
  );
  return ctx;
}

test('renders property select, both date fields, the time selects and the mini-calendar host', () => {
  renderStay();
  // Three MUI Selects in DOM order: Logement, Heure d'arrivée, Heure de départ.
  expect(screen.getAllByRole('combobox')).toHaveLength(3);
  expect(screen.getAllByText('Logement').length).toBeGreaterThan(0);
  expect(screen.getByLabelText("Date d'arrivée")).toBeInTheDocument();
  expect(screen.getByLabelText('Date de départ')).toBeInTheDocument();
  expect(screen.getAllByText(/Heure d'arrivée/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Heure de départ/).length).toBeGreaterThan(0);
  expect(screen.getByTestId('mini-planning-strip')).toBeInTheDocument();
});

test('changing the arrival date calls handleManualDateInputChange', () => {
  const ctx = renderStay();
  fireEvent.change(screen.getByLabelText("Date d'arrivée"), { target: { value: '2026-07-01' } });
  expect(ctx.handleManualDateInputChange).toHaveBeenCalledWith({ startDate: '2026-07-01' });
});

test('changing the check-in time calls updateForm', async () => {
  const user = userEvent.setup();
  const ctx = renderStay();
  // Combobox index 1 is the check-in time select (index 0 = Logement).
  await user.click(screen.getAllByRole('combobox')[1]);
  const listbox = await screen.findByRole('listbox');
  await user.click(within(listbox).getByText('16:00'));
  expect(ctx.updateForm).toHaveBeenCalledWith({ checkInTime: '16:00' });
});

test('shows the min-nights and unavailability hints when the context flags them', () => {
  renderStay({
    minNightsState: { breached: true, required: 3, nights: 1 },
    minNightsWarning: 'Séjour trop court: 1 nuit(s) pour un minimum saisonnier de 3 nuit(s).',
    datesUnavailableForProperty: true,
    datesUnavailableMessage: 'Ces dates ne sont pas dispo pour ce logement.',
    liveTimeConflictMessage: 'Conflit horaire',
  });
  expect(screen.getByText(/Séjour trop court/)).toBeInTheDocument();
  expect(screen.getByText('Ces dates ne sont pas dispo pour ce logement.')).toBeInTheDocument();
  expect(screen.getByText('Conflit horaire')).toBeInTheDocument();
});
