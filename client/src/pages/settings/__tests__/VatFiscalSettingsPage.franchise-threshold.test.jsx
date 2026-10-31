// server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
/**
 * VatFiscalSettingsPage — the franchise threshold in the page's draft (specs/vat-optional-mode.md rules
 * 35, 36): an invalid amount blocks Save; a field that is not on screen blocks nothing and sends nothing
 * (typed amount, then another mention); Cancel gives the stored amount back.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getSettings: vi.fn(), updateSettings: vi.fn(), getVatRegime: vi.fn(), getFinanceGoalContext: vi.fn() },
}));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast, useAppDialogs: () => ({ confirm: vi.fn().mockResolvedValue(true), alert: vi.fn().mockResolvedValue() }) };
});
vi.mock('../../../plugins/sdk/Slot', () => ({ __esModule: true, default: () => null }));

import api from '../../../api';
import VatFiscalSettingsPage from '../VatFiscalSettingsPage';

const MENTIONS = [
  { key: 'art_293_b', label: 'TVA non applicable, art. 293 B du CGI', short: 'Franchise en base — art. 293 B' },
  { key: 'art_261_d_4', label: 'Exonération de TVA, art. 261 D 4° du CGI', short: 'Location meublée exonérée — art. 261 D 4°' },
];
const PERIOD = { id: 2, regime: 'not_subject', rate: 0, legalMention: 'art_293_b', label: 'Depuis le 01/01/2026', reservations: 0, deletable: false };
const settings = (threshold) => ({
  vat: { regime: 'not_subject', rate: 0, legalMention: 'art_293_b', franchise: { applies: true, threshold, setAt: threshold == null ? null : '2026-03-12' } },
  accounting: { fiscalYearEndMonth: 12, revenueGoals: {} },
  updatedAtLabel: 'aujourd’hui',
});

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getVatRegime.mockResolvedValue({ inForce: PERIOD, latest: PERIOD, periods: [PERIOD], mentions: MENTIONS });
  api.getFinanceGoalContext.mockResolvedValue(null);
  api.getSettings.mockResolvedValue(settings(30000));
});

const renderPage = () => render(<MemoryRouter><VatFiscalSettingsPage /></MemoryRouter>);
const save = () => screen.getByRole('button', { name: /Enregistrer|Champs en rouge/ });
const field = () => screen.getByLabelText('Seuil de franchise (€)');
const pickMention = async (name) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Mention légale' }));
  fireEvent.click(await screen.findByRole('option', { name }));
};

test('an invalid amount blocks Save; emptying it clears the block', async () => {
  renderPage();
  await screen.findByLabelText('Seuil de franchise (€)');
  fireEvent.change(field(), { target: { value: '12,345' } });
  expect(save()).toBeDisabled();
  fireEvent.change(field(), { target: { value: '' } });
  await waitFor(() => expect(save()).not.toBeDisabled());
});

test('an invalid amount, then another mention: the field is gone, Save is free and sends no threshold', async () => {
  api.updateSettings.mockResolvedValue(settings(30000));
  renderPage();
  await screen.findByLabelText('Seuil de franchise (€)');
  fireEvent.change(field(), { target: { value: 'abc' } });
  expect(save()).toBeDisabled();
  await pickMention('Location meublée exonérée — art. 261 D 4°');
  expect(screen.queryByLabelText('Seuil de franchise (€)')).not.toBeInTheDocument();
  await waitFor(() => expect(save()).not.toBeDisabled());
  fireEvent.click(save());
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  expect(api.updateSettings.mock.calls[0][0]).toEqual({ vat: { legalMention: 'art_261_d_4' } });
});

test('a valid amount typed, then another mention: nothing is sent for it (no 422 on a hidden field)', async () => {
  api.updateSettings.mockResolvedValue(settings(30000));
  renderPage();
  await screen.findByLabelText('Seuil de franchise (€)');
  fireEvent.change(field(), { target: { value: '45 000' } });
  await pickMention('Location meublée exonérée — art. 261 D 4°');
  fireEvent.click(save());
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  expect(api.updateSettings.mock.calls[0][0]).toEqual({ vat: { legalMention: 'art_261_d_4' } });
});

test('coming back to the franchise mention shows the stored amount again, not what was typed', async () => {
  renderPage();
  await screen.findByLabelText('Seuil de franchise (€)');
  fireEvent.change(field(), { target: { value: '45 000' } });
  await pickMention('Location meublée exonérée — art. 261 D 4°');
  await pickMention('Franchise en base — art. 293 B');
  expect(field().value.replace(/\s/g, '')).toBe('30000');
});

test('Cancel gives the stored amount back and clears the refusal', async () => {
  renderPage();
  await screen.findByLabelText('Seuil de franchise (€)');
  fireEvent.change(field(), { target: { value: '0' } });
  expect(screen.getByText('Montant supérieur à 0 €. Vide pour ne pas en fixer.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  await waitFor(() => expect(field().value.replace(/\s/g, '')).toBe('30000'));
  expect(screen.queryByText('Montant supérieur à 0 €. Vide pour ne pas en fixer.')).not.toBeInTheDocument();
  expect(save()).toBeDisabled();
});

test('a typed amount is sent alone under the franchise mention', async () => {
  let answer;
  api.updateSettings.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
  renderPage();
  await screen.findByLabelText('Seuil de franchise (€)');
  fireEvent.change(field(), { target: { value: '45 000' } });
  fireEvent.click(save());
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  await act(async () => { answer(settings(45000)); });
  expect(api.updateSettings.mock.calls[0][0]).toEqual({ vat: { franchiseThreshold: '45 000' } });
  expect(within(document.body).queryByText(/Seuil sans objet/)).not.toBeInTheDocument();
});
