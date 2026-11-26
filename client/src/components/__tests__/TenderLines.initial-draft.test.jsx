// specs/payments/mixed-method-payments.md rule 59 (loop t24, 2026-11-18) — `initialDraft`: the lines an earlier mount reported come back as
// the operator left them. A typed line keeps its text whatever the new due; the untyped last line shows what the others leave of the new
// due; nothing is rewritten silently, the meter says what no longer fits.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import TenderLines from '../TenderLines';

const lastReport = (onChange) => onChange.mock.calls[onChange.mock.calls.length - 1][0];

test('a draft round-trips: typed text kept, the untyped last line follows the new due', () => {
  const first = vi.fn();
  const view = render(<TenderLines dueCents={50000} onChange={first} />);
  const draft = { ...lastReport(first).draft, lines: lastReport(first).draft.lines.map((l, i) => (i === 0 ? { ...l, amount: '10', typed: true } : l)) };
  view.unmount();
  const again = vi.fn();
  render(<TenderLines dueCents={58400} onChange={again} initialDraft={draft} />);
  const amounts = document.querySelectorAll('[data-tender-amount]');
  expect(amounts[0]).toHaveValue('10');
  expect(lastReport(again).tenders.map((t) => t.amountCents)).toEqual([1000, 57400]);
  expect(lastReport(again).gapCents).toBe(0);
});

test('a draft whose typed lines exceed the new due is left as typed: the meter says it', () => {
  const draft = { lines: [{ method: 'cash', amount: '100', internal: true, typed: true }, { method: 'card', amount: '50', internal: false, typed: true }], shortKind: null };
  const onChange = vi.fn();
  render(<TenderLines dueCents={8000} onChange={onChange} initialDraft={draft} />);
  expect(document.querySelectorAll('[data-tender-amount]')[0]).toHaveValue('100');
  expect(lastReport(onChange).gapCents).toBe(-7000);
  expect(lastReport(onChange).canSubmit).toBe(false);
  expect(screen.getByText(/de trop|en trop|dépasse/i)).toBeInTheDocument();
});
