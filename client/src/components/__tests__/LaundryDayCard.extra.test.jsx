import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import LaundryDayCard from '../LaundryDayCard';

// specs/laundry-extra-trip.md §3.5 rule 19 + §7 — the extra-trip variant of the laundry card.

const BLOCK = (over = {}) => ({
  singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0, bathMats: 0, ...over,
});

const EXTRA_ALL = {
  kind: 'extra',
  pickUpAll: true,
  dropOff: BLOCK({ doubleBeds: 2 }),
  pickUp: BLOCK({ singleBeds: 3, largeTowels: 4 }),
  leftAtLaundry: BLOCK(),
};

const EXTRA_PARTIAL = {
  kind: 'extra',
  pickUpAll: false,
  dropOff: BLOCK({ doubleBeds: 2 }),
  pickUp: BLOCK({ singleBeds: 1 }),
  leftAtLaundry: BLOCK({ singleBeds: 2, largeTowels: 4 }),
};

test('extra card: dedicated title + chip, pencil and trash call the handlers with the date, no skip toggle', () => {
  const onEditExtra = vi.fn();
  const onDeleteExtra = vi.fn();
  const onToggleSkip = vi.fn();
  render(
    <LaundryDayCard data={EXTRA_ALL} date="2026-08-20" onEditExtra={onEditExtra} onDeleteExtra={onDeleteExtra} onToggleSkip={onToggleSkip} />,
  );
  expect(screen.getByText('Voyage blanchisserie exceptionnel')).toBeInTheDocument();
  expect(screen.getByText('exceptionnel')).toBeInTheDocument();
  expect(screen.getByText('À apporter')).toBeInTheDocument();
  expect(screen.getByText('À récupérer')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Modifier le voyage exceptionnel' }));
  expect(onEditExtra).toHaveBeenCalledWith('2026-08-20');
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer le voyage exceptionnel' }));
  expect(onDeleteExtra).toHaveBeenCalledWith('2026-08-20');
  // An extra trip cannot be skipped — the toggle is never rendered, even with a handler.
  expect(screen.queryByRole('button', { name: /Marquer ce voyage/i })).toBeNull();
  // Full pick-up → no partial caption.
  expect(screen.queryByText(/Récupération partielle/)).toBeNull();
});

test('extra card without handlers (reception role): no pencil, no trash — the figures still render', () => {
  render(<LaundryDayCard data={EXTRA_ALL} date="2026-08-20" />);
  expect(screen.getByText('Voyage blanchisserie exceptionnel')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Modifier le voyage exceptionnel' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Supprimer le voyage exceptionnel' })).toBeNull();
  expect(screen.getByText('À apporter')).toBeInTheDocument();
});

test('partial pick-up: the caption lists what stays at the laundry', () => {
  render(<LaundryDayCard data={EXTRA_PARTIAL} date="2026-08-20" />);
  expect(screen.getByText('Récupération partielle — reste à la blanchisserie : 2 simples · 4 grandes')).toBeInTheDocument();
});

test('partial pick-up that emptied the laundry: the caption says so', () => {
  render(<LaundryDayCard data={{ ...EXTRA_PARTIAL, leftAtLaundry: BLOCK() }} date="2026-08-20" />);
  expect(screen.getByText('Récupération partielle — plus rien ne reste à la blanchisserie')).toBeInTheDocument();
});

test('an extra card with nothing on either side is STILL rendered (always-shown rule)', () => {
  render(<LaundryDayCard data={{ ...EXTRA_ALL, dropOff: BLOCK(), pickUp: BLOCK() }} date="2026-08-20" />);
  expect(screen.getByText('Voyage blanchisserie exceptionnel')).toBeInTheDocument();
  expect(screen.getAllByText('—').length).toBe(2);
});

test('a stale skip flag on an extra date is ignored — the card is not greyed out', () => {
  render(<LaundryDayCard data={EXTRA_ALL} date="2026-08-20" isSkipped onToggleSkip={() => {}} />);
  expect(screen.queryByText(/Voyage non réalisé/)).toBeNull();
  expect(screen.getByText('À apporter')).toBeInTheDocument();
});

test('regular card is untouched: original title, skip toggle present, no extra controls', () => {
  const data = { kind: 'regular', dropOff: BLOCK({ singleBeds: 2 }), pickUp: BLOCK() };
  render(<LaundryDayCard data={data} date="2026-08-18" onToggleSkip={() => {}} onEditExtra={() => {}} onDeleteExtra={() => {}} />);
  expect(screen.getByText('Linge à la blanchisserie')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Marquer ce voyage blanchisserie comme non réalisé/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Modifier le voyage exceptionnel' })).toBeNull();
  expect(screen.queryByText('exceptionnel')).toBeNull();
});
