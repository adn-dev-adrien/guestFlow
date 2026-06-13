import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import DepartureMiniRow from '../DepartureMiniRow';

// Coverage for the PR #129 + PR #130 sweep on the departure tile:
//   - time pill on the top row with AccessTimeIcon + bold rounded chip
//   - FlightTakeoff badge on the DÉPART chip
//   - second-line block reduced to PersonIcon + client name
//   - NO Famille row (the breakdown belongs to the arrival card)
//   - NO notes block (dropped 2026-06-06 to keep the tile compact)
//   - alertInfo.cleaningDisplay → prominent red "Ménage : Xh" block
//   - onOpen makes the whole card clickable; checkbox click is stopPropagation'd

const BASE = {
  id: 200,
  clientId: 77,
  firstName: 'M.',
  lastName: 'Martin',
  propertyName: 'Studio',
  checkOutTime: '10:00',
  checkOutDone: false,
  notes: 'Note privée à ignorer côté départ',
};

function noop() {}

test('time pill — renders the checkOutTime next to DÉPART with an AccessTime icon', () => {
  const { container } = render(<DepartureMiniRow reservation={BASE} onToggleDone={noop} />);
  expect(screen.getByText('DÉPART')).toBeInTheDocument();
  expect(screen.getByText('10:00')).toBeInTheDocument();
  // FlightTakeoff (DÉPART) + AccessTime (time pill).
  expect(container.querySelector('[data-testid="FlightTakeoffIcon"]')).toBeInTheDocument();
  expect(container.querySelector('[data-testid="AccessTimeIcon"]')).toBeInTheDocument();
});

test('time pill — default 10:00 when checkOutTime is missing', () => {
  const r = { ...BASE, checkOutTime: undefined };
  render(<DepartureMiniRow reservation={r} onToggleDone={noop} />);
  expect(screen.getByText('10:00')).toBeInTheDocument();
});

test('client name shown under property name', () => {
  render(<DepartureMiniRow reservation={BASE} onToggleDone={noop} />);
  expect(screen.getByText('Studio')).toBeInTheDocument();
  expect(screen.getByText('M. Martin')).toBeInTheDocument();
});

test('Famille row — NOT rendered on the departure tile (lives on arrival only)', () => {
  // Even with adults / children present in the data, the tile must not show the chips.
  const r = { ...BASE, adults: 3, children: 2 };
  render(<DepartureMiniRow reservation={r} onToggleDone={noop} />);
  expect(screen.queryByText(/Famille:/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Adultes:/)).not.toBeInTheDocument();
});

test('notes — NOT rendered on the departure tile (Adrien 2026-06-06)', () => {
  // BASE.notes contains "Note privée …" but should never surface here.
  render(<DepartureMiniRow reservation={BASE} onToggleDone={noop} />);
  expect(screen.queryByText(/Note privée/i)).not.toBeInTheDocument();
});

test('Ménage block — renders a CleaningServices icon + "Ménage : Xh" when cleaningDisplay is set', () => {
  const alertInfo = { type: 'red', cleaningDisplay: '3h' };
  const { container } = render(
    <DepartureMiniRow reservation={BASE} onToggleDone={noop} alertInfo={alertInfo} />
  );
  expect(screen.getByText(/Ménage\s*:\s*3h/)).toBeInTheDocument();
  expect(container.querySelector('[data-testid="CleaningServicesIcon"]')).toBeInTheDocument();
});

test('Ménage block — NOT rendered when alertInfo has no cleaningDisplay', () => {
  const alertInfo = { type: 'red', explanation: 'Conflit' };
  const { container } = render(
    <DepartureMiniRow reservation={BASE} onToggleDone={noop} alertInfo={alertInfo} />
  );
  expect(screen.queryByText(/Ménage\s*:/i)).not.toBeInTheDocument();
  expect(container.querySelector('[data-testid="CleaningServicesIcon"]')).not.toBeInTheDocument();
});

