// Review amendments: rule 50 — arrows from the typed number, never snap a refused value, live region, dash is not a minus.
import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';

import BoundedNumberField from '../BoundedNumberField';

// specs/settings-input-guards.md rules 1-7 — the shared contract of a bounded number field.

const DAYS = { min: 0, max: 30, integer: true, unit: 'jours' };
const RATE = { min: 0, max: 99.99, decimals: 2, unit: '%' };

function Harness({ initial = 7, limits = DAYS, onCommit, ...props }) {
  const [value, setValue] = useState(initial);
  return <BoundedNumberField label="Délai" limits={limits} value={value} onCommit={(v) => { onCommit?.(v); setValue(v); }} {...props} />;
}
const field = () => screen.getByRole('textbox');
const type = (text) => { act(() => field().focus()); fireEvent.change(field(), { target: { value: text } }); };

test('rule 1: a text input with a numeric keypad and the server unit, never a native number field', () => {
  render(<Harness />);
  expect(field()).toHaveAttribute('type', 'text');
  expect(field()).toHaveAttribute('inputmode', 'numeric');
  expect(screen.getByText('jours')).toBeInTheDocument();
  render(<Harness limits={RATE} initial={12.5} />);
  expect(screen.getAllByRole('textbox')[1]).toHaveAttribute('inputmode', 'decimal');
});

test('rule 2: a typed minus is removed and the helper says why for 2 s', () => {
  vi.useFakeTimers();
  render(<Harness />);
  type('-5');
  expect(field()).toHaveValue('5');
  expect(screen.getAllByText('Positif uniquement.').length).toBeGreaterThan(0);
  act(() => { vi.advanceTimersByTime(2100); });
  expect(screen.queryAllByText('Positif uniquement.')).toHaveLength(0);
  vi.useRealTimers();
});

test('rule 2: a pasted « -12,5 » loses its minus and keeps the rest as typed', () => {
  render(<Harness limits={RATE} />);
  type('-12,5');
  expect(field()).toHaveValue('12,5');
});

test('rule 2: the caret stays where it was', () => {
  render(<Harness initial={12} />);
  act(() => field().focus());
  fireEvent.change(field(), { target: { value: '1-2', selectionStart: 2, selectionEnd: 2 } });
  expect(field()).toHaveValue('12');
  expect(field().selectionStart).toBe(1);
});

test('rule 2: a field whose minimum is negative keeps its minus', () => {
  render(<Harness limits={{ min: -10, max: 10, integer: true }} initial={0} />);
  type('-5');
  expect(field()).toHaveValue('-5');
});

test('rule 3: nothing is committed per keystroke; blur and Enter commit', () => {
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  type('1');
  fireEvent.change(field(), { target: { value: '14' } });
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.blur(field());
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith(14);

  type('21');
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(onCommit).toHaveBeenLastCalledWith(21);
});

test('rule 4: a non-number restores the previous value and says « Nombre attendu. »', () => {
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  for (const bad of ['abc', '1,2,3', '—', '   ', '']) {
    type(bad);
    fireEvent.blur(field());
    expect(field()).toHaveValue('7');
    expect(screen.getAllByText('Nombre attendu.').length).toBeGreaterThan(0);
  }
  expect(onCommit).not.toHaveBeenCalled();
});

test('rule 4: Escape restores the last committed value', () => {
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  type('25');
  fireEvent.keyDown(field(), { key: 'Escape' });
  expect(field()).toHaveValue('7');
  fireEvent.blur(field());
  expect(onCommit).toHaveBeenCalledWith(7);
});

test('rule 4: a comma and a dot are both decimal separators', () => {
  const onCommit = vi.fn();
  render(<Harness limits={RATE} onCommit={onCommit} />);
  type('12,5');
  fireEvent.blur(field());
  expect(onCommit).toHaveBeenLastCalledWith(12.5);
  type('3.25');
  fireEvent.blur(field());
  expect(onCommit).toHaveBeenLastCalledWith(3.25);
});

test('rule 4: an optional field commits an empty value', () => {
  const onCommit = vi.fn();
  render(<Harness required={false} onCommit={onCommit} />);
  type('');
  fireEvent.blur(field());
  expect(onCommit).toHaveBeenCalledWith('');
});

