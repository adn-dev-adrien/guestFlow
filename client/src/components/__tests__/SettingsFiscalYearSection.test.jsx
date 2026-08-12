import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import SettingsFiscalYearSection from '../SettingsFiscalYearSection';

// specs/fiscal-year-and-nights-sold.md §3.1 + §6.1 — one Select (« Mois de clôture ») plus a hint
// spelling out the resulting exercise. The hint is a presentational echo of the picked month; the
// exercise itself is computed server-side.

test('renders the closing month with the exercise bounds spelled out', () => {
  render(<SettingsFiscalYearSection values={{ fiscalYearEndMonth: 9 }} onChange={vi.fn()} />);
  expect(screen.getByRole('combobox', { name: /Mois de clôture/i })).toHaveTextContent('Septembre');
  expect(screen.getByText("L'exercice ira du 1er octobre au 30 septembre.")).toBeInTheDocument();
});

test('December reads as the calendar year rather than « du 1er janvier au 31 décembre » guesswork', () => {
  render(<SettingsFiscalYearSection values={{ fiscalYearEndMonth: 12 }} onChange={vi.fn()} />);
  expect(screen.getByText("L'exercice suit l'année civile : du 1er janvier au 31 décembre.")).toBeInTheDocument();
});

test('February closing announces 29 — the last day is computed, never hard-coded to 28', () => {
  render(<SettingsFiscalYearSection values={{ fiscalYearEndMonth: 2 }} onChange={vi.fn()} />);
  expect(screen.getByText("L'exercice ira du 1er mars au 29 février.")).toBeInTheDocument();
});

test('defaults to December when `values` is empty (settings still loading)', () => {
  render(<SettingsFiscalYearSection values={{}} onChange={vi.fn()} />);
  expect(screen.getByRole('combobox', { name: /Mois de clôture/i })).toHaveTextContent('Décembre');
});

test("picking a month fires onChange with key='fiscalYearEndMonth' and a NUMBER", async () => {
  const onChange = vi.fn();
  render(<SettingsFiscalYearSection values={{ fiscalYearEndMonth: 12 }} onChange={onChange} />);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Mois de clôture/i }));
  fireEvent.click(await screen.findByRole('option', { name: 'Septembre' }));
  expect(onChange).toHaveBeenCalledWith('fiscalYearEndMonth', 9);
});

test('surfaces a server validation error via the errors prop', () => {
  // The settings controller keys its errors by column name.
  render(
    <SettingsFiscalYearSection
      values={{ fiscalYearEndMonth: 9 }}
      errors={{ fiscalYearEndMonth: 'Doit être un mois entre 1 (janvier) et 12 (décembre).' }}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByText('Doit être un mois entre 1 (janvier) et 12 (décembre).')).toBeInTheDocument();
});
