// Review amendments: rule 50 — « Saison » starts with both dates empty.
// specs/settings-input-guards.md rules 22-27 — the pool: off, all year, or a season.
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../../theme';
import PropertyStayTab from '../PropertyStayTab';

function Harness({ initial, errors = {}, onUpdate }) {
  const [form, setForm] = useState({ hasWifi: true, poolSeasonMode: 'none', poolSeasonStart: '', poolSeasonEnd: '', ...initial });
  const updateField = (field, value) => { onUpdate?.(field, value); setForm((f) => ({ ...f, [field]: value })); };
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <PropertyStayTab form={form} errors={errors} updateField={updateField} onZeroFocus={vi.fn()} timedOptions={{ early: null, late: null }} timeOptions={[]} />
      </ThemeProvider>
    </MemoryRouter>
  );
}

test('rule 22: pool off shows the switch alone', () => {
  render(<Harness />);
  expect(screen.getByLabelText('Piscine')).not.toBeChecked();
  expect(screen.queryByRole('button', { name: 'Saison' })).toBeNull();
  expect(screen.queryByText('Ouverte du')).toBeNull();
});

test('rule 22, 27: switching the pool on defaults to « Toute l\'année » and sends the mode', () => {
  const onUpdate = vi.fn();
  render(<Harness onUpdate={onUpdate} />);
  fireEvent.click(screen.getByLabelText('Piscine'));
  expect(onUpdate).toHaveBeenCalledWith('poolSeasonMode', 'allYear');
  expect(screen.getByRole('button', { name: "Toute l'année" })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText('Ouverte du')).toBeNull();
});

test('rule 22: « Saison » reveals the two dates, empty — never prefilled with the all-year bounds', () => {
  const onUpdate = vi.fn();
  render(<Harness initial={{ poolSeasonMode: 'allYear', poolSeasonStart: '01-01', poolSeasonEnd: '12-31' }} onUpdate={onUpdate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Saison' }));
  expect(onUpdate).toHaveBeenCalledWith('poolSeasonMode', 'season');
  expect(onUpdate).toHaveBeenCalledWith('poolSeasonStart', '');
  expect(onUpdate).toHaveBeenCalledWith('poolSeasonEnd', '');
  expect(screen.getByText('Ouverte du')).toBeInTheDocument();
  expect(screen.getByText('Au')).toBeInTheDocument();
});

test('rule 23, 27: a stored all-year pool reads « Toute l\'année » after a reload', () => {
  render(<Harness initial={{ poolSeasonMode: 'allYear', poolSeasonStart: '01-01', poolSeasonEnd: '12-31' }} />);
  expect(screen.getByLabelText('Piscine')).toBeChecked();
  expect(screen.getByRole('button', { name: "Toute l'année" })).toHaveAttribute('aria-pressed', 'true');
});

test('rule 25: the server\'s refusal of a closing before the opening shows under the dates', () => {
  render(<Harness initial={{ poolSeasonMode: 'season', poolSeasonStart: '10-01', poolSeasonEnd: '05-31' }} errors={{ poolSeasonEnd: "La fermeture suit l'ouverture." }} />);
  expect(screen.getByText("La fermeture suit l'ouverture.")).toBeInTheDocument();
});

test('rule 22: switching the pool off sends « none »', () => {
  const onUpdate = vi.fn();
  render(<Harness initial={{ poolSeasonMode: 'season', poolSeasonStart: '06-15', poolSeasonEnd: '08-31' }} onUpdate={onUpdate} />);
  fireEvent.click(screen.getByLabelText('Piscine'));
  expect(onUpdate).toHaveBeenCalledWith('poolSeasonMode', 'none');
});

test('rule 22: choosing « Toute l\'année » hides the dates entirely', () => {
  render(<Harness initial={{ poolSeasonMode: 'season', poolSeasonStart: '06-15', poolSeasonEnd: '08-31' }} />);
  expect(screen.getByText('Ouverte du')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: "Toute l'année" }));
  expect(screen.queryByText('Ouverte du')).toBeNull();
  expect(screen.queryByText('Au')).toBeNull();
});

test('rule 26: a « Saison » left empty is refused by the server under both dates', () => {
  render(<Harness initial={{ poolSeasonMode: 'season' }} errors={{ poolSeasonStart: 'Les deux dates.', poolSeasonEnd: 'Les deux dates.' }} />);
  expect(screen.getAllByText('Les deux dates.')).toHaveLength(2);
});
