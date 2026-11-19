// specs/mixed-method-payments.md rule 59 (reading of 2026-11-19, loop t25 B25-1) — the shortfall choice answers for one amount due. A draft
// brings it back only for the same due; for another due the lines stay as typed and the choice is asked again, the commit waiting for it
// (before: « Geste commercial » chosen for 50 € of 500 € came back for 134 € of 584 € and was recorded without being asked). A due that
// changes while the block is mounted asks it again the same way.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import TenderLines from '../TenderLines';

const lastReport = (onChange) => onChange.mock.calls[onChange.mock.calls.length - 1][0];
const SHORT_LINES = [
  { method: 'cash', amount: '400', internal: true, typed: true },
  { method: 'card', amount: '50', internal: false, typed: true },
];

// A first mount at 500 €, 450 typed, « Geste commercial » chosen: its draft.
function chosenDraft() {
  const first = vi.fn();
  const view = render(<TenderLines dueCents={50000} onChange={first} initialDraft={{ lines: SHORT_LINES, shortKind: null, dueCents: 50000 }} />);
  fireEvent.click(screen.getByText('Geste commercial'));
  expect(lastReport(first)).toMatchObject({ canSubmit: true, shortfall: { kind: 'waived' }, gapCents: 5000 });
  const { draft } = lastReport(first);
  view.unmount();
  return draft;
}

test('the draft carries the due its shortfall choice answered', () => {
  expect(chosenDraft()).toMatchObject({ shortKind: 'waived', dueCents: 50000 });
});

test('same due: the lines and the shortfall choice come back, the commit can go', () => {
  const draft = chosenDraft();
  const again = vi.fn();
  render(<TenderLines dueCents={50000} onChange={again} initialDraft={draft} />);
  expect(lastReport(again)).toMatchObject({ canSubmit: true, shortfall: { kind: 'waived' }, gapCents: 5000 });
});

test('another due: the lines come back as typed, the shortfall is asked again and the commit waits for it', () => {
  const draft = chosenDraft();
  const again = vi.fn();
  render(<TenderLines dueCents={58400} onChange={again} initialDraft={draft} />);
  const amounts = document.querySelectorAll('[data-tender-amount]');
  expect([amounts[0].value, amounts[1].value]).toEqual(['400', '50']);
  expect(lastReport(again)).toMatchObject({ canSubmit: false, shortfall: null, gapCents: 13400 });
  fireEvent.click(screen.getByText('Geste commercial'));
  expect(lastReport(again)).toMatchObject({ canSubmit: true, shortfall: { kind: 'waived' }, gapCents: 13400 });
  expect(lastReport(again).draft).toMatchObject({ shortKind: 'waived', dueCents: 58400 });
});

test('a draft from before the due was recorded (no `dueCents`) brings no shortfall choice back', () => {
  const again = vi.fn();
  render(<TenderLines dueCents={50000} onChange={again} initialDraft={{ lines: SHORT_LINES, shortKind: 'waived' }} />);
  expect(lastReport(again)).toMatchObject({ canSubmit: false, shortfall: null });
});

test('a due that changes while mounted asks the shortfall again', () => {
  const onChange = vi.fn();
  const view = render(<TenderLines dueCents={50000} onChange={onChange} initialDraft={{ lines: SHORT_LINES, shortKind: null, dueCents: 50000 }} />);
  fireEvent.click(screen.getByText('Geste commercial'));
  expect(lastReport(onChange)).toMatchObject({ canSubmit: true, shortfall: { kind: 'waived' } });
  view.rerender(<TenderLines dueCents={58400} onChange={onChange} initialDraft={{ lines: SHORT_LINES, shortKind: null, dueCents: 50000 }} />);
  expect(lastReport(onChange)).toMatchObject({ canSubmit: false, shortfall: null, gapCents: 13400 });
});

test('a correction prefilled with its shortfall choice keeps it for the due it opened on', () => {
  const onChange = vi.fn();
  render(<TenderLines dueCents={50000} onChange={onChange} initialTenders={[{ method: 'cash', amountCents: 45000, internal: true }]} initialShortfallKind="due" />);
  expect(lastReport(onChange)).toMatchObject({ canSubmit: true, shortfall: { kind: 'due' }, gapCents: 5000 });
});
