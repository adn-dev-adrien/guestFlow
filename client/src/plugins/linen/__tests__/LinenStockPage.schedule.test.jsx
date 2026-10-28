// specs/linen-laundry-days.md §3.4 rules 21-22 — the Linge page saves the stock and the laundry
// schedule, Cancel restores both, a refusal of the server keeps the draft and says why.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const toast = { showSuccess: vi.fn(), showError: vi.fn() };
vi.mock('../../../components/DialogProvider', () => ({ useToast: () => toast }));
vi.mock('../../../api', () => ({
  default: {
    getPluginSettings: vi.fn(),
    savePluginSettings: vi.fn(),
    getLaundrySchedule: vi.fn(),
    saveLaundrySchedule: vi.fn(),
    previewLaundrySchedule: vi.fn(),
  },
}));

import api from '../../../api';
import LinenStockPage from '../LinenStockPage';

const STOCK = {
  bedLinenStockSingle: '6', bedLinenStockDouble: '14', bedLinenStockBaby: '0',
  towelStockLarge: '20', towelStockMedium: '10', towelStockSmall: '12', towelStockBathMat: '3',
};
const CYCLE_TUESDAY = [{ dropWeekday: 2, pickUpWeekday: 2, waitDays: 7 }];
const inForce = { effectiveFrom: '0001-01-01', weekdays: [2], turnaroundDays: 1, cycle: CYCLE_TUESDAY, longestWaitDays: 7 };

function setup({ pending = null } = {}) {
  api.getPluginSettings.mockResolvedValue(STOCK);
  api.savePluginSettings.mockResolvedValue({});
  api.getLaundrySchedule.mockResolvedValue({ current: inForce, pending, tomorrow: '2026-10-29' });
  api.previewLaundrySchedule.mockResolvedValue({ cycle: CYCLE_TUESDAY, longestWaitDays: 7, firstTripOn: '2026-10-29' });
  return render(<MemoryRouter><LinenStockPage /></MemoryRouter>);
}

const save = () => screen.getByRole('button', { name: 'Enregistrer' });
const cancel = () => screen.getByRole('button', { name: 'Annuler' });

beforeEach(() => { vi.clearAllMocks(); });

test('specs/linen-laundry-days.md §3.4 rule 19: the page loads the schedule next to the stock, nothing to save yet', async () => {
  setup();
  expect(await screen.findByText('Blanchisserie')).toBeInTheDocument();
  expect(api.getLaundrySchedule).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Mardi' })).toHaveAttribute('aria-pressed', 'true');
  expect(save()).toBeDisabled();
  expect(screen.queryByText(/À partir de demain/)).not.toBeInTheDocument();
});

test('specs/linen-laundry-days.md §3.4 rule 21: a schedule change alone saves the schedule, not the stock, and says it starts tomorrow', async () => {
  const pending = { effectiveFrom: '2026-10-29', weekdays: [2, 4], turnaroundDays: 1, cycle: [], longestWaitDays: 5 };
  setup();
  await screen.findByText('Blanchisserie');
  fireEvent.click(screen.getByRole('button', { name: 'Jeudi' }));
  expect(screen.getByText('À partir de demain, jeu. 29 oct.')).toBeInTheDocument();
  expect(save()).toBeEnabled();
  api.saveLaundrySchedule.mockResolvedValue({ ok: true, current: inForce, pending, tomorrow: '2026-10-29' });
  fireEvent.click(save());
  await waitFor(() => expect(api.saveLaundrySchedule).toHaveBeenCalledWith({ weekdays: [2, 4], turnaroundDays: 1 }));
  expect(api.savePluginSettings).not.toHaveBeenCalled();
  await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Enregistré.'));
  expect(await screen.findByText('À partir de demain, jeu. 29 oct. — aujourd’hui : mardi')).toBeInTheDocument();
  expect(save()).toBeDisabled();
});

test('specs/linen-laundry-days.md §3.4 rule 21: stock and schedule changed together are both saved', async () => {
  setup();
  const doubles = await screen.findByLabelText('Doubles');
  fireEvent.change(doubles, { target: { value: '16' } });
  fireEvent.click(screen.getByRole('button', { name: 'Un jour de plus' }));
  api.saveLaundrySchedule.mockResolvedValue({ ok: true, current: inForce, pending: { ...inForce, effectiveFrom: '2026-10-29', turnaroundDays: 2 }, tomorrow: '2026-10-29' });
  fireEvent.click(save());
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledWith('linen', expect.objectContaining({ bedLinenStockDouble: 16 })));
  expect(api.savePluginSettings.mock.calls[0][1]).not.toHaveProperty('laundryWeekday');
  await waitFor(() => expect(api.saveLaundrySchedule).toHaveBeenCalledWith({ weekdays: [2], turnaroundDays: 2 }));
});

