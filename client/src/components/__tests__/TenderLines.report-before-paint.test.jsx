// specs/payments/mixed-method-payments.md rule 59 (reading of 2026-11-19, loop t25 verifier) — the lines' report reaches the screen before paint, so
// a commit button never shows a frame judged on the previous lines (before: typing « 2 » in the last line drew 1 + 2 with « 9,50 € non
// couverts » unanswered while « Encaisser 12,50 € » was clickable — a click would have sent 1 + 11,50). The keystroke is dispatched as the
// browser does, outside `act`, and the button is read synchronously right after it: no waitFor, no flushed passive effect.
import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import TenderLines, { tendersForDue } from '../TenderLines';

function Screen({ dueCents, onCommit }) {
  const [report, setReport] = useState(null);
  const now = tendersForDue(report, dueCents);
  return (
    <>
      <TenderLines dueCents={dueCents} onChange={setReport} />
      <button type="button" disabled={!(now && now.canSubmit)} onClick={() => { if (now && now.canSubmit && now.live()) onCommit(now.tenders); }}>Encaisser</button>
    </>
  );
}
const typeNatively = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const amount = (i) => document.querySelector(`[data-tender-amount="${i}"]`);
const commitButton = () => screen.getByRole('button', { name: 'Encaisser' });
// The lines' own validity, read off the screen: every amount readable and above 0, and the due covered or its shortfall answered.
const valid = () => [...document.querySelectorAll('[data-tender-amount]')].every((i) => /^\d+([.,]\d+)?$/.test(i.value.trim()) && Number(i.value.replace(',', '.')) > 0)
  && (/Reste 0,00/.test(document.body.textContent) || Boolean(document.querySelector('[data-shortfall][aria-pressed="true"]')));

let previous;
beforeAll(() => { previous = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
afterAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });

test('after every keystroke and choice, the button agrees with the lines on screen in the same frame', async () => {
  const onCommit = vi.fn();
  render(<Screen dueCents={1250} onCommit={onCommit} />);
  await act(async () => {});
  expect(commitButton().disabled).toBe(!valid());
  // Each step dispatched natively; the assertion runs synchronously after it.
  const steps = [
    () => typeNatively(amount(0), '1'), // 1 + 11,50 (the untyped last line) — covered
    () => typeNatively(amount(1), '2'), // 1 + 2 — 9,50 short, unanswered
    () => typeNatively(amount(1), '11,5'), // covered again
    () => typeNatively(amount(1), '1'), // short again
    () => fireEvent.click(document.querySelector('[data-shortfall="waived"]')), // answered
    () => typeNatively(amount(0), 'x'), // unreadable
  ];
  const states = [];
  for (const step of steps) {
    step();
    states.push(commitButton().disabled);
    expect(commitButton().disabled).toBe(!valid());
  }
  // The sequence itself: covered, short, covered, short, answered, unreadable.
  expect(states).toEqual([false, true, false, true, false, true]);
  expect(onCommit).not.toHaveBeenCalled();
});

test('a click that lands on a report the lines no longer match sends nothing', () => {
  let onScreen = true;
  const report = { dueCents: 1250, canSubmit: true, tenders: [{ method: 'cash', amountCents: 1250 }], live: () => onScreen };
  expect(tendersForDue(report, 1250)).toBe(report);
  onScreen = false;
  expect(tendersForDue(report, 1250)).toBeNull();
});
