// specs/planning/mobile-dashboard-exercise-cash.md rules 5, 9 — the identity line of a row about one reservation is a link to its fiche.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import ReservationLinkLine from '../ReservationLinkLine';

let location;
function Probe() { location = useLocation(); return <p>fiche</p>; }

const renderLine = (props, entry = '/') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/" element={<ReservationLinkLine reservationId={12} clientName="Marie Dupont" {...props}><span>Marie Dupont · Le Lodge · Airbnb</span></ReservationLinkLine>} />
      <Route path="/reservations/:id" element={<Probe />} />
    </Routes>
  </MemoryRouter>,
);

test('links to the fiche, coming back to the home, with an accessible name that says whose', () => {
  renderLine();
  const link = screen.getByRole('link', { name: 'Ouvrir la fiche de Marie Dupont' });
  expect(link).toHaveAttribute('href', '/reservations/12?from=%2F');
  expect(link).toHaveTextContent('Marie Dupont · Le Lodge · Airbnb');
});

test('a tap opens the fiche with the `from` parameter', async () => {
  renderLine();
  await userEvent.click(screen.getByRole('link', { name: 'Ouvrir la fiche de Marie Dupont' }));
  expect(location.pathname).toBe('/reservations/12');
  expect(location.search).toBe('?from=%2F');
});

test('another `from` is honoured, and the touch target is 44 px', () => {
  renderLine({ from: '/finance' });
  const link = screen.getByRole('link');
  expect(link).toHaveAttribute('href', '/reservations/12?from=%2Ffinance');
  expect(getComputedStyle(link).minHeight).toBe('44px');
});

test('a fiche that no longer exists is drawn, not linked', () => {
  renderLine({ disabled: true });
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText('Marie Dupont · Le Lodge · Airbnb')).toBeInTheDocument();
});

test('without a name the link still says where it goes', () => {
  renderLine({ clientName: undefined });
  expect(screen.getByRole('link', { name: 'Ouvrir la fiche' })).toBeInTheDocument();
});

test('outside a router it falls back to a plain anchor', () => {
  render(<ReservationLinkLine reservationId={3} clientName="Luc"><span>Luc</span></ReservationLinkLine>);
  expect(screen.getByRole('link', { name: 'Ouvrir la fiche de Luc' })).toHaveAttribute('href', '/reservations/3?from=%2F');
});