test('rule 5: an out-of-range number is refused in red, committed as typed, never clamped', () => {
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  type('45');
  fireEvent.blur(field());
  expect(onCommit).toHaveBeenCalledWith(45);
  expect(field()).toHaveValue('45');
  expect(field()).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Entre 0 et 30 jours.')).toBeInTheDocument();
  type('12');
  fireEvent.blur(field());
  expect(field()).toHaveAttribute('aria-invalid', 'false');
  expect(screen.queryByText('Entre 0 et 30 jours.')).toBeNull();
});

test('rule 5: the server\'s custom message and the server error are shown as they are', () => {
  render(<Harness limits={{ ...DAYS, max: 365, message: 'Un nombre entier de jours (0 à 365).' }} initial={400} />);
  expect(screen.getByText('Un nombre entier de jours (0 à 365).')).toBeInTheDocument();
  render(<Harness error="Entre 0 et 60 jours." />);
  expect(screen.getByText('Entre 0 et 60 jours.')).toBeInTheDocument();
});

test('rule 6: a decimal in a whole-number field is refused', () => {
  render(<Harness />);
  type('2,5');
  fireEvent.blur(field());
  expect(field()).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Nombre entier de jours.')).toBeInTheDocument();
});

test('rule 7: ArrowUp / ArrowDown step by one and stop at the bounds', () => {
  const onCommit = vi.fn();
  render(<Harness initial={29} onCommit={onCommit} />);
  fireEvent.focus(field());
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  expect(onCommit).toHaveBeenLastCalledWith(30);
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(onCommit).toHaveBeenLastCalledWith(29);
});

test('rule 7: in decimal mode the arrows step by 0.01 and stop at 0', () => {
  const onCommit = vi.fn();
  render(<Harness limits={RATE} initial={0.01} onCommit={onCommit} />);
  fireEvent.focus(field());
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(onCommit).toHaveBeenLastCalledWith(0);
});

test('rule 7: focusing selects the content', () => {
  render(<Harness initial={7} />);
  const selected = vi.spyOn(field(), 'select');
  fireEvent.focus(field());
  expect(selected).toHaveBeenCalled();
});

test('rule 7: ArrowUp steps from the typed number, not from the last saved value', () => {
  const onCommit = vi.fn();
  render(<Harness initial={7} onCommit={onCommit} />);
  type('12');
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  expect(onCommit).toHaveBeenLastCalledWith(13);
  expect(field()).toHaveValue('13');
});

test('rule 7: from a non-number the arrows step from the committed value', () => {
  const onCommit = vi.fn();
  render(<Harness initial={7} onCommit={onCommit} />);
  type('abc');
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  expect(onCommit).toHaveBeenLastCalledWith(8);
});

test('rule 5, 7: a refused 45 is never snapped to 30 by the arrows — ArrowUp does nothing, ArrowDown moves one step', () => {
  const onCommit = vi.fn();
  render(<Harness initial={45} onCommit={onCommit} />);
  act(() => field().focus());
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  expect(onCommit).not.toHaveBeenCalled();
  expect(field()).toHaveValue('45');
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(onCommit).toHaveBeenLastCalledWith(44);
});

test('rule 4: a dash is not a minus — « — » is « Nombre attendu. », and the minus sign U+2212 is stripped', () => {
  render(<Harness />);
  type('—');
  expect(field()).toHaveValue('—');
  expect(screen.queryAllByText('Positif uniquement.')).toHaveLength(0);
  act(() => field().blur());
  expect(field()).toHaveValue('7');
  expect(screen.getAllByText('Nombre attendu.').length).toBeGreaterThan(0);
  type('\u22125');
  expect(field()).toHaveValue('5');
});

test('rule 5: more decimals than the field holds are refused, not rounded', () => {
  const onCommit = vi.fn();
  render(<Harness limits={RATE} onCommit={onCommit} />);
  type('12,345');
  fireEvent.blur(field());
  expect(onCommit).toHaveBeenLastCalledWith(12.345);
  expect(field()).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Au plus 2 décimales.')).toBeInTheDocument();
});

test('rule 2, 4: the short messages are announced through a polite live region', () => {
  render(<Harness />);
  const live = screen.getByRole('status');
  expect(live).toHaveAttribute('aria-live', 'polite');
  expect(live).toHaveTextContent('');
  type('-5');
  expect(live).toHaveTextContent('Positif uniquement.');
});
