/**
 * YearOverYearBadge — specs/finance-dashboard-redesign.md rules 18 and 20: hidden without a
 * comparison, and saying when it only covers part of the window.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import YearOverYearBadge from '../YearOverYearBadge';

test('rule 18 — no comparison, no badge', () => {
  const { container } = render(<YearOverYearBadge change={null} />);
  expect(container).toBeEmptyDOMElement();
});

test('rule 20 — a partial comparison names its comparable months', () => {
  render(<YearOverYearBadge change={12.34} months={1} totalMonths={12} />);
  expect(screen.getByText('▲ +12,3 % vs N-1 · sur 1 mois comparable')).toBeInTheDocument();
});

test('rule 20 — a full-window drop, and a near-zero change reads as stable', () => {
  const { rerender } = render(<YearOverYearBadge change={-8} months={12} totalMonths={12} />);
  expect(screen.getByText('▼ −8 % vs N-1')).toBeInTheDocument();
  rerender(<YearOverYearBadge change={-0.2} />);
  expect(screen.getByText('= stable vs N-1')).toBeInTheDocument();
});
