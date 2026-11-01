// specs/payment-link-lifecycle.md rule 48 (reading of 2026-11-01, audit R11-C1) — the linked badge asks the page's
// unsaved-changes guard (`window.__guestflowBeforeNavigate`) before it opens the stay; a modified click (new tab)
// is left to the browser.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import DatesTakenBadge from '../DatesTakenBadge';

const MARKER = { label: 'Dates prises', takenBy: { id: 41, label: 'T41 · Lina Exemple · 02/11 → 05/11', url: '/reservations/41' } };

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }

function renderBadge() {
  render(
    <MemoryRouter initialEntries={['/reservations/new']}>
      <Where />
      <Routes><Route path="*" element={<DatesTakenBadge datesTaken={MARKER} />} /></Routes>
    </MemoryRouter>,
  );
  return screen.getByRole('link', { name: `Dates prises par ${MARKER.takenBy.label}` });
}

afterEach(() => { delete window.__guestflowBeforeNavigate; });

test('a guard that blocks keeps the page where it is', () => {
  window.__guestflowBeforeNavigate = vi.fn(() => true);
  fireEvent.click(renderBadge());
  expect(window.__guestflowBeforeNavigate).toHaveBeenCalledWith('/reservations/41');
  expect(screen.getByTestId('where').textContent).toBe('/reservations/new');
});

test('a guard that lets go opens the stay', () => {
  window.__guestflowBeforeNavigate = vi.fn(() => false);
  fireEvent.click(renderBadge());
  expect(screen.getByTestId('where').textContent).toBe('/reservations/41');
});

test('a modified click is left to the browser', () => {
  window.__guestflowBeforeNavigate = vi.fn(() => true);
  const link = renderBadge();
  const event = fireEvent.click(link, { metaKey: true });
  expect(window.__guestflowBeforeNavigate).not.toHaveBeenCalled();
  expect(event).toBe(true);
});
