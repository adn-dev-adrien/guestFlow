// Shared by the fiche's loader suites (specs/reservations-backend-mvc.md rules 16-17): a fiche with an arrival
// and a departure the test moves, and answers it holds back. `vi.mock(...)` stays in each test file.
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';
import ReservationPage from '../ReservationPage';

export const dayIn = (n) => addIsoDays(localIsoToday(), n);

export const STAY = {
  id: 7001, kind: 'reservation', clientId: 1, propertyId: 1, startDate: dayIn(30), endDate: dayIn(33),
  platform: 'direct', adults: 2, reservationNumber: '20997001', options: [], resources: [], customOptions: [],
  depositAmount: 90, depositPaid: 0, balanceAmount: 210, balancePaid: 0, finalPrice: 300, updatedAt: `${localIsoToday()} 10:00:00`,
};

export function seedFiche(api, stay = STAY) {
  api.getToday.mockResolvedValue({ today: localIsoToday() });
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, defaultCheckIn: '16:00', defaultCheckOut: '10:00' }]);
  api.getProperty.mockResolvedValue({ id: 1, name: 'Granja', options: [], optionGroups: { ungrouped: [] }, resources: [] });
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont', email: 'jean@example.test' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  api.getResourcesAvailability.mockResolvedValue([]);
  api.getBabyBedAvailability.mockResolvedValue({ totalQuantity: 3, reserved: 0, available: 3 });
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue(stay);
}

export function openPage(path = `/reservations/${STAY.id}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationPage />} />
          <Route path="/reservations/:reservationId" element={<ReservationPage />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

export async function arrivalField(expected = STAY.startDate) {
  const arrival = await screen.findByLabelText("Date d'arrivée");
  await waitFor(() => expect(arrival).toHaveValue(expected));
  return arrival;
}

export const moveArrival = (field, day) => fireEvent.change(field, { target: { value: day } });

// A mock that answers some calls by hand: `hold(key)` leaves the next call naming `key` pending until released.
export function heldAnswers(mock, keyOf, fallback) {
  const held = new Map();
  mock.mockImplementation((...args) => {
    const key = keyOf(...args);
    if (!held.has(key)) return Promise.resolve(fallback(key));
    return held.get(key).promise;
  });
  return {
    hold(key) {
      let release;
      let refuse;
      const promise = new Promise((resolve, reject) => { release = resolve; refuse = reject; });
      held.set(key, { promise, release, refuse });
    },
    async release(key, answer) {
      await act(async () => {
        held.get(key).release(answer);
        await Promise.resolve();
      });
    },
    async refuse(key, error) {
      await act(async () => {
        held.get(key).refuse(error);
        await Promise.resolve();
      });
    },
  };
}
