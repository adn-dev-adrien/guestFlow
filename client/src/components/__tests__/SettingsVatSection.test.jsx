import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import SettingsVatSection from '../SettingsVatSection';

// specs/single-vat-rate.md — one stay VAT rate. The commission and cancellation-indemnity rates
// moved to Plan comptable (specs/settings-rationalization.md rule 14).

test('renders the stay VAT rate only', () => {
  render(<SettingsVatSection values={{ rate: 5.5 }} onChange={vi.fn()} />);
  expect(screen.getByLabelText(/^Taux de TVA \(%\)/i)).toHaveValue(5.5);
  expect(screen.queryByLabelText(/commissions/i)).toBeNull();
  expect(screen.queryByLabelText(/indemnités/i)).toBeNull();
});

test('falls back to 10 % before the settings load', () => {
  render(<SettingsVatSection values={{}} onChange={vi.fn()} />);
  expect(screen.getByLabelText(/^Taux de TVA \(%\)/i)).toHaveValue(10);
});

test('editing the rate fires onChange with key="rate"; a blank input sends an empty string', () => {
  const onChange = vi.fn();
  render(<SettingsVatSection values={{ rate: 10 }} onChange={onChange} />);
  const field = screen.getByLabelText(/^Taux de TVA \(%\)/i);
  fireEvent.change(field, { target: { value: '20' } });
  expect(onChange).toHaveBeenLastCalledWith('rate', 20);
  fireEvent.change(field, { target: { value: '' } });
  expect(onChange).toHaveBeenLastCalledWith('rate', '');
});

test('surfaces a server validation error under the field', () => {
  render(<SettingsVatSection values={{ rate: 10 }} errors={{ vatRate: 'Doit être un nombre entre 0 et 100.' }} onChange={vi.fn()} />);
  expect(screen.getByText('Doit être un nombre entre 0 et 100.')).toBeInTheDocument();
});
