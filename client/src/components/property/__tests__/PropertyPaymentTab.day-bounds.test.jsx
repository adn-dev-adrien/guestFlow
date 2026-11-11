// specs/settings-input-guards.md rules 9-14 — the four numbers of « Paiement & caution ».
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../../theme';
import PropertyPaymentTab from '../PropertyPaymentTab';
import { LIMITS } from './propertyLimitsFixtures';

function Harness({ initial, errors = {}, onUpdate }) {
  const [form, setForm] = useState({ depositEnabled: true, depositPercent: 30, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7, ...initial });
  const updateField = (field, value) => { onUpdate?.(field, value); setForm((f) => ({ ...f, [field]: value })); };
  return (
    <ThemeProvider theme={theme}>
      <PropertyPaymentTab form={form} errors={errors} updateField={updateField} onZeroFocus={vi.fn()} limits={LIMITS} />
    </ThemeProvider>
  );
}
const depositDays = () => screen.getByLabelText(/Acompte \(jours après réservation\)/);

test('rule 9: the acompte delay is read from the server limits — 45 is refused in red with its limit', () => {
  const onUpdate = vi.fn();
  render(<Harness onUpdate={onUpdate} />);
  fireEvent.focus(depositDays());
  fireEvent.change(depositDays(), { target: { value: '45' } });
  fireEvent.blur(depositDays());
  expect(onUpdate).toHaveBeenCalledWith('depositDueDays', 45);
  expect(depositDays()).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Entre 0 et 30 jours.')).toBeInTheDocument();
});

test('rule 10: solde and annulation accept up to 60 days, and the minus is stripped', () => {
  render(<Harness />);
  const solde = screen.getByLabelText(/jours avant l'arrivée/);
  fireEvent.focus(solde);
  fireEvent.change(solde, { target: { value: '-45' } });
  expect(solde).toHaveValue('45');
  fireEvent.blur(solde);
  expect(solde).toHaveAttribute('aria-invalid', 'false');
  const annulation = screen.getByLabelText(/Annulation \(jours après échéance du solde\)/);
  fireEvent.focus(annulation);
  fireEvent.change(annulation, { target: { value: '61' } });
  fireEvent.blur(annulation);
  expect(screen.getByText('Entre 0 et 60 jours.')).toBeInTheDocument();
});

test('rule 12: a message from the server lands under its own field', () => {
  render(<Harness errors={{ balanceDaysBefore: 'Entre 0 et 60 jours.' }} />);
  expect(screen.getByLabelText(/jours avant l'arrivée/)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Entre 0 et 60 jours.')).toBeInTheDocument();
});

test('rule 13: the acompte percent keeps its own message and decimal input', () => {
  const onUpdate = vi.fn();
  render(<Harness onUpdate={onUpdate} />);
  const pct = screen.getByLabelText(/% acompte/);
  fireEvent.focus(pct);
  fireEvent.change(pct, { target: { value: '12,5' } });
  fireEvent.blur(pct);
  expect(onUpdate).toHaveBeenCalledWith('depositPercent', 12.5);
  fireEvent.focus(pct);
  fireEvent.change(pct, { target: { value: '100' } });
  fireEvent.blur(pct);
  expect(screen.getByText(/^Entre 1 et 99 %\. Pour tout encaisser/)).toBeInTheDocument();
});

test('rule 14: the helper of an acompte delay reads « à régler à la réservation » for 0', () => {
  render(<Harness initial={{ depositDueDays: 0 }} />);
  expect(screen.getByText('0 : à régler à la réservation.')).toBeInTheDocument();
});
