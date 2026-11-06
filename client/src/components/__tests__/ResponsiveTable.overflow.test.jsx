import React from 'react';
import { render, screen } from '@testing-library/react';
import { TableRow, TableCell } from '@mui/material';
import { afterEach, vi } from 'vitest';

import ResponsiveTable from '../ResponsiveTable';

// specs/tourist-tax-report-v2.md rules 48 and 53 (reviews V2-5, V3R-2) — `cardsWhenOverflow`: the table, MEASURED, wider than its
// container gives way to the cards, so no container width ever scrolls the table inside its card (the fixed
// `cardsBelowWidth` let 860–877 px show a 878 px table scrolling by 18 px).

const props = {
  items: [{ id: 1, name: 'Marie' }],
  getKey: (r) => r.id,
  head: <TableRow><TableCell>Client</TableCell></TableRow>,
  renderRow: (r) => <TableRow key={r.id}><TableCell>row {r.name}</TableCell></TableRow>,
  renderMobileCard: (r) => <span>card {r.name}</span>,
  minWidth: 860,
};

const withWidths = ({ container, table }) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ width: container, height: 100, top: 0, left: 0, right: container, bottom: 100, x: 0, y: 0 });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function scrollWidth() {
    return this.tagName === 'TABLE' ? table : container;
  });
};

afterEach(() => vi.restoreAllMocks());

test('rule 48: a table measured wider than its container (870 < 878) renders cards, above the fixed threshold too', () => {
  withWidths({ container: 870, table: 878 });
  render(<ResponsiveTable {...props} cardsBelowWidth={860} cardsWhenOverflow />);
  expect(screen.getByText('card Marie')).toBeInTheDocument();
  expect(screen.queryByText('row Marie')).toBeNull();
});

test('rule 48: a table that fits its container stays a table', () => {
  withWidths({ container: 900, table: 900 });
  render(<ResponsiveTable {...props} cardsBelowWidth={860} cardsWhenOverflow />);
  expect(screen.getByText('row Marie')).toBeInTheDocument();
});

test('rule 48: without the flag, the fixed threshold alone decides (870 ≥ 860: a table)', () => {
  withWidths({ container: 870, table: 878 });
  render(<ResponsiveTable {...props} cardsBelowWidth={860} />);
  expect(screen.getByText('row Marie')).toBeInTheDocument();
});

test('rule 53: in the overflow band, new rows keep the cards mounted and the focus where it was', () => {
  withWidths({ container: 870, table: 878 });
  const cardProps = { ...props, renderMobileCard: (r) => <label>card {r.name}<input type="checkbox" aria-label={`box ${r.name}`} /></label> };
  const { rerender } = render(<ResponsiveTable {...cardProps} cardsBelowWidth={860} cardsWhenOverflow />);
  const box = screen.getByLabelText('box Marie');
  box.focus();
  expect(document.activeElement).toBe(box);
  rerender(<ResponsiveTable {...cardProps} items={[{ id: 1, name: 'Marie' }]} cardsBelowWidth={860} cardsWhenOverflow />);
  expect(screen.getByLabelText('box Marie')).toBe(box);
  expect(document.activeElement).toBe(box);
});

test('rule 53: a new column set (another minWidth) is measured afresh', () => {
  withWidths({ container: 870, table: 878 });
  const { rerender } = render(<ResponsiveTable {...props} cardsBelowWidth={700} cardsWhenOverflow />);
  expect(screen.getByText('card Marie')).toBeInTheDocument();
  vi.restoreAllMocks();
  withWidths({ container: 870, table: 700 });
  rerender(<ResponsiveTable {...props} minWidth={700} cardsBelowWidth={700} cardsWhenOverflow />);
  expect(screen.getByText('row Marie')).toBeInTheDocument();
});
