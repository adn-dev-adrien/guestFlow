import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import FilterChip from '../FilterChip';

// specs/reconciliation-assisted-matching.md rule 11 — an active filter, one click (or Échap) to leave it.

test('shows the label and the count', () => {
  render(<FilterChip label="Écarts" count={9} onClear={vi.fn()} />);
  expect(screen.getByText('Écarts · 9')).toBeTruthy();
});

test('the close button leaves the filter', () => {
  const onClear = vi.fn();
  render(<FilterChip label="Écarts" onClear={onClear} />);
  expect(screen.getByText('Écarts')).toBeTruthy();
  fireEvent.click(screen.getByTestId('CancelIcon'));
  expect(onClear).toHaveBeenCalledTimes(1);
});

test('Échap leaves the filter, and stops listening once unmounted', () => {
  const onClear = vi.fn();
  const { unmount } = render(<FilterChip label="Écarts" onClear={onClear} />);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClear).toHaveBeenCalledTimes(1);
  unmount();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClear).toHaveBeenCalledTimes(1);
});

test('Échap in a field or with a dialog open does not leave the filter; the name keeps the count', () => {
  const onClear = vi.fn();
  render(<><FilterChip label="Écarts" count={9} onClear={onClear} /><input aria-label="champ" /></>);
  expect(screen.getByLabelText('Filtre actif : Écarts · 9')).toBeTruthy();
  fireEvent.keyDown(screen.getByLabelText('champ'), { key: 'Escape' });
  expect(onClear).not.toHaveBeenCalled();
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.appendChild(dialog);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onClear).not.toHaveBeenCalled();
  dialog.remove();
});
