// specs/mixed-method-payments.md rules 7, 44 (audits R34-C-L2, R34-M-M1) — TenderLines: the whole amount typed on the
// first line leaves the untyped last line at 0, which is no line (« Reste 0,00 € » and the submit agree); and where the
// amount is paid whole (the acompte, an installment) a cash line starts on the books, no shortfall choice is offered,
// and an installment has no « Caisse interne » at all.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import TenderLines from '../TenderLines';

const amount = (i) => document.querySelector(`[data-tender-amount="${i}"]`);
const meter = () => document.querySelector('[data-tender-meter]').textContent;
const last = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];

test('rule 7 (R34-C-L2) — 122 € typed in Espèces: the empty CB line is not sent, the submit is open', () => {
  const onChange = vi.fn();
  render(<TenderLines dueCents={12200} onChange={onChange} />);
  fireEvent.change(amount(0), { target: { value: '122' } });
  expect(meter()).toBe('Reste 0,00 €');
  expect(last(onChange)).toMatchObject({ canSubmit: true, tenders: [{ method: 'cash', amountCents: 12200, internal: true }] });
});

test('rule 7 — a typed line at 0 still blocks: only the untyped remainder line is dropped', () => {
  const onChange = vi.fn();
  render(<TenderLines dueCents={12200} onChange={onChange} />);
  fireEvent.change(amount(0), { target: { value: '122' } });
  fireEvent.change(amount(1), { target: { value: '0' } });
  expect(last(onChange).canSubmit).toBe(false);
});

test('rule 44 — paid whole: the cash line starts on the books, and short of the amount nothing can be chosen', () => {
  const onChange = vi.fn();
  render(<TenderLines dueCents={20000} whole onChange={onChange} />);
  expect(screen.getByRole('switch', { name: 'Caisse interne' })).not.toBeChecked();
  fireEvent.change(amount(0), { target: { value: '50' } });
  fireEvent.change(amount(1), { target: { value: '100' } });
  expect(document.querySelector('[data-shortfall]')).toBeNull();
  expect(document.querySelector('[data-tender-whole]').textContent).toBe('Le montant entier, sans reste ni geste.');
  expect(last(onChange)).toMatchObject({ canSubmit: false, shortfall: null });
});

test('rule 44 — an installment: no « Caisse interne » switch, a cash line is on the books', () => {
  const onChange = vi.fn();
  render(<TenderLines dueCents={30000} whole noCaisse onChange={onChange} />);
  expect(screen.queryByRole('switch', { name: 'Caisse interne' })).toBeNull();
  fireEvent.change(amount(0), { target: { value: '100' } });
  expect(last(onChange)).toMatchObject({
    canSubmit: true,
    tenders: [{ method: 'cash', amountCents: 10000, internal: false }, { method: 'card', amountCents: 20000, internal: false }],
  });
});
