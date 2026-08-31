// Collecting the stay at check-in — specs/collect-stay-payment-at-check-in.md
//
// One file per subject (CLAUDE.md §9): two features appending their cases no longer collide on
// the last line of a shared suite. Fixtures used by more than one subject live in ./sasFixtures.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, stayDue, renderDialog, clickBtn } from './sasFixtures';

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

// ── « Séjour à régler » — specs/collect-stay-payment-at-check-in.md ──────────────────────────────

test('arrival SAS: the stay step is absent when nothing is owed on the séjour', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    // Cleaning included → no ménage page: these cases are about the stay step only.
    cleaning: { included: true, price: 80 }, reservation: { cautionAmount: 0 } }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText('Séjour à régler :')).toBeNull();
});

test('arrival SAS: « CB / Chèque » on the stay step commits stayPaid without the caisse interne', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    // Cleaning included → no ménage page: these cases are about the stay step only.
    cleaning: { included: true, price: 80 },
    reservation: { cautionAmount: 0 }, stayPayment: stayDue(),
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText('Séjour à régler :');
  expect(screen.getByText('480,00 €')).toBeInTheDocument();
  // Direct channel → no platform warning.
  expect(screen.queryByText(/versé par la plateforme/)).toBeNull();
  clickBtn('CB / Chèque');
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif — à percevoir');
  expect(screen.getByText(/Séjour : 480,00 €/)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect(payload.stayPaid).toBe(true);
  expect(payload.stayPaidCash).toBe(false);
});

test('arrival SAS: « Payé en liquide » on the stay commits the caisse interne', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    // Cleaning included → no ménage page: these cases are about the stay step only.
    cleaning: { included: true, price: 80 },
    reservation: { cautionAmount: 0 }, stayPayment: stayDue(),
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText('Séjour à régler :');
  clickBtn('Payé en liquide');
  expect(screen.getByText('Encaissé en caisse interne (hors comptabilité).')).toBeInTheDocument();
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — à percevoir');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect(payload.stayPaid).toBe(true);
  expect(payload.stayPaidCash).toBe(true);
});

test('arrival SAS: « Pas maintenant » is the default — validating writes no stay payment', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    // Cleaning included → no ménage page: these cases are about the stay step only.
    cleaning: { included: true, price: 80 },
    reservation: { cautionAmount: 0 }, stayPayment: stayDue(),
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText('Séjour à régler :');
  expect(screen.getByText("Le séjour reste dû (rien n'est encaissé).")).toBeInTheDocument();
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — à percevoir');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect(payload.stayPaid).toBe(false);
  expect(payload.stayPaidCash).toBe(false);
});

test('arrival SAS: an OTA stay warns that the solde is the platform payout, and pre-selects nothing', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    // Cleaning included → no ménage page: these cases are about the stay step only.
    cleaning: { included: true, price: 80 },
    reservation: { cautionAmount: 0, platform: 'airbnb' },
    stayPayment: stayDue({ channel: 'platform', platformLabel: 'Airbnb' }),
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText('Séjour à régler :');
  expect(screen.getByText(/versé par la plateforme après le séjour/)).toBeInTheDocument();
  expect(screen.getByText("Le séjour reste dû (rien n'est encaissé).")).toBeInTheDocument();
});

test('arrival SAS: a re-opened SAS pre-selects the mode it recorded, and can undo it', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    // Cleaning included → no ménage page: these cases are about the stay step only.
    cleaning: { included: true, price: 80 },
    reservation: {
      cautionAmount: 0, arrivalSasDoneAt: '2026-07-10 16:00:00', complementPaid: 0, complementAmount: 0,
    },
    stayPayment: stayDue({
      total: 480, paid: true, paidCash: true,
      balance: { amount: 480, applicable: true, settled: true, due: 0, owned: true, collectible: 480 },
    }),
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText('Séjour à régler :');
  // The amount survives the re-open: it is what THIS SAS collected, not what is still owed.
  expect(screen.getByText('480,00 €')).toBeInTheDocument();
  expect(screen.getByText('Encaissé en caisse interne (hors comptabilité).')).toBeInTheDocument();
  clickBtn('Pas maintenant');
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — à percevoir');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect(payload.stayPaid).toBe(false);
});

// Superseded on 2026-08-30 by specs/single-payment-at-check-in.md: when BOTH sides are collectible
// the recap now asks once, because that is what happens at the door. The two independent settlements
// this spec introduced are still there — one tap away, behind « Régler séparément » — because the
// case rule 22 was written for (one side collected, the other deferred) is real.
test('arrival SAS recap: both sides listed, and « Régler séparément » restores the two settlements', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    // Cleaning included → no ménage page: these cases are about the stay step only.
    cleaning: { included: true, price: 80 },
    reservation: { cautionAmount: 0, complementAmount: 50, complementPaid: 0 },
    stayPayment: stayDue(),
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText('Séjour à régler :');
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif — à percevoir');
  expect(screen.getByText(/Séjour : 480,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Total complément : 50,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Total à percevoir à l'arrivée : 530,00 €/)).toBeInTheDocument();
  // One gesture by default — the guest hands over one card.
  expect(screen.getByText('Règlement')).toBeInTheDocument();

  // …and the two independent settlements are one tap away: the stay keeps « Pas maintenant », the
  // complement « En fin de séjour ».
  clickBtn('Régler séparément');
  expect(await screen.findByText('Règlement du séjour')).toBeInTheDocument();
  expect(screen.getByText('Règlement du complément')).toBeInTheDocument();
});
