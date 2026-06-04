import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import SettingsVatSection from '../SettingsVatSection';

// specs/accounting-platform-commission-and-no-deposit.md §3.7 rule 17b + §7.3.
// The Taux de TVA card now has TWO fields:
//   - "Taux de TVA (%)" → `values.rate` (default 10, applies to revenue 70xxx)
//   - "TVA déductible commissions (%)" → `values.rateCommission` (default 20, applies to
//     commission VAT 44566000 when a platform's Switch is ON)

test('renders both VAT fields with the provided values', () => {
  render(<SettingsVatSection values={{ rate: 10, rateCommission: 20 }} onChange={vi.fn()} />);
  expect(screen.getByLabelText(/^Taux de TVA \(%\)/i)).toHaveValue(10);
  expect(screen.getByLabelText(/TVA déductible commissions \(%\)/i)).toHaveValue(20);
});

test('falls back to default values when `values` is partial', () => {
  // Settings boot before the API responds — `values` may be missing one or both fields.
  render(<SettingsVatSection values={{}} onChange={vi.fn()} />);
  // Defaults: rate = 10 (existing), rateCommission = 20 (the new commission VAT default).
  expect(screen.getByLabelText(/^Taux de TVA \(%\)/i)).toHaveValue(10);
  expect(screen.getByLabelText(/TVA déductible commissions \(%\)/i)).toHaveValue(20);
});

test("editing the commission VAT field fires onChange with key='rateCommission'", () => {
  const onChange = vi.fn();
  render(<SettingsVatSection values={{ rate: 10, rateCommission: 20 }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText(/TVA déductible commissions \(%\)/i), { target: { value: '19.6' } });
  expect(onChange).toHaveBeenCalledWith('rateCommission', 19.6);
});

test("editing the revenue VAT field fires onChange with key='rate' (no regression)", () => {
  const onChange = vi.fn();
  render(<SettingsVatSection values={{ rate: 10, rateCommission: 20 }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText(/^Taux de TVA \(%\)/i), { target: { value: '5.5' } });
  expect(onChange).toHaveBeenCalledWith('rate', 5.5);
});

test('surfaces validation errors on the commission field via the errors prop', () => {
  // The settings controller returns errors keyed by column name (`vatRateCommission`).
  render(
    <SettingsVatSection
      values={{ rate: 10, rateCommission: 20 }}
      errors={{ vatRateCommission: 'Doit être un nombre entre 0 et 100.' }}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByText('Doit être un nombre entre 0 et 100.')).toBeInTheDocument();
});

test('blank input sends an empty string (not NaN) — defensive for cleared fields', () => {
  const onChange = vi.fn();
  render(<SettingsVatSection values={{ rate: 10, rateCommission: 20 }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText(/TVA déductible commissions \(%\)/i), { target: { value: '' } });
  expect(onChange).toHaveBeenCalledWith('rateCommission', '');
});
