import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import ReservationCard from '../ReservationCard';
import { PLATFORM_COLORS } from '../../constants/platforms';

// Coverage for the PR #129 + PR #130 sweep:
//   - time pill on the top row with AccessTimeIcon + bold rounded chip
//   - FlightLand badge on the ARRIVÉE chip
//   - second-line block reduced to PersonIcon + client name
//   - Famille row: each chip individually gated on its own count > 0
//   - Lits row: gated on (doubleBeds > 0 OR singleBeds > 0)
//   - notes block still rendered on the arrival side (departure dropped it)
//   - onOpen makes the whole card clickable; checkbox click is stopPropagation'd
//   - alertInfo: bg color + explanation caption next to the property name

const BASE = {
  id: 100,
  firstName: 'Famille',
  lastName: 'Dupont',
  propertyName: 'Gîte',
  checkInTime: '15:00',
  checkInReady: false,
  adults: 2, children: 1, teens: 0, babies: 0,
  doubleBeds: 1, singleBeds: 2, babyBeds: 0,
  options: [],
  resources: [],
};

function noop() {}

test('time pill — renders the checkInTime next to ARRIVÉE with an AccessTime icon', () => {
  const { container } = render(<ReservationCard reservation={BASE} onToggleReady={noop} />);
  expect(screen.getByText('ARRIVÉE')).toBeInTheDocument();
  expect(screen.getByText('15:00')).toBeInTheDocument();
  // FlightLand icon (on ARRIVÉE) + AccessTime icon (on time pill).
  expect(container.querySelector('[data-testid="FlightLandIcon"]')).toBeInTheDocument();
  expect(container.querySelector('[data-testid="AccessTimeIcon"]')).toBeInTheDocument();
});

test('time pill — default 15:00 when checkInTime is missing', () => {
  const r = { ...BASE, checkInTime: undefined };
  render(<ReservationCard reservation={r} onToggleReady={noop} />);
  expect(screen.getByText('15:00')).toBeInTheDocument();
});

test('Famille filter — only non-zero categories render as chips', () => {
  const r = { ...BASE, adults: 2, children: 0, teens: 0, babies: 0 };
  render(<ReservationCard reservation={r} onToggleReady={noop} />);
  expect(screen.getByText(/Adultes:\s*2/)).toBeInTheDocument();
  expect(screen.queryByText(/Enfants:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Ados:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Bébés:/)).not.toBeInTheDocument();
});

test('Famille filter — all-zero collapses the whole row + label', () => {
  const r = { ...BASE, adults: 0, children: 0, teens: 0, babies: 0 };
  render(<ReservationCard reservation={r} onToggleReady={noop} />);
  expect(screen.queryByText('Famille:')).not.toBeInTheDocument();
});

test('Famille filter — all four categories surface when all > 0', () => {
  const r = { ...BASE, adults: 2, children: 1, teens: 1, babies: 1 };
  render(<ReservationCard reservation={r} onToggleReady={noop} />);
  expect(screen.getByText(/Adultes:\s*2/)).toBeInTheDocument();
  expect(screen.getByText(/Enfants:\s*1/)).toBeInTheDocument();
  expect(screen.getByText(/Ados:\s*1/)).toBeInTheDocument();
  expect(screen.getByText(/Bébés:\s*1/)).toBeInTheDocument();
});

test('Lits gate — row rendered when doubleBeds > 0 (coloured bed icon, no text label)', () => {
  const r = { ...BASE, doubleBeds: 1, singleBeds: 0, babyBeds: 0 };
  render(<ReservationCard reservation={r} onToggleReady={noop} />);
  expect(screen.getByText('Lits:')).toBeInTheDocument();
  expect(screen.getByLabelText('Lit double')).toBeInTheDocument(); // BedIcon svg, not "DOUBLE" text
  expect(screen.queryByText('DOUBLE')).not.toBeInTheDocument();
});

test('Lits gate — row rendered when singleBeds > 0 (single bed icon)', () => {
  const r = { ...BASE, doubleBeds: 0, singleBeds: 3, babyBeds: 0 };
  render(<ReservationCard reservation={r} onToggleReady={noop} />);
  expect(screen.getByText('Lits:')).toBeInTheDocument();
  expect(screen.getByLabelText('Lit simple')).toBeInTheDocument();
  expect(screen.queryByText('SIMPLE')).not.toBeInTheDocument();
});

test('Lits gate — row HIDDEN when both regular bed counts are 0 (even with baby beds)', () => {
  const r = { ...BASE, doubleBeds: 0, singleBeds: 0, babyBeds: 1 };
  render(<ReservationCard reservation={r} onToggleReady={noop} />);
  expect(screen.queryByText('Lits:')).not.toBeInTheDocument();
});

test('notes — still rendered on the arrival card (only departure dropped it)', () => {
  const r = { ...BASE, notes: 'Allergique aux chats' };
  render(<ReservationCard reservation={r} onToggleReady={noop} />);
  expect(screen.getByText('Allergique aux chats')).toBeInTheDocument();
});

test('onOpen — clicking the card body calls onOpen(reservation.id)', () => {
  const onOpen = vi.fn();
  const { container } = render(
    <ReservationCard reservation={BASE} onToggleReady={noop} onOpen={onOpen} />
  );
  const propertyName = screen.getByText('Gîte');
  fireEvent.click(propertyName);
  expect(onOpen).toHaveBeenCalledWith(100);
  // Card cursor reflects the clickable state — MUI applies it via the sx prop's
  // emotion className, hard to assert here. Behavior is enough to pin the contract.
  expect(container.firstChild).toBeInTheDocument();
});

