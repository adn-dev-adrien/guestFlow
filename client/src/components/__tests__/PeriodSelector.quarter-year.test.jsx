/**
 * PeriodSelector — specs/tourist-tax-report-v2.md §3 rule 18: optional quarter and year kinds, chosen and ordered by
 * `kinds`, their options from the server; without `kinds` the exercise selector is unchanged.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import PeriodSelector from '../PeriodSelector';

const KINDS = ['month', 'quarter', 'year', 'custom'];
const LABELS = { month: 'Mois', quarter: 'Trimestre', year: 'Année', custom: 'Personnalisée' };
const MONTHS = [{ month: '2026-06', label: 'juin 2026' }];
const QUARTERS = [{ value: '2026-Q3', label: 'T3 2026 (juil.–sept.)' }, { value: '2026-Q2', label: 'T2 2026 (avr.–juin)' }];
const YEARS = [{ value: '2026', label: '2026' }, { value: '2025', label: '2025' }];
const renderSelector = (props) => render(
  <PeriodSelector kinds={KINDS} labels={LABELS} months={MONTHS} quarters={QUARTERS} years={YEARS} month="2026-06" {...props} />,
);

test('rule 18: the segments follow `kinds`, in order', () => {
  renderSelector({ kind: 'month', onChange: vi.fn() });
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Mois', 'Trimestre', 'Année', 'Personnalisée']);
});

test('rule 18: switching to a quarter or a year hands the first option, or the one already chosen', () => {
  const onChange = vi.fn();
  const { rerender } = renderSelector({ kind: 'month', onChange });
  fireEvent.click(screen.getByRole('button', { name: 'Trimestre' }));
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'quarter', quarter: '2026-Q3' });
  fireEvent.click(screen.getByRole('button', { name: 'Année' }));
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'year', year: '2026' });
  rerender(<PeriodSelector kinds={KINDS} labels={LABELS} months={MONTHS} quarters={QUARTERS} years={YEARS} kind="month" quarter="2026-Q2" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Trimestre' }));
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'quarter', quarter: '2026-Q2' });
});

test('rule 18: the quarter and year selects offer the server options', async () => {
  const onChange = vi.fn();
  const { rerender } = renderSelector({ kind: 'quarter', quarter: '2026-Q3', onChange });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Trimestre' }));
  fireEvent.click(await screen.findByRole('option', { name: 'T2 2026 (avr.–juin)' }));
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'quarter', quarter: '2026-Q2' });
  rerender(<PeriodSelector kinds={KINDS} labels={LABELS} months={MONTHS} quarters={QUARTERS} years={YEARS} kind="year" year="2026" onChange={onChange} />);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Année' }));
  fireEvent.click(await screen.findByRole('option', { name: '2025' }));
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'year', year: '2025' });
});

test('rule 18: without `kinds`, the exercise selector keeps its three segments', () => {
  render(<PeriodSelector kind="fy" month="2026-06" months={MONTHS} onChange={vi.fn()} />);
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Exercice', 'Mois', 'Personnalisée']);
});
