import React from 'react';
import { render, screen } from '@testing-library/react';

import LaundryDayCard from '../LaundryDayCard';

// Regression tests for the LaundryDayCard rendering rules
// (specs/weekly-bed-linen-tracking.md rules 13, 13.bis, §6.1).
//
// These pin the rules that would otherwise silently regress if anyone touches the formatTowels /
// formatSheets helpers or the SideBlock fallback:
//   - All-zero on BOTH sides → renders nothing (rule 13).
//   - Drop-off only → renders ONLY the relevant sub-lines, never "À récupérer: 12 grandes".
//   - Zero-count towel sizes are omitted from the line (rule 13.bis).
//   - Mixed beds + towels render under the same block headers.

const ZERO = { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0 };

test('renders null when both sides are entirely zero (rule 13)', () => {
  const { container } = render(<LaundryDayCard data={{ dropOff: ZERO, pickUp: ZERO }} />);
  expect(container.firstChild).toBeNull();
});

test('renders null when data is undefined / null', () => {
  const { container: a } = render(<LaundryDayCard data={undefined} />);
  expect(a.firstChild).toBeNull();
  const { container: b } = render(<LaundryDayCard data={null} />);
  expect(b.firstChild).toBeNull();
});

test('drop-off only: pickUp side shows the em-dash placeholder', () => {
  render(<LaundryDayCard data={{
    dropOff: { ...ZERO, doubleBeds: 2, largeTowels: 3, smallTowels: 3 },
    pickUp: ZERO,
  }} />);
  expect(screen.getByText('À apporter')).toBeInTheDocument();
  expect(screen.getByText('À récupérer')).toBeInTheDocument();
  // Drop-off side shows the lines, pickUp side shows the "—" placeholder.
  expect(screen.getByText(/2 double/)).toBeInTheDocument();
  expect(screen.getByText(/3 grande/)).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
});

test('hides a towel size when its count is zero (rule 13.bis)', () => {
  // medium = 0 must NOT render "0 moyennes"; the medium segment is omitted entirely.
  render(<LaundryDayCard data={{
    dropOff: { ...ZERO, largeTowels: 7, mediumTowels: 0, smallTowels: 7 },
    pickUp: ZERO,
  }} />);
  // Towel line is rendered with only the non-zero sizes joined by " · ".
  expect(screen.getByText(/7 grandes · 7 petites/)).toBeInTheDocument();
  expect(screen.queryByText(/moyenne/i)).not.toBeInTheDocument();
});

test('renders the 3 towel sizes when ALL are non-zero (medium > 0 use case)', () => {
  render(<LaundryDayCard data={{
    dropOff: { ...ZERO, largeTowels: 4, mediumTowels: 2, smallTowels: 4 },
    pickUp: ZERO,
  }} />);
  expect(screen.getByText(/4 grandes · 2 moyennes · 4 petites/)).toBeInTheDocument();
});

test('beds AND towels render side-by-side with their own labels', () => {
  render(<LaundryDayCard data={{
    dropOff: { singleBeds: 9, doubleBeds: 8, babyBeds: 1, largeTowels: 19, mediumTowels: 0, smallTowels: 19 },
    pickUp: ZERO,
  }} />);
  // Adrien's prod numbers pinned through the formatter — any wording change breaks here.
  expect(screen.getByText('Draps :')).toBeInTheDocument();
  expect(screen.getByText('Serviettes :')).toBeInTheDocument();
  expect(screen.getByText(/8 doubles · 9 simples · 1 bébé/)).toBeInTheDocument();
  expect(screen.getByText(/19 grandes · 19 petites/)).toBeInTheDocument();
});

test('singular vs plural agreement on beds + towels', () => {
  render(<LaundryDayCard data={{
    dropOff: { singleBeds: 1, doubleBeds: 1, babyBeds: 0, largeTowels: 1, mediumTowels: 0, smallTowels: 1 },
    pickUp: ZERO,
  }} />);
  // "1 double" not "1 doubles", "1 simple" not "1 simples", "1 grande" / "1 petite".
  expect(screen.getByText(/1 double · 1 simple/)).toBeInTheDocument();
  expect(screen.getByText(/1 grande · 1 petite/)).toBeInTheDocument();
});

test('pickup-only week renders the symmetric layout (drop-off side is "—")', () => {
  // A previous-week drop-off bouncing back: only the pickUp side has data.
  render(<LaundryDayCard data={{
    dropOff: ZERO,
    pickUp: { ...ZERO, doubleBeds: 5, largeTowels: 10, smallTowels: 10 },
  }} />);
  expect(screen.getByText('À apporter')).toBeInTheDocument();
  expect(screen.getByText('À récupérer')).toBeInTheDocument();
  expect(screen.getByText(/5 doubles/)).toBeInTheDocument();
  expect(screen.getByText(/10 grandes · 10 petites/)).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument(); // drop-off placeholder
});

test('all-zero on ONE side + non-zero on the other still renders the card (not symmetric to rule 13)', () => {
  // Rule 13 fires ONLY when both sides are zero. Exactly one zero side is the regular case.
  const { container } = render(<LaundryDayCard data={{
    dropOff: { ...ZERO, doubleBeds: 1 },
    pickUp: ZERO,
  }} />);
  // The card itself renders (root MUI Card element is present).
  expect(container.firstChild).not.toBeNull();
});
