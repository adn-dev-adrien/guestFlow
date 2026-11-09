// specs/mixed-method-payments.md rules 1, 32 — « Plusieurs moyens » at the check-out SAS: the lines open under
// the payment buttons, the commit button names what it collects, and the lines ride the commit.
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer, departurePreviewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 0 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  api.previewDepartureSas.mockImplementation(departurePreviewLikeTheServer(api));
});

async function toDepartureRecap() {
  api.getReservationSas.mockResolvedValue(sasPayload({ reservation: { cautionAmount: 0 }, cleaning: { included: false, price: 80 } }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('Pas OK');
  await screen.findByText(/serviettes et les draps sont-ils tous là/);
  clickBtn('Oui');
  await screen.findByText(/Clés du logement récupérées/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText(/Total à percevoir : 80,00 €/);
}

const amount = (i) => document.querySelector(`[data-tender-amount="${i}"]`);

test('rule 32 — the check-out records 30 € in the caisse + 50 € by card', async () => {
  await toDepartureRecap();
  fireEvent.click(document.querySelector('[data-split-toggle="departure"]'));
  expect(screen.queryByRole('button', { name: 'Payé en liquide' })).toBeNull();
  fireEvent.change(amount(0), { target: { value: '30' } });
  clickBtn('Encaisser 80,00 €');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.complementsSettled).toBe(true);
  expect(arg.complementsPaidCash).toBe(false);
  expect(arg.complementsTenders).toEqual([
    { method: 'cash', amountCents: 3000, internal: true },
    { method: 'card', amountCents: 5000, internal: false },
  ]);
});

test('rule 15 — short of the total, the commit waits for the choice and sends it', async () => {
  await toDepartureRecap();
  fireEvent.click(document.querySelector('[data-split-toggle="departure"]'));
  fireEvent.change(amount(0), { target: { value: '30' } });
  fireEvent.change(amount(1), { target: { value: '45' } });
  expect(screen.getByRole('button', { name: 'Encaisser 75,00 €' })).toBeDisabled();
  fireEvent.click(document.querySelector('[data-shortfall="due"]'));
  clickBtn('Encaisser 75,00 €');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  expect(api.commitDepartureSas.mock.calls[0][1].complementsShortfall).toEqual({ kind: 'due' });
});

test('rule 22 — « Un seul moyen » restores the payment buttons and the ordinary commit', async () => {
  await toDepartureRecap();
  fireEvent.click(document.querySelector('[data-split-toggle="departure"]'));
  fireEvent.click(document.querySelector('[data-split-toggle="departure"]'));
  clickBtn('CB / Chèque');
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  expect(api.commitDepartureSas.mock.calls[0][1].complementsTenders).toBeUndefined();
});
