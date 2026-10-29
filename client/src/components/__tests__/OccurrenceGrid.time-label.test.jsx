/**
 * specs/ui-review-2026-10-19-operations.md rule 37 — the default-hour field of a single-slot grid has
 * an accessible name; a multi-slot grid keeps its « Créneau N » labels.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import OccurrenceGrid from '../OccurrenceGrid';

const grid = (slots) => slots.map((slot) => ({ date: '2026-07-07', time: '09:00', slot, checked: true }));
const props = { onToggle: () => {}, onSlotTimeChange: () => {} };

test('rule 37 — a single default hour is reachable by name', () => {
  render(<OccurrenceGrid {...props} grid={grid([0])} slotTimes={[{ slot: 0, time: '09:00' }]} />);
  expect(screen.getByLabelText('Heure par défaut')).toHaveValue('09:00');
});

test('rule 37 — several slots keep their own « Créneau N » labels', () => {
  render(<OccurrenceGrid {...props} grid={grid([0, 1])} slotTimes={[{ slot: 0, time: '09:00' }, { slot: 1, time: '14:00' }]} />);
  expect(screen.getByLabelText('Créneau 1')).toHaveValue('09:00');
  expect(screen.getByLabelText('Créneau 2')).toHaveValue('14:00');
});
