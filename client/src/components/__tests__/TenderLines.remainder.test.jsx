// specs/mixed-method-payments.md rules 4-9 — TenderLines: the last untyped line shows the remainder, typing in
// it freezes it, the meter says where the operator stands, and the lines reported upward are in cents.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import TenderLines from '../TenderLines';

const amount = (i) => document.querySelector(`[data-tender-amount="${i}"]`);
const meter = () => document.querySelector('[data-tender-meter]').textContent;
const last = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];

test('two lines are proposed: Espèces in the caisse interne, then CB', () => {
  render(<TenderLines dueCents={12200} onChange={() => {}} />);
  const selects = screen.getAllByRole('combobox');
  expect(selects.map((s) => s.value)).toEqual(['cash', 'card']);
  expect(screen.getByRole('switch', { name: 'Caisse interne' })).toBeChecked();
});

test('typing 50 in Espèces leaves 72,00 on the CB line and the meter at 0', () => {
  const onChange = vi.fn();
  render(<TenderLines dueCents={12200} onChange={onChange} />);
  fireEvent.change(amount(0), { target: { value: '50' } });
  expect(amount(1).value).toBe('72,00');
  expect(meter()).toBe('Reste 0,00 €');
  expect(last(onChange)).toMatchObject({
    canSubmit: true,
    shortfall: null,
    tenders: [{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 7200, internal: false }],
  });
});

test('arithmetic is accepted in a line', () => {
  render(<TenderLines dueCents={12200} onChange={() => {}} />);
  fireEvent.change(amount(0), { target: { value: '40+10' } });
  expect(amount(1).value).toBe('72,00');
});

test('over the amount due, the meter says how much too much and nothing can be submitted', () => {
  const onChange = vi.fn();
  render(<TenderLines dueCents={12200} onChange={onChange} />);
  fireEvent.change(amount(0), { target: { value: '50' } });
  fireEvent.change(amount(1), { target: { value: '80' } });
  expect(meter()).toBe('8,00 € de trop');
  expect(last(onChange).canSubmit).toBe(false);
});

test('« Ajouter un moyen » freezes the remainder and adds the first unused method, up to four lines', () => {
  render(<TenderLines dueCents={12200} onChange={() => {}} />);
  fireEvent.change(amount(0), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /Ajouter un moyen/ }));
  expect(screen.getAllByRole('combobox').map((s) => s.value)).toEqual(['cash', 'card', 'cheque']);
  expect(amount(1).value).toBe('72,00');
  fireEvent.click(screen.getByRole('button', { name: /Ajouter un moyen/ }));
  expect(screen.queryByRole('button', { name: /Ajouter un moyen/ })).toBeNull();
});

test('a correction is prefilled with its lines', () => {
  const onChange = vi.fn();
  render(<TenderLines dueCents={12200} initialTenders={[{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 7200, internal: false }]} onChange={onChange} />);
  expect(amount(0).value).toBe('50,00');
  expect(amount(1).value).toBe('72,00');
  expect(last(onChange).canSubmit).toBe(true);
});
