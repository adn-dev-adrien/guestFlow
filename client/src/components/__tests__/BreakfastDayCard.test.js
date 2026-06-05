import React from 'react';
import { render, screen } from '@testing-library/react';

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
