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
  clientId: 55,
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

test('actions — clicking the card body opens the reservation fiche (no separate « open » icon)', () => {
  const onOpenReservation = vi.fn();
  render(
    <ReservationCard reservation={BASE} onToggleReady={noop} onOpenReservation={onOpenReservation} />
  );
  expect(screen.queryByLabelText('Ouvrir la réservation')).not.toBeInTheDocument(); // icon removed
  fireEvent.click(screen.getByText('ARRIVÉE'));
  expect(onOpenReservation).toHaveBeenCalledWith(100);
});

test('SAS button — opens the arrival SAS when not yet done', () => {
  const onOpenSas = vi.fn();
  render(
    <ReservationCard reservation={BASE} onToggleReady={noop} onOpenSas={onOpenSas} />
  );
  const sasBtn = screen.getByRole('button', { name: 'Check-in (SAS arrivée)' });
  expect(sasBtn).not.toBeDisabled();
  fireEvent.click(sasBtn);
  expect(onOpenSas).toHaveBeenCalledWith(100);
});

test('SAS button — once the arrival SAS is done it stays a clickable ✓ for re-edit', () => {
  // specs/reopen-completed-sas.md §3 rule 1 — a finished SAS can be re-opened to review / correct.
  const onOpenSas = vi.fn();
  const r = { ...BASE, arrivalSasDoneAt: '2026-06-13 09:00:00' };
  render(<ReservationCard reservation={r} onToggleReady={noop} onOpenSas={onOpenSas} />);
  const sasBtn = screen.getByRole('button', { name: 'Revoir / modifier le check-in' });
  expect(sasBtn).not.toBeDisabled();
  fireEvent.click(sasBtn);
  expect(onOpenSas).toHaveBeenCalledWith(100);
});

test('client name — clicking it opens the client fiche via onOpenClient(clientId)', () => {
  const onOpenClient = vi.fn();
  render(
    <ReservationCard reservation={BASE} onToggleReady={noop} onOpenClient={onOpenClient} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Famille Dupont' }));
  expect(onOpenClient).toHaveBeenCalledWith(55);
});

test('ready checkbox — toggling it does NOT trigger any open handler (stopPropagation)', () => {
  const onOpenReservation = vi.fn();
  const onToggleReady = vi.fn();
  render(
    <ReservationCard
      reservation={BASE}
      onToggleReady={onToggleReady}
      onOpenReservation={onOpenReservation}
    />
  );
  fireEvent.click(screen.getByRole('checkbox'));
  expect(onToggleReady).toHaveBeenCalled();
  expect(onOpenReservation).not.toHaveBeenCalled();
});

test('open handlers omitted — card renders read-only with no action buttons', () => {
  render(<ReservationCard reservation={BASE} onToggleReady={noop} />);
  expect(screen.queryByLabelText('Ouvrir la réservation')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Check-in (SAS arrivée)')).not.toBeInTheDocument();
  // Client name falls back to plain text (no button) when onOpenClient is absent.
  expect(screen.queryByRole('button', { name: 'Famille Dupont' })).not.toBeInTheDocument();
  expect(screen.getByText('Famille Dupont')).toBeInTheDocument();
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
  // Canonical formatCurrency output (ds phase 5): « 45,00 € », not the legacy « 45.00€ ».
  expect(screen.getByText(/Complément à percevoir : 45,00 €/)).toBeInTheDocument();
});

test('complement — marks it (perçu) when complementPaid', () => {
  render(<ReservationCard reservation={{ ...BASE, complementAmount: 45, complementPaid: true }} onToggleReady={noop} />);
  expect(screen.getByText(/Complément à percevoir : 45,00 € \(perçu\)/)).toBeInTheDocument();
});

test('complement — no chip when complementAmount is 0 / absent', () => {
  render(<ReservationCard reservation={BASE} onToggleReady={noop} />);
  expect(screen.queryByText(/Complément à percevoir/)).toBeNull();
});

// Caution to collect: when the security deposit is unpaid, the arrival tile surfaces the amount in
// red so the host knows to collect it at check-in.
test('caution — shows "Caution à percevoir" with the amount when unpaid (cautionReceived = 0)', () => {
  render(<ReservationCard reservation={{ ...BASE, cautionAmount: 300, cautionReceived: 0 }} onToggleReady={noop} />);
  expect(screen.getByText(/Caution à percevoir : 300,00 €/)).toBeInTheDocument();
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

// Bed-linen alert (specs/planning-arrival-alerts.md §3 rule 14) — server-computed `bedLinenAlert`.
test('bed-linen alert — "non pris" when bedLinenAlert.type is no_linen', () => {
  render(<ReservationCard reservation={{ ...BASE, bedLinenAlert: { type: 'no_linen' } }} onToggleReady={noop} />);
  expect(screen.getByText('Linge de lit non pris')).toBeInTheDocument();
});

test('bed-linen alert — capacity mismatch shows the numbers', () => {
  render(<ReservationCard reservation={{ ...BASE, bedLinenAlert: { type: 'capacity', capacity: 3, required: 4 } }} onToggleReady={noop} />);
  expect(screen.getByText(/Linge de lit insuffisant : 3 couchages pour 4 pers\./)).toBeInTheDocument();
});

test('bed-linen alert — nothing rendered when bedLinenAlert is absent', () => {
  render(<ReservationCard reservation={BASE} onToggleReady={noop} />);
  expect(screen.queryByText(/Linge de lit/)).toBeNull();
});

// ── Action icons + responsive placement (PR #197) ───────────────────────────

test('the check-in (SAS) icon is the large checklist; the open-reservation icon is gone', () => {
  const { container } = render(
    <ReservationCard reservation={BASE} onToggleReady={noop} onOpenReservation={vi.fn()} onOpenSas={vi.fn()} />
  );
  expect(container.querySelector('[data-testid="ArticleIcon"]')).not.toBeInTheDocument(); // open-fiche icon removed
  const checklist = container.querySelector('[data-testid="ChecklistIcon"]');
  expect(checklist).toBeInTheDocument();
  expect(checklist).toHaveStyle({ fontSize: '40px' }); // big tap target
});

test('SAS-done state shows the ✓ (CheckCircle) instead of the checklist icon', () => {
  const r = { ...BASE, arrivalSasDoneAt: '2026-06-13 09:00:00' };
  const { container } = render(
    <ReservationCard reservation={r} onToggleReady={noop} onOpenSas={vi.fn()} />
  );
  expect(container.querySelector('[data-testid="ChecklistIcon"]')).not.toBeInTheDocument();
  expect(container.querySelector('[data-testid="CheckCircleIcon"]')).toBeInTheDocument();
});

test('mobile (matchMedia matches) renders each action button exactly ONCE (no CSS-display duplicate)', () => {
  const orig = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
  try {
    render(
      <ReservationCard reservation={BASE} onToggleReady={noop} onOpenReservation={vi.fn()} onOpenSas={vi.fn()} />
    );
    // getByRole throws if there were two — pins the single-render (useMediaQuery branch, not display:none).
    expect(screen.getByRole('button', { name: 'Check-in (SAS arrivée)' })).toBeInTheDocument();
  } finally {
    window.matchMedia = orig;
  }
});
