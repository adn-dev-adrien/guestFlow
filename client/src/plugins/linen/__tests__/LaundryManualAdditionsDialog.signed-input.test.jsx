import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import LaundryManualAdditionsDialog, { parseSignedCount } from '../LaundryManualAdditionsDialog';

// specs/laundry-manual-removals.md rule 9 and specs/laundry-bath-mat.md rule 13 — a count typed with
// its sign keeps it, and the bath mats have their own stepper (mega review #5, M4: « -3 » saved +3, and
// the mats the card counts could not be added).

const ZERO = { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0, bathMats: 0 };

test('rule 9 — the typed text means its signed count; a lone sign is still 0', () => {
  expect(parseSignedCount('-3')).toBe(-3);
  expect(parseSignedCount('−2')).toBe(-2);
  expect(parseSignedCount('-')).toBe(0);
  expect(parseSignedCount('')).toBe(0);
  expect(parseSignedCount('4')).toBe(4);
  expect(parseSignedCount('abc')).toBe(0);
});

test('rule 9 — typing « - » then « 3 » saves −3, and the field keeps the sign while typing', () => {
  const onSave = vi.fn();
  render(<LaundryManualAdditionsDialog open date="2026-10-27" current={ZERO} onSave={onSave} onClose={() => {}} />);
  const field = screen.getByRole('textbox', { name: 'Double' });
  fireEvent.change(field, { target: { value: '-' } });
  expect(field).toHaveValue('-');
  fireEvent.change(field, { target: { value: '-3' } });
  expect(field).toHaveValue('-3');
  expect(screen.getByText('lavé hors blanchisserie')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledWith('2026-10-27', expect.objectContaining({ doubleBeds: -3 }));
});

test('rule 9 — a letter is refused: the field keeps its previous value', () => {
  render(<LaundryManualAdditionsDialog open date="2026-10-27" current={{ ...ZERO, doubleBeds: 2 }} onSave={() => {}} onClose={() => {}} />);
  const field = screen.getByRole('textbox', { name: 'Double' });
  fireEvent.change(field, { target: { value: '2a' } });
  expect(field).toHaveValue('2');
});

test('rule 9 — a lone « - » left on blur settles back to 0', () => {
  render(<LaundryManualAdditionsDialog open date="2026-10-27" current={ZERO} onSave={() => {}} onClose={() => {}} />);
  const field = screen.getByRole('textbox', { name: 'Simple' });
  fireEvent.change(field, { target: { value: '-' } });
  fireEvent.blur(field);
  expect(field).toHaveValue('0');
});

// specs/laundry-bath-mat.md rule 13
test('rule 13 — the « Tapis » stepper adds bath mats to the line', () => {
  const onSave = vi.fn();
  render(<LaundryManualAdditionsDialog open date="2026-10-27" current={ZERO} onSave={onSave} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Tapis' }), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledWith('2026-10-27', expect.objectContaining({ bathMats: 2 }));
});
