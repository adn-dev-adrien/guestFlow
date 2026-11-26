// specs/gift-vouchers/gift-voucher-campaigns.md rule 35 — the planning card of an outside booking is the preparation ticket: the badge of what was paid in advance and every option to prepare,
// both read from the server's `badges` and `options`, and a link to the booking's fiche.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import PlanningResourceCard from '../PlanningResourceCard';

vi.mock('../../../api', () => ({ default: {} }));
vi.mock('../../../components/DialogProvider', () => ({ useToast: () => ({ showError: vi.fn() }) }));

const BOOKING = {
  // date-literal-ok: an address to follow, never compared with today
  id: 12, resourceId: 3, resourceName: 'Bain nordique', date: '2099-03-04', startTime: '18:00', endTime: '19:00',
  displayName: 'Dupont', external: true, arrived: false,
  badges: [{ label: 'Bon cadeau' }],
  options: [{ label: 'Thé', quantity: 2 }, { label: 'Peignoir', quantity: 1 }],
};

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;
const renderCard = (item, onOpenReservation = vi.fn(), ...none) => render(
  <MemoryRouter initialEntries={['/planning']}>
    <Routes>
      <Route path="/planning" element={<PlanningResourceCard entry={{ key: 'rb', time: item.startTime, kind: 'booking', item }} reload={vi.fn()} onOpenReservation={none.length ? undefined : onOpenReservation} />} />
      <Route path="/passages/:id" element={<Where />} />
      <Route path="/resource-planning" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

test('the badge and every option to prepare are shown under the client', () => {
  renderCard(BOOKING);
  expect(screen.getByText('Bon cadeau')).toBeInTheDocument();
  const list = screen.getByRole('list', { name: 'À préparer' });
  expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['2 × Thé', 'Peignoir']);
});

test('« Ouvrir la fiche » goes to the fiche, not to the booking editor', () => {
  renderCard(BOOKING);
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la fiche' }));
  expect(screen.getByTestId('where').textContent).toBe('/passages/12');
});

test('a booking with no badge and no option draws neither', () => {
  renderCard({ ...BOOKING, badges: [], options: [] });
  expect(screen.queryByRole('list', { name: 'À préparer' })).toBeNull();
  expect(screen.queryByText('Bon cadeau')).toBeNull();
});

test('the inert reception card offers no link to the fiche', () => {
  renderCard(BOOKING, undefined, 'inert');
  expect(screen.queryByRole('button', { name: 'Ouvrir la fiche' })).toBeNull();
});
