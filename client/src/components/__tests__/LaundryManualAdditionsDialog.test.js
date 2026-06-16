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
