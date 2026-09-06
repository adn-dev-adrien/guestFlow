// The recap settlement buttons — specs/sas-recap-payment-buttons.md
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

// ── One payment at check-in (specs/single-payment-at-check-in.md §3.1) ──────────────────────────
// A last-minute guest takes a prestation during the check-in and pays everything with one card. The
// recap must ask ONCE — while keeping the two-settlement case one tap away.

const unifiablePayload = () => sasPayload({
  reservation: { cautionReceived: 1, cautionAmount: 0, complementAmount: 50, complementPaid: 0 },
  cleaning: { included: true, price: 80 },
  stayPayment: stayDue(),
  arrivalPayment: { complementOpen: true, group: null },
});

async function openUnifiedRecap() {
  api.getReservationSas.mockResolvedValue(unifiablePayload());
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Séjour à régler :');
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — à percevoir');
}

// specs/single-payment-at-check-in.md rule 1
test('arrival recap: both sides collectible → ONE settlement, not two', async () => {
  await openUnifiedRecap();

  // The two v2.8.0 headings are gone; a single « Règlement » stands for the whole collection.
  expect(screen.getByText('Règlement')).toBeInTheDocument();
  expect(screen.queryByText('Règlement du séjour')).toBeNull();
  expect(screen.queryByText('Règlement du complément')).toBeNull();
  // Both amounts are still listed, and the total is what the guest hands over.
  expect(screen.getByText(/Séjour : 480,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Total complément : 50,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Total à percevoir à l'arrivée : 530,00 €/)).toBeInTheDocument();
});

// specs/single-payment-at-check-in.md rule 2
test('arrival recap: « CB / Chèque » once settles both sides in a single payment', async () => {
  await openUnifiedRecap();
  clickBtn('CB / Chèque');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect(payload.arrivalPaymentMode).toBe('card');
  expect(payload.arrivalPaymentSplit).toBe(false);
});

// specs/single-payment-at-check-in.md rule 3
test('arrival recap: « Plus tard » is the default and collects nothing', async () => {
  await openUnifiedRecap();
  expect(screen.getByText(/le séjour reste dû et le complément est rappelé au check-out/i)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].arrivalPaymentMode).toBe('defer');
});

// specs/single-payment-at-check-in.md rule 4
test('arrival recap: « Régler séparément » brings the two settlements back, and back again', async () => {
  await openUnifiedRecap();
  clickBtn('Régler séparément');

  // The v2.8.0 shape, unchanged — the case where one side is collected and the other deferred.
  expect(await screen.findByText('Règlement du séjour')).toBeInTheDocument();
  expect(screen.getByText('Règlement du complément')).toBeInTheDocument();
  expect(screen.queryByText('Règlement')).toBeNull();

  clickBtn('Régler en une fois');
  expect(await screen.findByText('Règlement')).toBeInTheDocument();
  expect(screen.queryByText('Règlement du séjour')).toBeNull();
});

test('arrival recap: split mode commits the two independent settlements, not a group', async () => {
  await openUnifiedRecap();
  clickBtn('Régler séparément');
  await screen.findByText('Règlement du séjour');

  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].arrivalPaymentSplit).toBe(true);
});

// specs/single-payment-at-check-in.md rule 5
test('arrival recap: nothing owed on the stay → the complement settles alone, as before', async () => {
  // No stay step (nothing owed on the séjour), so there is nothing to unify: the recap keeps the
  // single complement block it has always had.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, complementAmount: 50 },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText('Règlement du complément')).toBeInTheDocument();
  expect(screen.queryByText('Régler séparément')).toBeNull();
});

// specs/adjustable-complement-amounts.md rule 2 — le montant ajusté ne se modifie QUE sur la fiche.
// Le SAS AFFICHE le complément — l'opérateur doit savoir combien percevoir — mais ne propose aucun
// moyen de le changer : le montant annoncé au client se décide sur la fiche, pas au milieu d'un
// assistant que la personne à l'accueil déroule à la porte.
test('rule 2 — le SAS affiche le complément mais n’offre aucun champ pour l’ajuster', async () => {
  await openArrivalRecapWithComplement();
  expect(screen.getByText('Récapitulatif — complément à percevoir')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Montant ajusté/i)).toBeNull();
});
