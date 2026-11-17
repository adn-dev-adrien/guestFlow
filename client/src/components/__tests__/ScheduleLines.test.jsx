// specs/mollie-rolling-reserve-and-incoming-payments.md rule 18 — the dated tranches of a staged payment are drawn one
// line each (label, amount, state badge), the way an instalment plan draws its instalments. The component draws
// what it is given: no state, amount or date is computed here.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import ScheduleLines from '../ScheduleLines';

const LINES = [
  { key: 'balance#immediat', label: 'Versement immédiat', amount: '585,92 €', stateLabel: 'reçu le 13/11', tone: 'success', detail: <span>Qonto solio-6791</span> },
  { key: 'balance#retenue', label: 'Retenue Mollie 20 %', amount: '146,48 €', stateLabel: "retenue jusqu'au 11/02/2027", tone: 'neutral' },
];

test('rule 18: one line per tranche, in the given order, with label, amount and state', () => {
  render(<ScheduleLines lines={LINES} label="Versements du solde" />);
  const items = within(screen.getByRole('list', { name: 'Versements du solde' })).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(within(items[0]).getByText('Versement immédiat')).toBeInTheDocument();
  expect(within(items[0]).getByText('585,92 €')).toBeInTheDocument();
  expect(within(items[0]).getByText('reçu le 13/11')).toBeInTheDocument();
  expect(within(items[1]).getByText('Retenue Mollie 20 %')).toBeInTheDocument();
  expect(within(items[1]).getByText("retenue jusqu'au 11/02/2027")).toBeInTheDocument();
});

test('rule 18: the state colour is the badge tone, never the label', () => {
  render(<ScheduleLines lines={LINES} />);
  const received = screen.getByText('reçu le 13/11').closest('.MuiChip-root');
  const held = screen.getByText("retenue jusqu'au 11/02/2027").closest('.MuiChip-root');
  expect(getComputedStyle(received).backgroundColor).not.toBe(getComputedStyle(held).backgroundColor);
});

test('a line may carry a detail under it (a reference)', () => {
  render(<ScheduleLines lines={LINES} />);
  expect(screen.getByText('Qonto solio-6791')).toBeInTheDocument();
});

test('nothing is drawn for an empty list', () => {
  const { container } = render(<ScheduleLines lines={[]} />);
  expect(container).toBeEmptyDOMElement();
});
