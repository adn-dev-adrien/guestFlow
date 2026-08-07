import React, { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import {
  BrowserRouter,
  MemoryRouter,
  Routes,
  Route,
  Link as RouterLink,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import { Button } from '@mui/material';

// Smoke coverage for the classic react-router-dom API surface GuestFlow relies on
// (spec/react-router-7-migration.md §7.2). Three cases pin the contracts that any
// future v8 (or a hidden v7.x patch) regression would touch:
//   1. <BrowserRouter> mounts the route tree.
//   2. MUI's <Button component={RouterLink}> forwardRef adapter renders a proper
//      anchor with the right href — the exact pattern AccountingPage.js uses to
//      link from a journal entry to its reservation.
//   3. useNavigate() round-trips the pathname under <MemoryRouter>, the
//      foundation of every imperative navigation in the app (28 call sites).
// These cases are deliberately minimal — the E2E suite (Playwright) covers the
// integrated UX; this file is the unit-level tripwire.

describe('react-router-dom classic API smoke', () => {
  test('Case 1: <BrowserRouter> mounts and renders a matching <Route element>', () => {
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<div>ok</div>} />
        </Routes>
      </BrowserRouter>
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  test('Case 2: MUI <Button component={RouterLink}> renders an anchor with the right href', () => {
    // Mirrors AccountingPage.js:347-354 — a MUI Button (or Link) mounted as a
    // react-router <Link> via the `component=` prop. v7 preserves the forwardRef
    // contract MUI needs; if a future bump breaks it, this case catches it.
    render(
      <MemoryRouter>
        <Button component={RouterLink} to="/reservations/42">
          Voir la réservation
        </Button>
      </MemoryRouter>
    );
    const anchor = screen.getByRole('link', { name: /Voir la réservation/i });
    expect(anchor).toHaveAttribute('href', '/reservations/42');
  });

  test('Case 3: useNavigate() round-trips the pathname under <MemoryRouter>', () => {
    function Navigator() {
      const navigate = useNavigate();
      useEffect(() => { navigate('/dest'); }, [navigate]);
      return null;
    }
    function LocationProbe() {
      const location = useLocation();
      return <div data-testid="pathname">{location.pathname}</div>;
    }
    render(
      <MemoryRouter initialEntries={['/origin']}>
        <Routes>
          <Route path="/origin" element={<Navigator />} />
          <Route path="/dest" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('pathname')).toHaveTextContent('/dest');
  });
});
