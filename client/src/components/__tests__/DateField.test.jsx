import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DateField from '../DateField';

describe('DateField', () => {
  test('renders a native date input and forwards the change to the caller', () => {
    const onChange = vi.fn();
    render(<DateField label="Date" value="" onChange={onChange} />);
    const input = screen.getByLabelText('Date');
    expect(input).toHaveAttribute('type', 'date');
    fireEvent.change(input, { target: { value: '2026-06-20' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('blurs the field on selection so the native calendar closes', () => {
    render(<DateField label="Date" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Date');
    const blurSpy = vi.spyOn(input, 'blur');
    fireEvent.change(input, { target: { value: '2026-06-20' } });
    expect(blurSpy).toHaveBeenCalledTimes(1);
  });

  test('works without an onChange prop (no crash, still blurs)', () => {
    render(<DateField label="Date" value="" />);
    const input = screen.getByLabelText('Date');
    const blurSpy = vi.spyOn(input, 'blur');
    expect(() => fireEvent.change(input, { target: { value: '2026-06-20' } })).not.toThrow();
    expect(blurSpy).toHaveBeenCalledTimes(1);
  });
});
