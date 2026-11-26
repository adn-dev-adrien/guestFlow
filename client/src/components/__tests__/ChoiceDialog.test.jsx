// specs/reservations/manual-price-on-placement-change.md §4.2, §6 — the generic « pick one of N » dialog: preselection, a disabled choice with
// its reason, confirm with the picked value, Escape and the cancel button both cancel (rule 14).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChoiceDialog from '../ChoiceDialog';

const CHOICES = [
  { value: 'keep', label: 'Garder', figure: '270,00 €', caption: 'Total 290,00 €' },
  { value: 'gap', label: 'Écart', figure: '-10,00 €', disabledReason: 'Écart supérieur au nouveau tarif' },
  { value: 'engine', label: 'Tarif', figure: '500,00 €' },
];

function renderDialog(props = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<ChoiceDialog open title="Choisir" intro={<p>Pourquoi</p>} choices={CHOICES} onConfirm={onConfirm} onCancel={onCancel}
    confirmLabel="Appliquer" cancelLabel="Annuler le changement" {...props} />);
  return { onConfirm, onCancel };
}

test('preselects the default value, or the first enabled choice when the default is disabled', () => {
  renderDialog({ defaultValue: 'engine' });
  expect(screen.getByRole('radio', { name: /Tarif/ })).toBeChecked();
});

test('a disabled default falls back to the first enabled choice; the disabled one shows its reason', () => {
  renderDialog({ defaultValue: 'gap' });
  expect(screen.getByRole('radio', { name: /Garder/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /Écart/ })).toBeDisabled();
  expect(screen.getByText('Écart supérieur au nouveau tarif')).toBeInTheDocument();
});

test('confirms the picked value', () => {
  const { onConfirm } = renderDialog({ defaultValue: 'keep' });
  fireEvent.click(screen.getByRole('radio', { name: /Tarif/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
  expect(onConfirm).toHaveBeenCalledWith('engine');
});

test('the cancel button and Escape both cancel', () => {
  const { onCancel, onConfirm } = renderDialog();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler le changement' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(2);
  expect(onConfirm).not.toHaveBeenCalled();
});
