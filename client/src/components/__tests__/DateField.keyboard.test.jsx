// specs/datepicker-close-on-select.md — reading of 2026-11-02 (audit R19-L1): a change typed on the keyboard
// keeps the focus (the year 2028 typed digit by digit used to end as 0002); a pick in the native calendar
// still blurs the field so the calendar closes. While typing, the min / max bounds stay those of the first key
// press until the blur: Chromium drops a half-typed date when a bound moves.
import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';
import DateField from '../DateField';

const setup = (props = {}) => {
  const onChange = vi.fn();
  render(<DateField label="Date" value="" onChange={onChange} {...props} />);
  const input = screen.getByLabelText('Date');
  return { input, onChange, blur: vi.spyOn(input, 'blur') };
};

describe('DateField — keyboard entry', () => {
  afterEach(() => { vi.useRealTimers(); });

  test('a change right after a key press keeps the focus and still reaches the caller', () => {
    const { input, onChange, blur } = setup();
    input.focus();
    fireEvent.keyDown(input, { key: '2' });
    fireEvent.change(input, { target: { value: '2028-01-15' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(blur).not.toHaveBeenCalled();
  });

  test('every digit of a typed year keeps the focus', () => {
    const { input, blur } = setup();
    ['2', '0', '2', '8'].forEach((key, i) => {
      fireEvent.keyDown(input, { key });
      fireEvent.change(input, { target: { value: `000${i + 1}-01-15` } });
    });
    expect(blur).not.toHaveBeenCalled();
  });

  test('clearing the field with Backspace keeps the focus', () => {
    const { input, blur } = setup({ value: '2028-01-15' });
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.change(input, { target: { value: '' } });
    expect(blur).not.toHaveBeenCalled();
  });

  test('a pointer press after typing makes the next change a calendar pick: it blurs', () => {
    const { input, blur } = setup();
    fireEvent.keyDown(input, { key: '2' });
    fireEvent.change(input, { target: { value: '2028-01-15' } });
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: '2028-01-20' } });
    expect(blur).toHaveBeenCalledTimes(1);
  });

  test('a change long after the last key press is a calendar pick: it blurs', () => {
    vi.useFakeTimers();
    const { input, blur } = setup();
    fireEvent.keyDown(input, { key: ' ' });
    vi.advanceTimersByTime(2000);
    fireEvent.change(input, { target: { value: '2028-01-20' } });
    expect(blur).toHaveBeenCalledTimes(1);
  });

  test('the caller keeps its own key and pointer handlers', () => {
    const onKeyDown = vi.fn();
    const onPointerDown = vi.fn();
    const { input } = setup({ onKeyDown, onPointerDown });
    fireEvent.keyDown(input, { key: '2' });
    fireEvent.pointerDown(input);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });

  test('a bound moved by the typed value waits for the blur', () => {
    const before = dayjs().format('YYYY-MM-DD');
    const after = dayjs().add(3, 'day').format('YYYY-MM-DD');
    const field = (min) => <DateField label="Date" value="" onChange={() => {}} slotProps={{ htmlInput: { min } }} />;
    const { rerender } = render(field(before));
    const input = screen.getByLabelText('Date');
    fireEvent.keyDown(input, { key: '2' });
    rerender(field(after));
    expect(input).toHaveAttribute('min', before);
    fireEvent.blur(input);
    expect(input).toHaveAttribute('min', after);
  });

  test('without typing, a moved bound applies at once and the caller keeps its onBlur', () => {
    const onBlur = vi.fn();
    const before = dayjs().format('YYYY-MM-DD');
    const after = dayjs().add(3, 'day').format('YYYY-MM-DD');
    const field = (max) => <DateField label="Date" value="" onBlur={onBlur} slotProps={{ htmlInput: { max } }} />;
    const { rerender } = render(field(before));
    const input = screen.getByLabelText('Date');
    rerender(field(after));
    expect(input).toHaveAttribute('max', after);
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
