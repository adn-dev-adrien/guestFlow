import React from 'react';
import { render, screen } from '@testing-library/react';
import { TableRow, TableCell } from '@mui/material';
import { afterEach, vi } from 'vitest';

import ResponsiveTable from '../ResponsiveTable';

// specs/ds-components.md §3.1 (2026-10-27 audit) — on the Dashboard at 900 and 1280 px the arrivals
// table (min 1080 px) sat next to the drawer and hid Note / Paiements / Caution in a scroller nobody
// noticed. `cardsBelowWidth` switches to cards when the CONTAINER is too narrow, whatever the viewport.

const props = {
  items: [{ id: 1, name: 'Marie' }],
  getKey: (r) => r.id,
  head: <TableRow><TableCell>Client</TableCell></TableRow>,
  renderRow: (r) => <TableRow key={r.id}><TableCell>row {r.name}</TableCell></TableRow>,
  renderMobileCard: (r) => <span>card {r.name}</span>,
  minWidth: 940,
};

const withWidth = (width) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
  .mockReturnValue({ width, height: 100, top: 0, left: 0, right: width, bottom: 100, x: 0, y: 0 });

afterEach(() => vi.restoreAllMocks());

test('a container narrower than the table renders cards', () => {
  withWidth(612);
  render(<ResponsiveTable {...props} cardsBelowWidth={940} />);
  expect(screen.getByText('card Marie')).toBeInTheDocument();
  expect(screen.queryByText('row Marie')).toBeNull();
});

test('a container wide enough keeps the table', () => {
  withWidth(977);
  render(<ResponsiveTable {...props} cardsBelowWidth={940} />);
  expect(screen.getByText('row Marie')).toBeInTheDocument();
});

test('without cardsBelowWidth the width is ignored (other pages unchanged)', () => {
  withWidth(300);
  render(<ResponsiveTable {...props} />);
  expect(screen.getByText('row Marie')).toBeInTheDocument();
});
