import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router';
import { vi } from 'vitest';

import ScrollToTop from '../ScrollToTop';

// specs/design-system.md §3.6 — pages must open at the top: React Router preserves scroll between
// routes, so without this reset a page could open mid-content with the sticky bar out of view.

function App() {
  return (
    <MemoryRouter initialEntries={['/a']}>
      <ScrollToTop />
      <Routes>
        <Route path="/a" element={<Link to="/b">go-b</Link>} />
        <Route path="/b" element={<Link to="/a#section">go-anchor</Link>} />
      </Routes>
    </MemoryRouter>
  );
}

test('route change scrolls the window back to the top', () => {
  const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(<App />);
  spy.mockClear(); // ignore the mount-time reset — we assert the navigation one
  fireEvent.click(screen.getByText('go-b'));
  expect(spy).toHaveBeenCalledWith(0, 0);
  spy.mockRestore();
});

test('hash (anchor) navigation does NOT force a scroll reset', () => {
  const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(<App />);
  fireEvent.click(screen.getByText('go-b'));
  spy.mockClear();
  fireEvent.click(screen.getByText('go-anchor')); // → /a#section
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
