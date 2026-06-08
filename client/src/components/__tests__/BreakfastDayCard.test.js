import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import BreakfastDayCard from '../BreakfastDayCard';

// specs/breakfast-option-and-planning-card.md §6.1 + §7.2 + 2026-06-06 redesign.
// Renderer-only contract:
//   - hidden when data is missing or items is empty;
//   - per-row format `{propertyName} • {clientName} : {N} petit(s) déjeuner(s)` with a
//     leading HomeWorkIcon (same icon family as the arrival / departure cards) and a
//     header BreakfastDining croissant sized up;
//   - total uses "petit déjeuner" / "petits déjeuners" pluralization.
//   - when onItemClick is provided, each row becomes a `button` role with keyboard
//     support; without the prop the rows stay inert (read-only contract).

test('data undefined → renders nothing (no DOM)', () => {
  const { container } = render(<BreakfastDayCard data={undefined} />);
  expect(container.firstChild).toBeNull();
});

test('items: [] → renders nothing', () => {
  const { container } = render(<BreakfastDayCard data={{ items: [], totalPersons: 0 }} />);
  expect(container.firstChild).toBeNull();
});

test('2 items → both rows render property + client + breakfast count + total', () => {
  render(
    <BreakfastDayCard
      data={{
        items: [
          { reservationId: 1, clientName: 'Famille Dupont', propertyName: 'Gîte', persons: 4 },
          { reservationId: 2, clientName: 'M. Martin', propertyName: 'Studio', persons: 2 },
        ],
        totalPersons: 6,
      }}
    />
  );
  // Header.
  expect(screen.getByText('Petit déjeuner')).toBeInTheDocument();
  // Property + client surfaces.
  expect(screen.getByText('Gîte')).toBeInTheDocument();
  expect(screen.getByText('Studio')).toBeInTheDocument();
  expect(screen.getByText('Famille Dupont')).toBeInTheDocument();
  expect(screen.getByText('M. Martin')).toBeInTheDocument();
  // Per-row breakfast counts use the new wording.
  expect(screen.getByText('4 petits déjeuners')).toBeInTheDocument();
  expect(screen.getByText('2 petits déjeuners')).toBeInTheDocument();
  // Total — plural form (> 1).
  expect(screen.getByText(/Total : 6 petits déjeuners/i)).toBeInTheDocument();
});

test('singular form — 1 item carrying 1 person → "1 petit déjeuner" on both the row and the total', () => {
  render(
    <BreakfastDayCard
      data={{
        items: [{ reservationId: 7, clientName: 'M. Solo', propertyName: 'Cabane', persons: 1 }],
        totalPersons: 1,
      }}
    />
  );
  expect(screen.getByText('1 petit déjeuner')).toBeInTheDocument();
  expect(screen.getByText(/Total : 1 petit déjeuner$/i)).toBeInTheDocument();
});

test('onItemClick provided → each row is a button + click forwards the reservation id', () => {
  const onItemClick = vi.fn();
  render(
    <BreakfastDayCard
      data={{
        items: [
          { reservationId: 42, clientName: 'Famille A', propertyName: 'Gîte', persons: 3 },
          { reservationId: 99, clientName: 'M. B', propertyName: 'Studio', persons: 2 },
        ],
        totalPersons: 5,
      }}
      onItemClick={onItemClick}
    />
  );
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(2);
  fireEvent.click(buttons[1]);
  expect(onItemClick).toHaveBeenCalledWith(99);
});

test('onItemClick provided → keyboard Enter on a row also triggers the handler (a11y)', () => {
  const onItemClick = vi.fn();
  render(
    <BreakfastDayCard
      data={{
        items: [{ reservationId: 7, clientName: 'A', propertyName: 'P', persons: 1 }],
        totalPersons: 1,
      }}
      onItemClick={onItemClick}
    />
  );
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
  expect(onItemClick).toHaveBeenCalledWith(7);
});

test('onItemClick omitted → rows are NOT buttons (no clickable affordance, read-only)', () => {
  render(
    <BreakfastDayCard
      data={{
        items: [{ reservationId: 1, clientName: 'A', propertyName: 'P', persons: 1 }],
        totalPersons: 1,
      }}
    />
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('item without propertyName → the property block is skipped (no empty label rendered)', () => {
  render(
    <BreakfastDayCard
      data={{
        items: [{ reservationId: 8, clientName: 'Anonymous', propertyName: '', persons: 3 }],
        totalPersons: 3,
      }}
    />
  );
  // The client + count still render.
  expect(screen.getByText('Anonymous')).toBeInTheDocument();
  expect(screen.getByText('3 petits déjeuners')).toBeInTheDocument();
});

// specs/breakfast-time.md — the desired breakfast time is shown per row when present.
test('renders the breakfast time per row when provided', () => {
  render(
    <BreakfastDayCard
      data={{
        items: [
          { reservationId: 1, clientName: 'Famille Dupont', propertyName: 'Gîte', persons: 3, breakfastTime: '08:00' },
          { reservationId: 2, clientName: 'M. Martin', propertyName: 'Studio', persons: 2, breakfastTime: '09:30' },
        ],
        totalPersons: 5,
      }}
    />
  );
  expect(screen.getByText('08:00')).toBeInTheDocument();
  expect(screen.getByText('09:30')).toBeInTheDocument();
});

test('no time badge when an item carries no breakfastTime', () => {
  render(
    <BreakfastDayCard
      data={{ items: [{ reservationId: 1, clientName: 'X', propertyName: 'Y', persons: 1 }], totalPersons: 1 }}
    />
  );
  // No HH:MM text rendered.
  expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull();
});
