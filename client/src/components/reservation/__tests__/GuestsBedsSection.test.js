import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import GuestsBedsSection from '../GuestsBedsSection';
import { makeMockContext } from '../mockReservationForm';

function renderGuests(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <ReservationFormProvider value={ctx}>
      <GuestsBedsSection />
    </ReservationFormProvider>
  );
  return ctx;
}

test('renders guest counts, bed counts and the "Suggérer les lits" button', () => {
  renderGuests();
  expect(screen.getByLabelText(/Adultes/)).toBeInTheDocument();
  expect(screen.getByLabelText('Enfants (2 à 12 ans)')).toBeInTheDocument();
  expect(screen.getByLabelText('Ados (12 à 18 ans)')).toBeInTheDocument();
  expect(screen.getByLabelText('Bébés (0 à 2 ans)')).toBeInTheDocument();
  expect(screen.getByLabelText('Lits doubles')).toBeInTheDocument();
  expect(screen.getByLabelText('Lits simples')).toBeInTheDocument();
  expect(screen.getByLabelText('Lits bébé')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Suggérer les lits' })).toBeInTheDocument();
});

test('editing the adults count calls updateForm', () => {
  const ctx = renderGuests();
  fireEvent.change(screen.getByLabelText(/Adultes/), { target: { value: '4' } });
  expect(ctx.updateForm).toHaveBeenCalledWith({ adults: 4 });
});

test('shows the total-capacity warning when the context flags it', () => {
  renderGuests({ exceedsTotalCapacity: true, totalGuestsCount: 10, totalGuestsMax: 8 });
  expect(screen.getByText(/Capacité totale dépassée: 10\/8/)).toBeInTheDocument();
});

test('"Suggérer les lits" calls handleSuggestBeds', async () => {
  const user = userEvent.setup();
  const ctx = renderGuests();
  await user.click(screen.getByRole('button', { name: 'Suggérer les lits' }));
  expect(ctx.handleSuggestBeds).toHaveBeenCalled();
});
