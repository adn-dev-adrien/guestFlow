// specs/mixed-method-payments.md rule 15 — under the amount due, TenderLines warns and asks what becomes of the
// amount not received; nothing can be submitted until « Reste à percevoir » or « Geste commercial » is picked.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import TenderLines from '../TenderLines';

const amount = (i) => document.querySelector(`[data-tender-amount="${i}"]`);
const last = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];

function shortBy8(onChange) {
  render(<TenderLines dueCents={12200} onChange={onChange} />);
  fireEvent.change(amount(0), { target: { value: '50' } });
  fireEvent.change(amount(1), { target: { value: '64' } });
}

test('the warning names the amount not covered and offers the two choices', () => {
  const onChange = vi.fn();
  shortBy8(onChange);
  expect(document.querySelector('[data-tender-meter]').textContent).toBe('8,00 € non couverts');
  expect(screen.getByText('8,00 € ne sont pas couverts.')).toBeInTheDocument();
  expect(screen.getByText('La fiche garde 8,00 € à encaisser plus tard.')).toBeInTheDocument();
  expect(screen.getByText('8,00 € accordés, enregistrés en réduction.')).toBeInTheDocument();
  expect(last(onChange).canSubmit).toBe(false);
});

test('picking « Reste à percevoir » allows the submit, with the shortfall', () => {
  const onChange = vi.fn();
  shortBy8(onChange);
  fireEvent.click(document.querySelector('[data-shortfall="due"]'));
  expect(last(onChange)).toMatchObject({ canSubmit: true, shortfall: { kind: 'due' }, receivedCents: 11400, gapCents: 800 });
});

test('picking « Geste commercial » sends the waived kind', () => {
  const onChange = vi.fn();
  shortBy8(onChange);
  fireEvent.click(document.querySelector('[data-shortfall="waived"]'));
  expect(last(onChange).shortfall).toEqual({ kind: 'waived' });
});

test('covering the total again removes the warning and the choice', () => {
  const onChange = vi.fn();
  shortBy8(onChange);
  fireEvent.click(document.querySelector('[data-shortfall="due"]'));
  fireEvent.change(amount(1), { target: { value: '72' } });
  expect(screen.queryByText(/ne sont pas couverts/)).toBeNull();
  expect(last(onChange)).toMatchObject({ canSubmit: true, shortfall: null });
});
