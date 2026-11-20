// specs/mixed-method-payments.md rule 59 (reading of 2026-11-19, loop t26) — any line the operator types in is typed: removing the line
// after it keeps its amount; the shortfall choice travels with the due it answered, through a remount on another due and back.
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TenderLines from '../TenderLines';

const amount = (i) => document.querySelector(`[data-tender-amount="${i}"]`);

test('a typed first line keeps its amount when the line after it is removed', () => {
  render(<TenderLines dueCents={5000} onChange={() => {}} />);
  fireEvent.change(amount(0), { target: { value: '12' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Retirer cette ligne' })[1]);
  expect(amount(0)).toHaveValue('12');
  expect(document.querySelector('[data-tender-meter]').textContent).toMatch(/38,00 € non couverts/);
});

function Host({ initialDraft }) {
  const [due, setDue] = useState(4000);
  return (
    <>
      <button type="button" onClick={() => setDue(5000)}>back</button>
      <TenderLines key={due} dueCents={due} initialDraft={initialDraft} onChange={() => {}} />
    </>
  );
}

test('the shortfall choice comes back on its own due after a remount on another due', () => {
  const draft = { lines: [{ method: 'card', amount: '10', internal: false, typed: true }], shortKind: 'waived', shortDueCents: 5000, dueCents: 4000 };
  render(<Host initialDraft={draft} />);
  expect(document.querySelector('[data-shortfall][aria-pressed="true"]')).toBeNull();
  fireEvent.click(screen.getByText('back'));
  expect(document.querySelector('[data-shortfall][aria-pressed="true"]').getAttribute('data-shortfall')).toBe('waived');
});
