import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import LaundryDayCard from '../LaundryDayCard';

// specs/laundry-counts-explicit-option-only.md §3.2 rule 9.
//
// Since the ticked option became the only signal for the laundry count, a stay that declares bed
// linen without a quantity saved yet contributes a silent zero. The card must say so rather than
// let the operator read a figure it knows is short.

const ZERO = { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0 };

const STAY = { id: 22212, clientName: 'Jean Dupont', propertyName: 'Aventura lodge', endDate: '2026-08-13' };

test('renders the warning + one chip per stay that declares linen without a quantity', () => {
  render(<LaundryDayCard data={{
    dropOff: { ...ZERO, doubleBeds: 3, incomplete: [STAY] },
    pickUp: ZERO,
  }} />);
  expect(screen.getByText(/1 séjour sans quantité de linge saisie/)).toBeInTheDocument();
  expect(screen.getByText('Jean Dupont · Aventura lodge')).toBeInTheDocument();
});

test('pluralises the caption and renders one chip per stay', () => {
  const second = { id: 22208, clientName: 'Marie Martin', propertyName: 'Gite', endDate: '2026-08-12' };
  render(<LaundryDayCard data={{
    dropOff: { ...ZERO, doubleBeds: 3, incomplete: [STAY, second] },
    pickUp: ZERO,
  }} />);
  expect(screen.getByText(/2 séjours sans quantité de linge saisie/)).toBeInTheDocument();
  expect(screen.getByText('Jean Dupont · Aventura lodge')).toBeInTheDocument();
  expect(screen.getByText('Marie Martin · Gite')).toBeInTheDocument();
});

test('no warning block when the list is empty or absent', () => {
  render(<LaundryDayCard data={{
    dropOff: { ...ZERO, doubleBeds: 3, incomplete: [] },
    pickUp: ZERO,
  }} />);
  expect(screen.queryByText(/sans quantité de linge saisie/)).not.toBeInTheDocument();

  render(<LaundryDayCard data={{ dropOff: { ...ZERO, doubleBeds: 3 }, pickUp: ZERO }} />);
  expect(screen.queryByText(/sans quantité de linge saisie/)).not.toBeInTheDocument();
});

test('an all-zero week still renders the card when a stay is flagged (silence rule bypassed)', () => {
  // The whole point of the warning: the only departures of the week have no quantity yet, so both
  // sides total zero. Rule 13 would hide the card and the operator would see nothing at all.
  const { container } = render(<LaundryDayCard data={{
    dropOff: { ...ZERO, incomplete: [STAY] },
    pickUp: ZERO,
  }} />);
  expect(container.firstChild).not.toBeNull();
  expect(screen.getByText(/1 séjour sans quantité de linge saisie/)).toBeInTheDocument();
});

test('clicking a chip calls onOpenReservation with the reservation id', () => {
  const onOpenReservation = vi.fn();
  render(<LaundryDayCard
    data={{ dropOff: { ...ZERO, doubleBeds: 3, incomplete: [STAY] }, pickUp: ZERO }}
    onOpenReservation={onOpenReservation}
  />);
  fireEvent.click(screen.getByText('Jean Dupont · Aventura lodge'));
  expect(onOpenReservation).toHaveBeenCalledWith(22212);
});

test('a skipped trip shows its caption, not the warning (the batch moves to the next trip)', () => {
  render(<LaundryDayCard
    data={{ dropOff: { ...ZERO, incomplete: [] }, pickUp: ZERO }}
    date="2026-08-11"
    isSkipped
  />);
  expect(screen.getByText(/Voyage non réalisé/)).toBeInTheDocument();
  expect(screen.queryByText(/sans quantité de linge saisie/)).not.toBeInTheDocument();
});
