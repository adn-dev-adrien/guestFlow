// specs/payment-link-lifecycle.md rule 48 — « Dates prises » prints the server's marker and opens the stay that took
// the nights; nothing without a marker; a list row's badge is not a link (the row opens the devis).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DatesTakenBadge from '../DatesTakenBadge';

const MARKER = { label: 'Dates prises', takenBy: { id: 41, label: 'T41 · Lina Exemple · 02/11 → 05/11', url: '/reservations/41' } };

test('the marker opens the stay that took the dates', () => {
  render(<MemoryRouter><DatesTakenBadge datesTaken={MARKER} /></MemoryRouter>);
  const link = screen.getByRole('link', { name: 'Dates prises par T41 · Lina Exemple · 02/11 → 05/11' });
  expect(link).toHaveAttribute('href', '/reservations/41');
});

test('a list row shows the label without a link', () => {
  render(<MemoryRouter><DatesTakenBadge datesTaken={MARKER} linked={false} /></MemoryRouter>);
  expect(screen.getByText('Dates prises')).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
});

test('no marker, no badge', () => {
  const { container } = render(<MemoryRouter><DatesTakenBadge datesTaken={null} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});

test('review of #907 (m4): the linked badge carries the 44 px touch hit area', () => {
  render(<MemoryRouter><DatesTakenBadge datesTaken={MARKER} /></MemoryRouter>);
  const link = screen.getByRole('link');
  const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules || [])).map((r) => r.cssText).join('\n');
  expect(link.className).toMatch(/MuiChip/);
  expect(rules).toMatch(/pointer:\s*coarse/);
});
