/**
 * TenderLines — `shortfallKinds` (specs/outside-booking-sas.md rule 17, C38): the outside visit offers only « Reste à percevoir », « Geste commercial » being an offered line
 * there. Default: both choices, as everywhere else.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import TenderLines from '../TenderLines';

const typeFirst = (value) => fireEvent.change(document.querySelector('[data-tender-amount="0"]'), { target: { value } });

test('by default a shortfall offers both choices', () => {
  render(<TenderLines dueCents={5000} single onChange={() => {}} />);
  typeFirst('20');
  expect(document.querySelector('[data-shortfall="due"]')).not.toBeNull();
  expect(document.querySelector('[data-shortfall="waived"]')).not.toBeNull();
});

test('with shortfallKinds=[\'due\'] only « Reste à percevoir » is offered, and choosing it lets the payment through', () => {
  const onChange = vi.fn();
  render(<TenderLines dueCents={5000} single shortfallKinds={['due']} onChange={onChange} />);
  typeFirst('20');
  expect(document.querySelector('[data-shortfall="waived"]')).toBeNull();
  expect(screen.queryByText(/Geste commercial/)).toBeNull();
  expect(onChange.mock.calls.at(-1)[0].canSubmit).toBe(false);
  fireEvent.click(document.querySelector('[data-shortfall="due"]'));
  const last = onChange.mock.calls.at(-1)[0];
  expect(last.canSubmit).toBe(true);
  expect(last.shortfall).toEqual({ kind: 'due' });
  expect(last.tenders[0].amountCents).toBe(2000);
});
