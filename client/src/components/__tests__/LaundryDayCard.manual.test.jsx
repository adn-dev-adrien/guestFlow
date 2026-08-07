import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import LaundryDayCard from '../LaundryDayCard';

// specs/manual-laundry-additions.md §6 — the laundry card's manual-addition affordance + caption.
// The server folds manual additions into `data`; the card only adds the edit pencil + the discreet
// « dont ajout manuel » caption (driven by the `manualAddition` prop).

const ZERO = { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0 };
const DATA = { dropOff: { ...ZERO, doubleBeds: 2 }, pickUp: ZERO };

test('no pencil when onEditManual is omitted', () => {
  render(<LaundryDayCard data={DATA} date="2026-06-16" />);
  expect(screen.queryByRole('button', { name: 'Ajouter du linge manuellement' })).toBeNull();
});

test('the pencil shows with onEditManual + date; clicking calls onEditManual(date)', () => {
  const onEditManual = vi.fn();
  render(<LaundryDayCard data={DATA} date="2026-06-16" onEditManual={onEditManual} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter du linge manuellement' }));
  expect(onEditManual).toHaveBeenCalledWith('2026-06-16');
});

test('« dont ajout manuel » caption lists the manual breakdown', () => {
  render(
    <LaundryDayCard data={DATA} date="2026-06-16" onEditManual={() => {}}
      manualAddition={{ ...ZERO, doubleBeds: 2, largeTowels: 1 }} />,
  );
  const caption = screen.getByText(/dont ajout manuel/);
  expect(caption.textContent).toMatch(/2 double/);
  expect(caption.textContent).toMatch(/1 grande/);
});

test('no caption when the manual addition is zero / absent', () => {
  render(<LaundryDayCard data={DATA} date="2026-06-16" onEditManual={() => {}} manualAddition={ZERO} />);
  expect(screen.queryByText(/dont ajout manuel/)).toBeNull();
});

test('a card whose only content is a manual addition still renders (server folds it into dropOff)', () => {
  render(
    <LaundryDayCard data={{ dropOff: { ...ZERO, singleBeds: 1 }, pickUp: ZERO }} date="2026-06-16"
      onEditManual={() => {}} manualAddition={{ ...ZERO, singleBeds: 1 }} />,
  );
  expect(screen.getByText('À apporter')).toBeInTheDocument();
  expect(screen.getByText(/dont ajout manuel/)).toBeInTheDocument();
});
