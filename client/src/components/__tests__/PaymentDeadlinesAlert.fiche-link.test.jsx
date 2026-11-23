// specs/mobile-dashboard-exercise-cash.md rules 5-6 — each row of « Échéances de paiement » opens its fiche from the identity
// line; the row's buttons stay apart and never navigate.
import { vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPaymentDeadlines: vi.fn(),
    snoozePaymentDeadline: vi.fn(),
    remindPaymentDeadline: vi.fn(),
    cancelReservation: vi.fn(),
    getCancellationPreview: vi.fn(),
  },
}));

import api from '../../api';
import PaymentDeadlinesAlert from '../PaymentDeadlinesAlert';

const ATTENTION = { key: 'payment-deadlines', severity: 'todo', count: 2, title: 'Échéances de paiement', detail: '2 en retard' };
const ROW = {
  reservationId: 10, state: 'balance_overdue', clientName: 'Marie Dupont', propertyName: 'Le Lodge', platformLabel: 'Booking',
  // date-literal-ok: a server payload the component renders as given; nothing compares it with today
  startDate: '2026-09-18', endDate: '2026-09-25', depositDue: 0, balanceDue: 640, totalDue: 640, dueDate: '2026-08-09', daysLate: 10,
  canCancel: false, retainedDepositAmount: 0, canRemind: true, remindType: 'balance', requestSent: true,
};
const OTHER = { ...ROW, reservationId: 11, clientName: 'Luc Martin', platformLabel: null };

let location;
function Probe() { location = useLocation(); return <p>fiche</p>; }

const renderCard = () => render(
  <MemoryRouter initialEntries={['/']}>
    <DialogProvider>
      <Routes>
        <Route path="/" element={<PaymentDeadlinesAlert attention={ATTENTION} />} />
        <Route path="/reservations/:id" element={<Probe />} />
      </Routes>
    </DialogProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.getPaymentDeadlines.mockResolvedValue({ rows: [ROW, OTHER] });
  api.snoozePaymentDeadline.mockResolvedValue({});
});

test('the identity line of each row links to its fiche, back to the home', async () => {
  renderCard();
  const link = await screen.findByRole('link', { name: 'Ouvrir la fiche de Marie Dupont' });
  expect(link).toHaveTextContent('Marie Dupont · Le Lodge · Booking');
  expect(link).toHaveAttribute('href', '/reservations/10?from=%2F');
  expect(screen.getByRole('link', { name: 'Ouvrir la fiche de Luc Martin' })).toHaveAttribute('href', '/reservations/11?from=%2F');
});

test('tapping the identity line goes to the fiche', async () => {
  renderCard();
  await userEvent.click(await screen.findByRole('link', { name: 'Ouvrir la fiche de Marie Dupont' }));
  expect(location.pathname).toBe('/reservations/10');
  expect(location.search).toBe('?from=%2F');
});

test('the buttons do not navigate and are not inside the link', async () => {
  renderCard();
  const link = await screen.findByRole('link', { name: 'Ouvrir la fiche de Marie Dupont' });
  expect(within(link).queryByRole('button')).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Reporter' })[0]);
  expect(api.snoozePaymentDeadline).toHaveBeenCalledWith(10, 7);
  expect(screen.queryByText('fiche')).toBeNull();
});
