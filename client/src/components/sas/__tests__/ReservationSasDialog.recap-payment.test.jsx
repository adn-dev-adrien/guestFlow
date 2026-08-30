// The recap settlement buttons — specs/sas-recap-payment-buttons.md
//
// One file per subject (CLAUDE.md §9): two features appending their cases no longer collide on
// the last line of a shared suite. Fixtures used by more than one subject live in ./sasFixtures.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

// Mock the API the dialog consumes.
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 85 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    // Weather alerts (specs/checkin-weather-alerts.md) — fired in the background on arrival open.
    // Default to "no alert" so the wizard flow under test is unchanged.
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

// ---- recap settlement buttons (specs/sas-recap-payment-buttons.md) ----

async function openArrivalRecapWithComplement() {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, complementAmount: 50 },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Récapitulatif — complément à percevoir');
}

test('arrival recap: « CB / Chèque » settles the complement, not caisse interne', async () => {
  await openArrivalRecapWithComplement();
  clickBtn('CB / Chèque');
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.complementSettled).toBe(true);
  expect(arg.complementPaidCash).toBe(false);
});

test('arrival recap: « Payé en liquide » settles the complement into the caisse interne', async () => {
  await openArrivalRecapWithComplement();
  clickBtn('Payé en liquide');
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.complementSettled).toBe(true);
  expect(arg.complementPaidCash).toBe(true);
});

test('arrival recap: « En fin de séjour » leaves the complement unpaid (recalled at check-out)', async () => {
  await openArrivalRecapWithComplement();
  clickBtn('En fin de séjour');
  expect(screen.getByText(/Reporté au check-out/)).toBeInTheDocument();
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.complementSettled).toBe(false);
  expect(arg.complementPaidCash).toBe(false);
});

test('arrival recap: « En fin de séjour » is pre-selected — validating without choosing defers to check-out', async () => {
  await openArrivalRecapWithComplement();
  expect(screen.getByRole('button', { name: 'En fin de séjour' })).toHaveClass('MuiButton-contained');
  expect(screen.getByText(/Reporté au check-out/)).toBeInTheDocument();
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.complementSettled).toBe(false);
  expect(arg.complementPaidCash).toBe(false);
});

test('arrival recap: unselecting a settled mode falls back to « En fin de séjour »', async () => {
  await openArrivalRecapWithComplement();
  clickBtn('CB / Chèque');
  expect(screen.queryByText(/Reporté au check-out/)).toBeNull();
  clickBtn('CB / Chèque'); // click the active mode again → back to the default
  expect(screen.getByRole('button', { name: 'En fin de séjour' })).toHaveClass('MuiButton-contained');
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].complementSettled).toBe(false);
});

test('departure recap: « Payé en liquide » settles into caisse interne; no « En fin de séjour » button', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: false, price: 80 },
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('Pas OK'); // +80 end-of-stay
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText('Récapitulatif fin de séjour');

  expect(screen.queryByRole('button', { name: 'En fin de séjour' })).toBeNull();
  clickBtn('Payé en liquide');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.complementsSettled).toBe(true);
  expect(arg.complementsPaidCash).toBe(true);
});
