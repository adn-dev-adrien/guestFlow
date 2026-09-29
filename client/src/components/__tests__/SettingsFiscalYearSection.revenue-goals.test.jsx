/**
 * SettingsFiscalYearSection — the annual revenue goal fields.
 * specs/finance-dashboard-redesign.md rules 26-29: one field for the current exercise and one for the
 * next, labelled by the server; an invalid amount shows its message and blocks Enregistrer.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import SettingsFiscalYearSection, { hasInvalidRevenueGoal } from '../SettingsFiscalYearSection';

const CONTEXT = { current: { key: 2026, label: '2026', revenue: 61453 }, next: { key: 2027, label: '2027' } };

test('rule 26 — two fields named after the current and the next exercise', () => {
  render(<SettingsFiscalYearSection values={{ fiscalYearEndMonth: 12, revenueGoals: { 2026: 85000 } }} onChange={vi.fn()} goalContext={CONTEXT} />);
  expect(screen.getByLabelText('Exercice 2026 (en cours)').value.replace(/\s/g, ' ')).toBe('85 000');
  expect(screen.getByLabelText('Exercice 2027')).toHaveValue('');
});

test('rule 28 — the current exercise shows today\'s revenue against the goal', () => {
  render(<SettingsFiscalYearSection values={{ revenueGoals: { 2026: 85000 } }} onChange={vi.fn()} goalContext={CONTEXT} />);
  expect(screen.getByText(/Aujourd'hui : 61\s453 €, soit 72 % de l'objectif\./)).toBeInTheDocument();
});

test('rule 27 — typing a goal sends the whole goals object with the typed text', () => {
  const onChange = vi.fn();
  render(<SettingsFiscalYearSection values={{ revenueGoals: { 2026: 85000 } }} onChange={onChange} goalContext={CONTEXT} />);
  fireEvent.change(screen.getByLabelText('Exercice 2027'), { target: { value: '90 000' } });
  expect(onChange).toHaveBeenCalledWith('revenueGoals', { 2026: 85000, 2027: '90 000' });
});

test('rule 27 — an invalid amount shows its message and blocks the save', () => {
  render(<SettingsFiscalYearSection values={{ revenueGoals: { 2026: '-5' } }} onChange={vi.fn()} goalContext={CONTEXT} />);
  expect(screen.getByText("L'objectif doit être supérieur à 0 €. Laissez vide pour ne pas en fixer.")).toBeInTheDocument();
  expect(hasInvalidRevenueGoal({ 2026: '-5' })).toBe(true);
  expect(hasInvalidRevenueGoal({ 2026: 'abc' })).toBe(true);
  expect(hasInvalidRevenueGoal({ 2026: '85 000,50', 2027: '' })).toBe(false);
});

test('rule 27 — a server refusal is shown under its own field', () => {
  render(<SettingsFiscalYearSection values={{ revenueGoals: { 2027: '99' } }} errors={{ 'revenueGoals.2027': 'Exercice inconnu.' }} onChange={vi.fn()} goalContext={CONTEXT} />);
  expect(screen.getByText('Exercice inconnu.')).toBeInTheDocument();
});

test('no goal fields until the server has named the exercises', () => {
  render(<SettingsFiscalYearSection values={{}} onChange={vi.fn()} />);
  expect(screen.queryByText("Objectif de chiffre d'affaires")).not.toBeInTheDocument();
});
