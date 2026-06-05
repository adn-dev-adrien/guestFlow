import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import BreakfastDayCard from '../BreakfastDayCard';

// specs/breakfast-option-and-planning-card.md §6.1 + §7.2. Renderer-only contract:
// hidden when data is missing, otherwise lists each item + a total. Plural / singular
// on the total label is pinned so the wording stays correct.

test('data undefined → renders nothing (no DOM)', () => {
  const { container } = render(<BreakfastDayCard data={undefined} />);
  expect(container.firstChild).toBeNull();
});

test('items: [] → renders nothing', () => {
  const { container } = render(<BreakfastDayCard data={{ items: [], totalPersons: 0 }} />);
  expect(container.firstChild).toBeNull();
});

test('2 items → both rows + total with the right number', () => {
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
  // Per-row rendering pins both clients + property names.
  expect(screen.getByText('Famille Dupont')).toBeInTheDocument();
  expect(screen.getByText('(Gîte)')).toBeInTheDocument();
  expect(screen.getByText('M. Martin')).toBeInTheDocument();
  expect(screen.getByText('(Studio)')).toBeInTheDocument();
  // Per-row person counts.
  expect(screen.getByText('4 pers.')).toBeInTheDocument();
  expect(screen.getByText('2 pers.')).toBeInTheDocument();
  // Total — plural form (> 1).
  expect(screen.getByText(/Total : 6 petits déjeuners/i)).toBeInTheDocument();
});

test('singular total — 1 item carrying 1 person → "1 petit déjeuner"', () => {
  render(
    <BreakfastDayCard
      data={{
        items: [{ reservationId: 7, clientName: 'M. Solo', propertyName: '', persons: 1 }],
        totalPersons: 1,
      }}
    />
  );
  expect(screen.getByText(/Total : 1 petit déjeuner$/i)).toBeInTheDocument();
});

test('item without propertyName → no parenthesis rendered (defensive)', () => {
  render(
    <BreakfastDayCard
      data={{
        items: [{ reservationId: 8, clientName: 'Anonymous', propertyName: '', persons: 3 }],
        totalPersons: 3,
      }}
    />
  );
  expect(screen.getByText('Anonymous')).toBeInTheDocument();
  // No '(...)' span — `propertyName` falsy means the conditional renders nothing.
  expect(screen.queryByText(/\(\s*\)/)).not.toBeInTheDocument();
});

// specs/breakfast-option-and-planning-card.md §10 hotfix follow-up (2026-06-05). When
// `onItemClick` is provided, each row becomes a clickable navigation target — clicking
// it forwards the reservation id to the handler. Without the prop, the rows stay
// passive (read-only surfaces).

test('onItemClick provided → each row is a button role with the right cursor + click forwards the id', () => {
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
