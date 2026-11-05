// specs/force-item-to-complement.md rule 20, reading of 2026-11-05 — the « + compl. » chip of the tourist tax does not
// go round the greyed switch: while the server's reason holds, it reads and does not toggle.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import PricingSummary from '../PricingSummary';

const FORM = {
  startDate: '2099-08-03', endDate: '2099-08-05', finalPrice: 300, customPrice: '', platform: 'direct',
  touristTaxTotal: 4.8, depositAmount: 0, balanceAmount: 304.8, cautionAmount: 0, depositPaid: 0, balancePaid: 1, depositDisabled: true,
};
const QUOTE = {
  touristTaxTotal: 4.8, touristTaxOriginalTotal: 4.8, touristTaxInComplement: false, finalPrice: 300, totalStayPrice: 304.8,
  nights: 2, optionLines: [], resourceLines: [],
};
const open = (locked) => {
  const onToggleTouristTaxInComplement = vi.fn();
  render(<PricingSummary form={FORM} quote={QUOTE} onToggleTouristTaxInComplement={onToggleTouristTaxInComplement} touristTaxInComplementLocked={locked} />);
  return onToggleTouristTaxInComplement;
};

test('locked: the chip does nothing', async () => {
  const toggle = open(true);
  await userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByText('+ compl.'));
  expect(toggle).not.toHaveBeenCalled();
});

test('free: the chip routes the tax', async () => {
  const toggle = open(false);
  await userEvent.setup().click(screen.getByText('+ compl.'));
  expect(toggle).toHaveBeenCalledWith(true);
});
