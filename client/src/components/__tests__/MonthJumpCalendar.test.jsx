// specs/gift-voucher-campaigns.md rule 51 — a day picker over a long horizon: month chips from the current month to the
// horizon's, a month grid with the days past the horizon (and before today) disabled, « Prochaine disponibilité ».
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import MonthJumpCalendar from '../MonthJumpCalendar';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 18, 12)); });
afterEach(() => vi.useRealTimers());

const chips = () => within(screen.getByRole('group', { name: 'Aller à un mois' })).getAllByRole('button');
const day = (label) => screen.getByRole('button', { name: new RegExp(`^${label}`) });

test('one chip per month from the current one to the horizon\'s, the year said on the first and after each January', () => {
  render(<MonthJumpCalendar value="" onChange={() => {}} horizonUntil="2027-02-10" />);
  expect(chips().map((c) => c.textContent)).toEqual(['nov. 2026', 'déc.', 'janv. 2027', 'févr.']);
  expect(chips()[0]).toHaveAttribute('aria-pressed', 'true');
});

test('a chip jumps to its month; the days past the horizon and before today are disabled, the others pick', () => {
  const onChange = vi.fn();
  render(<MonthJumpCalendar value="" onChange={onChange} horizonUntil="2027-02-10" />);
  expect(day('mercredi 18 novembre 2026')).toBeEnabled();
  expect(day('mardi 17 novembre 2026')).toBeDisabled();
  fireEvent.click(chips()[3]);
  expect(screen.getByRole('heading', { name: 'février 2027' })).toBeInTheDocument();
  expect(day('mercredi 10 février 2027')).toBeEnabled();
  expect(day('jeudi 11 février 2027')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Mois suivant' })).toBeDisabled();
  fireEvent.click(day('lundi 8 février 2027'));
  expect(onChange).toHaveBeenCalledWith('2027-02-08');
  fireEvent.click(day('jeudi 11 février 2027'));
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('the selected day is marked and its month is the one shown', () => {
  render(<MonthJumpCalendar value="2027-01-15" onChange={() => {}} horizonUntil="2027-02-10" />);
  expect(screen.getByRole('heading', { name: 'janvier 2027' })).toBeInTheDocument();
  expect(day('vendredi 15 janvier 2027')).toHaveAttribute('aria-pressed', 'true');
});

test('the arrows stop at the current month and at the horizon\'s', () => {
  render(<MonthJumpCalendar value="" onChange={() => {}} horizonUntil="2026-12-20" />);
  expect(screen.getByRole('button', { name: 'Mois précédent' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Mois suivant' }));
  expect(screen.getByRole('heading', { name: 'décembre 2026' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mois suivant' })).toBeDisabled();
});

test('isDayDisabled greys out more days, without moving the horizon', () => {
  render(<MonthJumpCalendar value="" onChange={() => {}} horizonUntil="2027-02-10" isDayDisabled={(iso) => iso === '2026-11-20'} />);
  expect(day('vendredi 20 novembre 2026')).toBeDisabled();
  expect(day('samedi 21 novembre 2026')).toBeEnabled();
});

test('« Prochaine disponibilité » exists only when the parent can answer it', () => {
  const { rerender } = render(<MonthJumpCalendar value="" onChange={() => {}} horizonUntil="2027-02-10" />);
  expect(screen.queryByRole('button', { name: 'Prochaine disponibilité' })).toBeNull();
  const onNextAvailable = vi.fn();
  rerender(<MonthJumpCalendar value="" onChange={() => {}} horizonUntil="2027-02-10" onNextAvailable={onNextAvailable} />);
  fireEvent.click(screen.getByRole('button', { name: 'Prochaine disponibilité' }));
  expect(onNextAvailable).toHaveBeenCalledTimes(1);
});

test('without a horizon the grid is not bounded forward and no chips are drawn', () => {
  render(<MonthJumpCalendar value="" onChange={() => {}} />);
  expect(screen.queryByRole('group', { name: 'Aller à un mois' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Mois suivant' })).toBeEnabled();
});
