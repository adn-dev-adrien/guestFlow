// specs/plugins-phase-3c-hourly-resources.md amendment 2026-11-13 — the planning card of a booking
// outside a stay opens that booking in Calendrier › Ressources.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';

import PlanningResourceCard from '../PlanningResourceCard';
import { localIsoDate } from '../localDate';

vi.mock('../../../api', () => ({ default: {} }));
vi.mock('../../../components/DialogProvider', () => ({ useToast: () => ({ showError: vi.fn() }) }));

const BOOKING = {
  // date-literal-ok: an address to follow, never compared with today
  id: 12, resourceId: 3, resourceName: 'Bain nordique', date: '2026-11-20', startTime: '18:00', endTime: '19:00',
  displayName: 'Dupont', paid: false, external: true, arrived: false,
};

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

const renderCard = (item, onOpenReservation) => render(
  <MemoryRouter initialEntries={['/planning']}>
    <Routes>
      <Route path="/planning" element={<PlanningResourceCard entry={{ key: `rb-${item.id}`, time: item.startTime, kind: 'booking', item }} reload={vi.fn()} onOpenReservation={onOpenReservation} />} />
      <Route path="/resource-planning" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

test('a click on the card opens the booking on its resource and week', () => {
  renderCard(BOOKING, vi.fn());
  fireEvent.click(screen.getByRole('button', { name: /Ouvrir la réservation Bain nordique 18:00–19:00/ }));
  // date-literal-ok: an address to follow, never compared with today
  expect(screen.getByTestId('where').textContent).toBe('/resource-planning?booking=12&resource=3&date=2026-11-20');
});

test('Enter on the focused card opens it too', () => {
  renderCard(BOOKING, vi.fn());
  fireEvent.keyDown(screen.getByRole('button', { name: /Ouvrir la réservation/ }), { key: 'Enter' });
  expect(screen.getByTestId('where').textContent).toContain('booking=12');
});

test('« Arrivée » still opens the arrival, not the booking', () => {
  renderCard({ ...BOOKING, date: localIsoDate() }, vi.fn());
  fireEvent.click(screen.getByRole('button', { name: 'Arrivée' }));
  expect(screen.getByTestId('where').textContent).toBe('/resource-planning?arrival=12');
});

test('the reception planning (no reservation opening) keeps the card inert', () => {
  renderCard(BOOKING, undefined);
  expect(screen.queryByRole('button', { name: /Ouvrir la réservation/ })).toBeNull();
});
