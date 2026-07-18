import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import BreakfastPrepDialog from '../BreakfastPrepDialog';

// specs/planning-breakfast-prep-popup.md — non-zero filtering + pictogram rows.

const FULL_ITEM = {
  reservationId: 42,
  date: '2026-07-19',
  time: '09:00',
  clientName: 'Sarah Arnaud',
  propertyName: 'Aventura lodge',
  breakfastPersons: 4,
  coffee: 2,
  tea: 0,
  chocolate: 0,
  milk: 2,
  pastries: 3,
  cereals: 1,
  note: 'sans gluten',
};

function renderDialog(item, handlers = {}) {
  return render(
    <BreakfastPrepDialog
      open
      item={item}
      onClose={handlers.onClose || (() => {})}
      onOpenFiche={handlers.onOpenFiche || (() => {})}
    />,
  );
}

test('shows header (time, client · property, day), persons line and ONLY non-zero items', () => {
  renderDialog(FULL_ITEM);
  expect(screen.getByText('Petit déjeuner')).toBeInTheDocument();
  expect(screen.getByText('09:00')).toBeInTheDocument();
  expect(screen.getByText(/Sarah Arnaud · Aventura lodge — dimanche 19 juillet/)).toBeInTheDocument();
  expect(screen.getByText('4 petits déjeuners')).toBeInTheDocument();

  expect(screen.getByText('Café')).toBeInTheDocument();
  expect(screen.getByText('Lait')).toBeInTheDocument();
  expect(screen.getByText('Viennoiseries')).toBeInTheDocument();
  expect(screen.getByText('Céréales')).toBeInTheDocument();
  // zero-count items are hidden
  expect(screen.queryByText('Thé')).toBeNull();
  expect(screen.queryByText('Chocolat chaud')).toBeNull();

  expect(screen.getAllByText('× 2')).toHaveLength(2); // café + lait
  expect(screen.getByText('× 3')).toBeInTheDocument();
  expect(screen.getByText('× 1')).toBeInTheDocument();
  expect(screen.getByText('sans gluten')).toBeInTheDocument();
});

test('empty composition → placeholder message, no item rows', () => {
  renderDialog({ ...FULL_ITEM, coffee: 0, milk: 0, pastries: 0, cereals: 0, note: '' });
  expect(screen.getByText('Composition non renseignée (à compléter au check-in).')).toBeInTheDocument();
  expect(screen.queryByText('Café')).toBeNull();
  // persons line stays
  expect(screen.getByText('4 petits déjeuners')).toBeInTheDocument();
});

test('note hidden when empty; singular person label', () => {
  renderDialog({ ...FULL_ITEM, breakfastPersons: 1, note: '   ' });
  expect(screen.getByText('1 petit déjeuner')).toBeInTheDocument();
  expect(screen.queryByText(/sans gluten/)).toBeNull();
});

test('Fermer and Fiche fire their callbacks', () => {
  const onClose = vi.fn();
  const onOpenFiche = vi.fn();
  renderDialog(FULL_ITEM, { onClose, onOpenFiche });
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Fiche' }));
  expect(onOpenFiche).toHaveBeenCalledTimes(1);
});
