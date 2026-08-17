import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import LaundryManualAdditionsDialog from '../LaundryManualAdditionsDialog';

// specs/manual-laundry-additions.md §6 — the per-trip manual-linen editor.

const ZERO = { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0 };

test('closed → nothing actionable rendered', () => {
  render(<LaundryManualAdditionsDialog open={false} date={null} onSave={() => {}} onClose={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
});

test('pre-fills the trip current values; Save sends the six counts back for that date', () => {
  const onSave = vi.fn();
  render(
    <LaundryManualAdditionsDialog open date="2026-06-16" current={{ ...ZERO, doubleBeds: 2 }}
      onSave={onSave} onClose={() => {}} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledWith('2026-06-16', expect.objectContaining({ doubleBeds: 2 }));
});

test('the first « + » increments the first type (Simple); Save reflects it', () => {
  const onSave = vi.fn();
  render(<LaundryManualAdditionsDialog open date="2026-06-16" current={ZERO} onSave={onSave} onClose={() => {}} />);
  fireEvent.click(screen.getAllByRole('button', { name: '+' })[0]); // Draps → Simple
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledWith('2026-06-16', expect.objectContaining({ singleBeds: 1 }));
});

test('Annuler calls onClose without saving', () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<LaundryManualAdditionsDialog open date="2026-06-16" current={ZERO} onSave={onSave} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(onClose).toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});

// ---- withdrawals: « je lave moi-même » (specs/laundry-manual-removals.md §6) ----

test('« − » goes below zero and the withdrawal is sent as a negative count', () => {
  const onSave = vi.fn();
  render(<LaundryManualAdditionsDialog open date="2026-06-16" current={ZERO} onSave={onSave} onClose={() => {}} />);
  const minus = screen.getAllByRole('button', { name: '−' })[0]; // Draps → Simple
  expect(minus).not.toBeDisabled();
  fireEvent.click(minus);
  fireEvent.click(minus);
  // The line says out loud what a negative number means.
  expect(screen.getByText('lavé par vos soins')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledWith('2026-06-16', expect.objectContaining({ singleBeds: -2 }));
});

test('a stored withdrawal pre-fills as a negative value and can be typed by hand', () => {
  const onSave = vi.fn();
  render(
    <LaundryManualAdditionsDialog open date="2026-06-16" current={{ ...ZERO, doubleBeds: -3 }}
      onSave={onSave} onClose={() => {}} />,
  );
  expect(screen.getByDisplayValue('-3')).toBeInTheDocument();
  fireEvent.change(screen.getByDisplayValue('-3'), { target: { value: '-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledWith('2026-06-16', expect.objectContaining({ doubleBeds: -1 }));
});