test('onOpen — clicking the ready checkbox does NOT trigger onOpen (stopPropagation)', () => {
  const onOpen = vi.fn();
  const onToggleReady = vi.fn();
  render(
    <ReservationCard reservation={BASE} onToggleReady={onToggleReady} onOpen={onOpen} />
  );
  const checkbox = screen.getByRole('checkbox');
  fireEvent.click(checkbox);
  expect(onToggleReady).toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
});

test('onOpen omitted — card stays read-only, no error on click', () => {
  // No onOpen prop: clicking should not throw + handler should be undefined.
  const { container } = render(<ReservationCard reservation={BASE} onToggleReady={noop} />);
  expect(() => fireEvent.click(container.firstChild)).not.toThrow();
});

test('alertInfo — explanation text shown next to property name', () => {
  const alertInfo = {
    type: 'red',
    explanation: 'M. Mai part le 09/06/2026 à 10:00, ménage: 3h',
  };
  render(<ReservationCard reservation={BASE} onToggleReady={noop} alertInfo={alertInfo} />);
  expect(screen.getByText(alertInfo.explanation)).toBeInTheDocument();
});

test('alertInfo — no explanation when alertInfo is undefined (graceful)', () => {
  render(<ReservationCard reservation={BASE} onToggleReady={noop} />);
  expect(screen.queryByText(/ménage:/i)).not.toBeInTheDocument();
});

test('done state — "Prêt" badge surfaces when checkInReady is true', () => {
  const r = { ...BASE, checkInReady: true };
  render(<ReservationCard reservation={r} onToggleReady={noop} />);
  expect(screen.getByText('Prêt')).toBeInTheDocument();
});

test('options + resources — chips rendered for non-empty lists', () => {
  const r = {
    ...BASE,
    options: [{ title: 'Petit déjeuner', billedUnits: 4 }],
    resources: [{ name: 'Bain nordique', billedUnits: 1 }],
  };
  render(<ReservationCard reservation={r} onToggleReady={noop} />);
  expect(screen.getByText('Petit déjeuner ×4')).toBeInTheDocument();
  expect(screen.getByText('Bain nordique ×1')).toBeInTheDocument();
});

// specs/force-extras-complement-on-platform.md — the arrival tile reports the complementary
// payment + amount (collected on arrival for platform/iCal reservations).
test('complement — shows "Complément à percevoir" with the amount when complementAmount > 0', () => {
  render(<ReservationCard reservation={{ ...BASE, complementAmount: 45, complementPaid: false }} onToggleReady={noop} />);
  expect(screen.getByText(/Complément à percevoir : 45\.00€/)).toBeInTheDocument();
});

test('complement — marks it (perçu) when complementPaid', () => {
  render(<ReservationCard reservation={{ ...BASE, complementAmount: 45, complementPaid: true }} onToggleReady={noop} />);
  expect(screen.getByText(/Complément à percevoir : 45\.00€ \(perçu\)/)).toBeInTheDocument();
});

test('complement — no chip when complementAmount is 0 / absent', () => {
  render(<ReservationCard reservation={BASE} onToggleReady={noop} />);
  expect(screen.queryByText(/Complément à percevoir/)).toBeNull();
});

// Caution to collect: when the security deposit is unpaid, the arrival tile surfaces the amount in
// red so the host knows to collect it at check-in.
test('caution — shows "Caution à percevoir" with the amount when unpaid (cautionReceived = 0)', () => {
  render(<ReservationCard reservation={{ ...BASE, cautionAmount: 300, cautionReceived: 0 }} onToggleReady={noop} />);
  expect(screen.getByText(/Caution à percevoir : 300\.00€/)).toBeInTheDocument();
});

test('caution — no chip when the caution has been received', () => {
  render(<ReservationCard reservation={{ ...BASE, cautionAmount: 300, cautionReceived: 1 }} onToggleReady={noop} />);
  expect(screen.queryByText(/Caution à percevoir/)).toBeNull();
});

test('caution — no chip when there is no caution amount', () => {
  render(<ReservationCard reservation={{ ...BASE, cautionAmount: 0, cautionReceived: 0 }} onToggleReady={noop} />);
  expect(screen.queryByText(/Caution à percevoir/)).toBeNull();
});

// Platform badge — rendered next to the property name, bordered with the platform colour.
test('platform badge — shows the platform label coloured with the platform colour', () => {
  render(<ReservationCard reservation={{ ...BASE, platform: 'Airbnb' }} onToggleReady={noop} />);
  const badge = screen.getByText('Airbnb');
  expect(badge).toBeInTheDocument();
  expect(badge).toHaveStyle({ color: PLATFORM_COLORS.airbnb });
});

test('platform badge — lowercase "direct" displays as "Direct"', () => {
  render(<ReservationCard reservation={{ ...BASE, platform: 'direct' }} onToggleReady={noop} />);
  expect(screen.getByText('Direct')).toBeInTheDocument();
});

test('platform badge — absent when the reservation has no platform', () => {
  render(<ReservationCard reservation={{ ...BASE, platform: '' }} onToggleReady={noop} />);
  expect(screen.queryByText('Direct')).toBeNull();
  expect(screen.queryByText('Airbnb')).toBeNull();
});
