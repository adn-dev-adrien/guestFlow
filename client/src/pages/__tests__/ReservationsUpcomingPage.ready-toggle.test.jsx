// specs/upcoming-reservations-cards.md rule 8 — the « prêt » box answers at once and only its day is
// asked again; with 500 stays each click used to re-read the whole season (2.4 MB, ~0.7 s) before
// the box moved (review of PR #700, finding 3).
import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getUpcomingReservations: vi.fn(),
    markPayment: vi.fn(),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ alerts: [] }),
  },
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));

import api from '../../api';
import ReservationsUpcomingPage from '../ReservationsUpcomingPage';

const stay = (id, startDate, over = {}) => ({
  id, firstName: 'Client', lastName: `N${id}`, propertyName: 'Gite', platform: 'direct', startDate,
  endDate: '2099-01-09', checkInTime: '15:00', adults: 2, teens: 0, children: 0, babies: 0,
  options: [], resources: [], checkInReady: 0, ...over,
});
const day = (date, label, reservations) => {
  const readyCount = reservations.filter((r) => r.checkInReady).length;
  return { date, label, isToday: false, reservations, readyCount, total: reservations.length, allReady: readyCount === reservations.length };
};
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider>
        <ReservationsUpcomingPage />
      </DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

const boxOf = (name) => within(screen.getByText(name, { exact: false }).closest('.MuiCard-root')).getByRole('checkbox');

beforeEach(() => { vi.clearAllMocks(); });

test('rule 8 — the box is ticked before the server answers; only its day is asked again', async () => {
  api.getUpcomingReservations.mockResolvedValueOnce({ today: '2026-10-18', days: [
    day('2026-11-02', 'lundi 2 novembre', [stay(1, '2026-11-02')]),
    day('2026-11-05', 'jeudi 5 novembre', [stay(2, '2026-11-05')]),
  ] });
  const save = deferred();
  api.markPayment.mockReturnValue(save.promise);
  api.getUpcomingReservations.mockResolvedValueOnce({ today: '2026-10-18', days: [day('2026-11-02', 'lundi 2 novembre', [stay(1, '2026-11-02', { checkInReady: 1 })])] });
  renderPage();
  await screen.findByText('N1', { exact: false });
  fireEvent.click(boxOf('N1'));
  expect(boxOf('N1')).toBeChecked();
  expect(screen.getAllByText('0/1')).toHaveLength(2);
  save.resolve({});
  expect(await screen.findByText('1/1')).toBeInTheDocument();
  expect(api.getUpcomingReservations).toHaveBeenLastCalledWith('2026-11-02');
  expect(screen.getByText('jeudi 5 novembre', { exact: false })).toBeInTheDocument();
  expect(screen.queryByText('Chargement des réservations…')).not.toBeInTheDocument();
});

test('rule 8 — a refused save puts the box back and says so', async () => {
  api.getUpcomingReservations.mockResolvedValueOnce({ today: '2026-10-18', days: [day('2026-11-02', 'lundi 2 novembre', [stay(1, '2026-11-02')])] });
  api.markPayment.mockRejectedValue(new Error('Réservation introuvable.'));
  renderPage();
  await screen.findByText('N1', { exact: false });
  fireEvent.click(boxOf('N1'));
  expect(await screen.findByText('Réservation introuvable.')).toBeInTheDocument();
  expect(boxOf('N1')).not.toBeChecked();
  expect(api.getUpcomingReservations).toHaveBeenCalledTimes(1);
});

test('rule 8 — a late recount of a day never overwrites a newer one', async () => {
  api.getUpcomingReservations.mockResolvedValueOnce({ today: '2026-10-18', days: [day('2026-11-02', 'lundi 2 novembre', [stay(1, '2026-11-02'), stay(2, '2026-11-02')])] });
  api.markPayment.mockResolvedValue({});
  const first = deferred();
  const second = deferred();
  api.getUpcomingReservations.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  renderPage();
  await screen.findByText('0/2');
  fireEvent.click(boxOf('N1'));
  await waitFor(() => expect(api.getUpcomingReservations).toHaveBeenCalledTimes(2));
  fireEvent.click(boxOf('N2'));
  await waitFor(() => expect(api.getUpcomingReservations).toHaveBeenCalledTimes(3));
  second.resolve({ today: '2026-10-18', days: [day('2026-11-02', 'lundi 2 novembre', [stay(1, '2026-11-02', { checkInReady: 1 }), stay(2, '2026-11-02', { checkInReady: 1 })])] });
  expect(await screen.findByText('2/2')).toBeInTheDocument();
  first.resolve({ today: '2026-10-18', days: [day('2026-11-02', 'lundi 2 novembre', [stay(1, '2026-11-02', { checkInReady: 1 }), stay(2, '2026-11-02')])] });
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.getByText('2/2')).toBeInTheDocument();
  expect(boxOf('N2')).toBeChecked();
});