test('specs/linen-laundry-days.md §3.4 rule 21: Cancel restores the stock and the schedule', async () => {
  setup();
  const doubles = await screen.findByLabelText('Doubles');
  fireEvent.change(doubles, { target: { value: '16' } });
  fireEvent.click(screen.getByRole('button', { name: 'Jeudi' }));
  fireEvent.click(screen.getByRole('button', { name: 'Un jour de plus' }));
  expect(cancel()).toBeEnabled();
  fireEvent.click(cancel());
  await waitFor(() => expect(doubles).toHaveValue(14));
  expect(screen.getByRole('button', { name: 'Jeudi' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByLabelText('Délai en jours')).toHaveValue('1');
  expect(save()).toBeDisabled();
});

test('specs/linen-laundry-days.md §3.4 rule 20: an invalid turnaround disables Save', async () => {
  setup();
  await screen.findByText('Blanchisserie');
  fireEvent.change(screen.getByLabelText('Délai en jours'), { target: { value: '15' } });
  expect(screen.getByText('Entre 1 et 14 jours.')).toBeInTheDocument();
  expect(save()).toBeDisabled();
  expect(cancel()).toBeEnabled();
});

test('specs/linen-laundry-days.md §3.4 rule 21: a refusal of the server keeps the draft and shows its message under the field', async () => {
  setup();
  await screen.findByText('Blanchisserie');
  fireEvent.click(screen.getByRole('button', { name: 'Un jour de plus' }));
  api.saveLaundrySchedule.mockRejectedValue(Object.assign(new Error('Entre 1 et 14 jours.'), { field: 'turnaroundDays', code: 'LAUNDRY_TURNAROUND_INVALID' }));
  fireEvent.click(save());
  expect(await screen.findByText('Entre 1 et 14 jours.')).toBeInTheDocument();
  expect(screen.getByLabelText('Délai en jours')).toHaveValue('2');
  expect(toast.showError).not.toHaveBeenCalled();
  expect(save()).toBeEnabled();
  // Editing again clears the server's message.
  fireEvent.click(screen.getByRole('button', { name: 'Un jour de plus' }));
  expect(screen.queryByText('Entre 1 et 14 jours.')).not.toBeInTheDocument();
});

test('specs/linen-laundry-days.md §3.4 rule 21: a failure without a field is a toast and keeps the draft', async () => {
  setup();
  await screen.findByText('Blanchisserie');
  fireEvent.click(screen.getByRole('button', { name: 'Jeudi' }));
  api.saveLaundrySchedule.mockRejectedValue(new Error('Réseau indisponible'));
  fireEvent.click(save());
  await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('Réseau indisponible'));
  expect(screen.getByRole('button', { name: 'Jeudi' })).toHaveAttribute('aria-pressed', 'true');
});

test('specs/linen-laundry-days.md §3.4 rule 22: a pending version is what the page shows, with what is in force today', async () => {
  setup({ pending: { effectiveFrom: '2026-10-29', weekdays: [2, 4], turnaroundDays: 2, cycle: [], longestWaitDays: 5 } });
  expect(await screen.findByText('À partir de demain, jeu. 29 oct. — aujourd’hui : mardi')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Jeudi' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Délai en jours')).toHaveValue('2');
  expect(save()).toBeDisabled();
});

test('specs/linen-laundry-days.md §3.4 rule 22: going back to the version in force and saving sends it, so the server deletes the pending one', async () => {
  setup({ pending: { effectiveFrom: '2026-10-29', weekdays: [2, 4], turnaroundDays: 2, cycle: [], longestWaitDays: 5 } });
  await screen.findByText('À partir de demain, jeu. 29 oct. — aujourd’hui : mardi');
  fireEvent.click(screen.getByRole('button', { name: 'Jeudi' }));
  fireEvent.click(screen.getByRole('button', { name: 'Un jour de moins' }));
  api.saveLaundrySchedule.mockResolvedValue({ ok: true, current: inForce, pending: null, tomorrow: '2026-10-29' });
  fireEvent.click(save());
  await waitFor(() => expect(api.saveLaundrySchedule).toHaveBeenCalledWith({ weekdays: [2], turnaroundDays: 1 }));
  await waitFor(() => expect(screen.queryByText(/À partir de demain/)).not.toBeInTheDocument());
});
