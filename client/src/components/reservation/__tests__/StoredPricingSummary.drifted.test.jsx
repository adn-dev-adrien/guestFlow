// specs/reservation-payment-ledger.md rule 45 — the stored summary prints the stored figures and dates
// only; the live quote's lines never appear next to them.
import React from 'react';
import { render, screen } from '@testing-library/react';
import StoredPricingSummary from '../StoredPricingSummary';

const SUMMARY = {
  accommodation: 1857.52, optionsTotal: 97, resourcesTotal: 0, touristTaxTotal: 0, vatRate: 10,
  totalVatAmount: 177.68, totalNetPrice: 1776.84, totalStayPrice: 1954.52, finalPrice: 1954.52,
  depositAmount: 0, balanceAmount: 1933.52, complementAmount: 21, endOfStayComplementTotal: 0,
  depositDueDate: null, balanceDueDate: '2026-08-10',
  totalPlatformCommission: 388.52, platformNetReceivedAmount: 1545, sejourNetTotal: 1566,
};

test('rule 45 — stored figures and the stored due date, with the reason for the stored view', () => {
  render(<StoredPricingSummary summary={SUMMARY} form={{ cautionAmount: 500 }} propertyLabel="Gîte" isPlatform />);
  const card = screen.getByTestId('stored-pricing-summary');
  for (const figure of ['1 857,52 €', '1 776,84 €', '177,68 €', '1 954,52 €', '1 545,00 €', '1 566,00 €', '1 933,52 €']) {
    expect(card).toHaveTextContent(figure);
  }
  expect(card).toHaveTextContent('À payer avant : 10/08/2026');
  expect(card).toHaveTextContent('Montants enregistrés');
  expect(card).not.toHaveTextContent('2 004,92');
  expect(card).not.toHaveTextContent('03/09');
});
