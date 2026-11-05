// specs/finance-data-checks.md §3 rules 15, 16 and 17 — the Suivi financier's « À vérifier »: what it asks, where its
// items lead, and a refusal kept inside the card.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import { PAYLOAD, EMPTY_PAYLOAD } from './dataChecksFixtures';

vi.mock('../../api', () => ({ __esModule: true, default: { getFinanceDataChecks: vi.fn() } }));

import api from '../../api';
import FinanceDataChecksCard from '../FinanceDataChecksCard';

const FROM = '/finance?exercice=2026&logement=3';
const ui = (props) => (
  <ThemeProvider theme={theme}>
    <MemoryRouter initialEntries={[FROM]}><FinanceDataChecksCard fiscalYear={2026} propertyId="3" refreshKey={0} {...props} /></MemoryRouter>
  </ThemeProvider>
);
const open = (label) => fireEvent.click(screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded') && b.textContent.includes(label)));

beforeEach(() => { api.getFinanceDataChecks.mockReset(); });

test('rule 16: asks the page’s exercise and logement; a stay opens its fiche with the way back, a month the tax page on it', async () => {
  api.getFinanceDataChecks.mockResolvedValue(PAYLOAD);
  render(ui());
  await screen.findByText('Exercice 2026');
  expect(api.getFinanceDataChecks).toHaveBeenCalledWith({ fiscalYear: 2026, propertyId: '3' });
  open('Séjours terminés sans taxe');
  expect(screen.getByRole('link', { name: /202609011/ })).toHaveAttribute('href', `/reservations/412?from=${encodeURIComponent(FROM)}`);
  open('Mois passés');
  expect(screen.getByRole('link', { name: /Septembre 2026/ })).toHaveAttribute('href', `/finance/tourist-tax?month=2026-09&from=${encodeURIComponent(FROM)}`);
});

test('rule 15: nothing to check reads one line', async () => {
  api.getFinanceDataChecks.mockResolvedValue(EMPTY_PAYLOAD);
  render(ui());
  expect(await screen.findByText('Rien à vérifier sur l’exercice.')).toBeInTheDocument();
});

test('rule 17: a refusal stays in the card with its reason and a retry that reads again', async () => {
  api.getFinanceDataChecks.mockRejectedValueOnce({ error: 'Logement inconnu.' }).mockResolvedValue(PAYLOAD);
  render(ui());
  expect(await screen.findByText('Logement inconnu.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'À vérifier' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Exercice 2026')).toBeInTheDocument();
  expect(api.getFinanceDataChecks).toHaveBeenCalledTimes(2);
});

test('rule 17: a network failure without a reason gets the card’s own sentence', async () => {
  api.getFinanceDataChecks.mockRejectedValue(new Error('x'));
  render(ui());
  expect(await screen.findByText('Impossible de charger les contrôles.')).toBeInTheDocument();
});

test('rule 16: an answer for a logement left behind never lands on the new one', async () => {
  let late;
  api.getFinanceDataChecks
    .mockImplementationOnce(() => new Promise((resolve) => { late = resolve; }))
    .mockResolvedValueOnce(EMPTY_PAYLOAD);
  const view = render(ui());
  view.rerender(ui({ propertyId: '4' }));
  expect(await screen.findByText('Rien à vérifier sur l’exercice.')).toBeInTheDocument();
  late(PAYLOAD);
  await waitFor(() => expect(api.getFinanceDataChecks).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Rien à vérifier sur l’exercice.')).toBeInTheDocument();
  expect(screen.queryByText(/Séjours terminés sans taxe/)).not.toBeInTheDocument();
});

test('rule 16: the page’s refresh reads the checks again', async () => {
  api.getFinanceDataChecks.mockResolvedValue(PAYLOAD);
  const view = render(ui());
  await screen.findByText('Exercice 2026');
  view.rerender(ui({ refreshKey: 1 }));
  await waitFor(() => expect(api.getFinanceDataChecks).toHaveBeenCalledTimes(2));
});