test('alertInfo.explanation — shown as caption next to the property name', () => {
  const alertInfo = {
    type: 'red',
    explanation: 'Arrivée de Famille Dupont 09/06/2026 à 15:00, ménage: 3h',
  };
  render(<DepartureMiniRow reservation={BASE} onToggleDone={noop} alertInfo={alertInfo} />);
  expect(screen.getByText(alertInfo.explanation)).toBeInTheDocument();
});

test('actions — the "Ouvrir la réservation" button calls onOpenReservation(id)', () => {
  const onOpenReservation = vi.fn();
  render(
    <DepartureMiniRow reservation={BASE} onToggleDone={noop} onOpenReservation={onOpenReservation} />
  );
  fireEvent.click(screen.getByLabelText('Ouvrir la réservation'));
  expect(onOpenReservation).toHaveBeenCalledWith(200);
});

test('SAS button — opens the departure SAS when not yet done', () => {
  const onOpenSas = vi.fn();
  render(
    <DepartureMiniRow reservation={BASE} onToggleDone={noop} onOpenSas={onOpenSas} />
  );
  const sasBtn = screen.getByRole('button', { name: 'Check-out (SAS départ)' });
  expect(sasBtn).not.toBeDisabled();
  fireEvent.click(sasBtn);
  expect(onOpenSas).toHaveBeenCalledWith(200);
});

test('SAS button — disabled with a ✓ once the departure SAS is done', () => {
  const onOpenSas = vi.fn();
  const r = { ...BASE, departureSasDoneAt: '2026-06-13 11:00:00' };
  render(<DepartureMiniRow reservation={r} onToggleDone={noop} onOpenSas={onOpenSas} />);
  const sasBtn = screen.getByRole('button', { name: 'Check-out (SAS départ)' });
  expect(sasBtn).toBeDisabled();
  fireEvent.click(sasBtn);
  expect(onOpenSas).not.toHaveBeenCalled();
});

test('client name — clicking it opens the client fiche via onOpenClient(clientId)', () => {
  const onOpenClient = vi.fn();
  render(
    <DepartureMiniRow reservation={BASE} onToggleDone={noop} onOpenClient={onOpenClient} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'M. Martin' }));
  expect(onOpenClient).toHaveBeenCalledWith(77);
});

test('done checkbox — toggling it does NOT trigger any open handler (stopPropagation)', () => {
  const onOpenReservation = vi.fn();
  const onToggleDone = vi.fn();
  render(
    <DepartureMiniRow
      reservation={BASE}
      onToggleDone={onToggleDone}
      onOpenReservation={onOpenReservation}
    />
  );
  fireEvent.click(screen.getByRole('checkbox'));
  expect(onToggleDone).toHaveBeenCalled();
  expect(onOpenReservation).not.toHaveBeenCalled();
});

test('open handlers omitted — card renders read-only with no action buttons', () => {
  render(<DepartureMiniRow reservation={BASE} onToggleDone={noop} />);
  expect(screen.queryByLabelText('Ouvrir la réservation')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Check-out (SAS départ)')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'M. Martin' })).not.toBeInTheDocument();
  expect(screen.getByText('M. Martin')).toBeInTheDocument();
});

test('done state — "Effectué" badge surfaces when checkOutDone is true', () => {
  const r = { ...BASE, checkOutDone: true };
  render(<DepartureMiniRow reservation={r} onToggleDone={noop} />);
  expect(screen.getByText('Effectué')).toBeInTheDocument();
});

// specs/sas-breakfast-and-handover-note.md — handover note authored at arrival, shown at departure.
test('handover note — caption renders when departureHandoverNote is set', () => {
  const r = { ...BASE, departureHandoverNote: 'Récupérer la 2e clé' };
  render(<DepartureMiniRow reservation={r} onToggleDone={noop} />);
  expect(screen.getByText("Note d'arrivée")).toBeInTheDocument();
  expect(screen.getByText('Récupérer la 2e clé')).toBeInTheDocument();
});

test('handover note — nothing rendered when departureHandoverNote is empty', () => {
  render(<DepartureMiniRow reservation={BASE} onToggleDone={noop} />);
  expect(screen.queryByText("Note d'arrivée")).toBeNull();
});
