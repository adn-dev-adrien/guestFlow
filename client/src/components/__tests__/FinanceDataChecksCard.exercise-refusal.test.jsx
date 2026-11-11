// D-HC16: specs/finance-data-checks.md §3 rule 23 — a refused exercise is shown in the panel with a way to the current
// one; any other refusal keeps « Réessayer ».
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import { PAYLOAD } from './dataChecksFixtures';

vi.mock('../../api', () => ({ __esModule: true, default: { getFinanceDataChecks: vi.fn() } }));

import api from '../../api';
import FinanceDataChecksCard from '../FinanceDataChecksCard';

const ui = (props = {}) => (
  <ThemeProvider theme={theme}>
    <MemoryRouter initialEntries={['/finance']}><FinanceDataChecksCard fiscalYear={2031} propertyId="" refreshKey={0} {...props} /></MemoryRouter>
  </ThemeProvider>
);
const refusal = (error, code) => Object.assign(new Error(error), { error, status: 400, ...(code ? { code } : {}) });

beforeEach(() => { api.getFinanceDataChecks.mockReset(); });

test('rule 23: « Exercice inconnu. » offers the current exercise, read without fiscalYear', async () => {
  api.getFinanceDataChecks
    .mockRejectedValueOnce(refusal('Exercice inconnu.', 'UNKNOWN_EXERCISE'))
    .mockResolvedValue(PAYLOAD);
  render(ui());
  expect(await screen.findByText('Exercice inconnu.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'À vérifier' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Exercice en cours' }));
  expect(await screen.findByText('Exercice 2026')).toBeInTheDocument();
  expect(api.getFinanceDataChecks).toHaveBeenLastCalledWith({ fiscalYear: undefined, propertyId: '' });
});

test('rule 23: the page choosing another exercise asks for it again', async () => {
  api.getFinanceDataChecks
    .mockRejectedValueOnce(refusal('Exercice inconnu.', 'UNKNOWN_EXERCISE'))
    .mockResolvedValue(PAYLOAD);
  const view = render(ui());
  fireEvent.click(await screen.findByRole('button', { name: 'Exercice en cours' }));
  await screen.findByText('Exercice 2026');
  view.rerender(ui({ fiscalYear: 2025 }));
  await waitFor(() => expect(api.getFinanceDataChecks).toHaveBeenLastCalledWith({ fiscalYear: 2025, propertyId: '' }));
});

test('rule 23: another refusal keeps « Réessayer » with the same exercise', async () => {
  api.getFinanceDataChecks
    .mockRejectedValueOnce(refusal('Logement inconnu.'))
    .mockResolvedValue(PAYLOAD);
  render(ui());
  expect(await screen.findByText('Logement inconnu.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Exercice en cours' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await screen.findByText('Exercice 2026');
  expect(api.getFinanceDataChecks).toHaveBeenLastCalledWith({ fiscalYear: 2031, propertyId: '' });
});
