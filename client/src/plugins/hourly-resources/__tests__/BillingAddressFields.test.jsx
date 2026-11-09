// specs/resource-booking-pricing-and-invoicing.md rules 25-27 — the optional billing address: digits-only postcode, the city
// picked from the communes, filled when only one matches.
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import BillingAddressFields from '../BillingAddressFields';
import usePostalCodeCities from '../../../hooks/usePostalCodeCities';

vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: vi.fn(() => []) }));

function Harness({ initial = { street: '', postcode: '', city: '' }, required = false }) {
  const [value, setValue] = useState(initial);
  return <><BillingAddressFields value={value} onChange={setValue} required={required} /><output data-testid="v">{JSON.stringify(value)}</output></>;
}
const value = () => JSON.parse(screen.getByTestId('v').textContent);

test('rule 26 — the postcode keeps digits only, 5 at most', () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Code postal'), { target: { value: '07a2 00 9' } });
  expect(value().postcode).toBe('07200');
});

test('rule 27 — a single commune for a full postcode fills the city', () => {
  usePostalCodeCities.mockReturnValue(['Le Cheylard']);
  render(<Harness initial={{ street: '', postcode: '07160', city: '' }} />);
  expect(value().city).toBe('Le Cheylard');
});

test('rule 25 — optional by default; Qonto\'s demand is said in red', () => {
  usePostalCodeCities.mockReturnValue([]);
  const { rerender } = render(<Harness />);
  expect(screen.getByText('Adresse de facturation · facultative')).toBeInTheDocument();
  rerender(<Harness required />);
  expect(screen.getByText("Qonto demande l'adresse de facturation pour émettre la facture.")).toBeInTheDocument();
});
