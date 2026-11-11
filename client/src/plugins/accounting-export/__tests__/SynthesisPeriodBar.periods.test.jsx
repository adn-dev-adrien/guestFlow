// specs/accounting-synthesis.md §3 rules 22, 24 and 49 — the period bar offers what the server lists and sends only a
// period the server would accept: a custom window it would refuse is refused here, judged from the server's day.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import SynthesisPeriodBar from '../SynthesisPeriodBar';
import { synthesisPayload } from './synthesisFixtures';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = iso(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

function renderBar(onChange, data = synthesisPayload()) {
  return render(
    <ThemeProvider theme={theme}>
      <SynthesisPeriodBar window={data.window} options={{ ...data.periodOptions, fiscalYears: data.fiscalYears }} today={today} onChange={onChange} />
    </ThemeProvider>,
  );
}

test('rule 24 — the four kinds; month, quarter and exercise are sent as such', async () => {
  const onChange = vi.fn();
  renderBar(onChange);
  ['Mois', 'Trimestre', 'Exercice', 'Personnalisée'].forEach((name) => expect(screen.getByRole('button', { name })).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Mois' }));
  expect(onChange).toHaveBeenLastCalledWith({ period: 'month' });
  await userEvent.click(screen.getByRole('button', { name: 'Exercice' }));
  expect(onChange).toHaveBeenLastCalledWith({ period: 'fy' });
});

test('rule 22 — the quarters offered are the server\'s', async () => {
  const onChange = vi.fn();
  renderBar(onChange);
  await userEvent.click(screen.getByRole('combobox', { name: 'Trimestre' }));
  await userEvent.click(screen.getByRole('option', { name: 'T2 2099' }));
  expect(onChange).toHaveBeenLastCalledWith({ period: 'quarter', quarter: '2099-Q2' });
});

test('rule 24 — a custom window beyond the date window is refused with the server\'s message, nothing sent', async () => {
  const onChange = vi.fn();
  renderBar(onChange);
  await userEvent.click(screen.getByRole('button', { name: 'Personnalisée' }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(/.+/);
  fireEvent.change(screen.getByLabelText('Du'), { target: { value: daysAgo(30) } });
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: daysAgo(1) } });
  expect(onChange).toHaveBeenLastCalledWith({ period: 'custom', from: daysAgo(30), to: daysAgo(1) });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.change(screen.getByLabelText('Du'), { target: { value: daysAgo(800) } });
  expect(screen.getByRole('alert')).toHaveTextContent('Période trop longue : 750 jours au plus.');
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('rule 49 (V2-4) — with a period shown, pressing its kind again keeps it', async () => {
  const onChange = vi.fn();
  renderBar(onChange);
  await userEvent.click(screen.getByRole('button', { name: 'Trimestre' }));
  expect(onChange).not.toHaveBeenCalled();
});
