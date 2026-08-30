// The departure wizard — specs/arrival-departure-sas.md, recall-unpaid-arrival-complement-at-checkout.md
//
// One file per subject (CLAUDE.md §9): two features appending their cases no longer collide on
// the last line of a shared suite. Fixtures used by more than one subject live in ./sasFixtures.
import { screen, fireEvent, waitFor } from '@testing-library/react';
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

test('departure SAS: shows the read-only handover note left at arrival', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0, departureHandoverNote: 'Récupérer la 2e clé' },
    cleaning: { included: false, price: 80 },
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  expect(screen.getByText('Note laissée à l\'arrivée')).toBeInTheDocument();
  expect(screen.getByText('Récupérer la 2e clé')).toBeInTheDocument();
});

test('departure SAS: cleaning page asks « fait correctement » (not the arrival UI) and commits the end-of-stay complement', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: false, price: 80 },
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // Regression: departure cleaning shows the OK/Pas OK question, not « Ajouter le ménage ».
  await screen.findByText(/Le ménage de fin de séjour a-t-il été fait correctement/);
  expect(screen.queryByRole('button', { name: 'Ajouter le ménage' })).toBeNull();
  clickBtn('Pas OK'); // → +80 end-of-stay

  // missing items? → Non
  await screen.findByText(/serviettes ou des draps sont-ils manquants/);
  clickBtn('Non');

  // keys → Oui
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');

  // extinguisher → « Oui » = bon état (no charge)
  await screen.findByText(/bon état/i);
  clickBtn('Oui');

  // recap (caution page skipped: cautionAmount 0)
  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText(/Total à percevoir : 80,00 €/)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  // The end-of-stay amount is computed server-side from the detail; the client sends the detail +
  // the extinguisher condition/charges (specs/extinguisher-seal-and-repair-amounts.md §3.2).
  expect(arg.endOfStayComplementDetail.some((l) => l.label === 'Ménage de fin de séjour' && l.amount === 80)).toBe(true);
  expect(arg.extinguisherSealOkAtDeparture).toBe(1);
  expect(arg.extinguisherCharges).toEqual([]);
  // Caution step skipped (cautionAmount 0) → no decision sent, the marker is left untouched
  // (specs/reopen-completed-sas.md §6 tri-state).
  expect(arg.cautionReturned).toBeUndefined();
});

test('departure SAS: an UNSETTLED arrival complement is recalled — detail + combined total + « Compléments encaissés »', async () => {
  // specs/recall-unpaid-arrival-complement-at-checkout.md — the arrival complement (12,50 €) was never
  // collected (paid: 0). The departure recap recalls it with its detail on top of the end-of-stay ménage,
  // shows the combined total, and ticking « Compléments encaissés » sends complementsSettled to the server.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: false, price: 80 },
    arrivalComplement: { amount: 12.5, paid: 0, detail: [{ label: 'Taxe de séjour', amount: 4.8 }, { label: 'Lit bébé', amount: 7.7 }] },
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
  // With an end-of-stay complement present, the arrival lines are MERGED plainly (no « non perçus »
  // warning header) but still counted in the total (2026-07-20 change).
  expect(screen.queryByText("Compléments d'arrivée non perçus")).toBeNull();
  expect(screen.getByText(/Taxe de séjour : 4,80 €/)).toBeInTheDocument();
  expect(screen.getByText(/Lit bébé : 7,70 €/)).toBeInTheDocument();
  // Combined total = 80 (ménage) + 12,50 (recalled arrival) — still includes the arrival amount.
  expect(screen.getByText(/Total à percevoir : 92,50 €/)).toBeInTheDocument();

  // Settle « CB / Chèque » (specs/sas-recap-payment-buttons.md) then validate.
  clickBtn('CB / Chèque');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.complementsSettled).toBe(true);
  expect(arg.complementsPaidCash).toBe(false);
  // The end-of-stay detail is unchanged — the arrival amount is NOT merged into it (kept separate).
  expect(arg.endOfStayComplementDetail.some((l) => l.label === 'Ménage de fin de séjour' && l.amount === 80)).toBe(true);
  expect(arg.endOfStayComplementDetail.some((l) => l.label === 'Taxe de séjour')).toBe(false);
});

test('departure SAS: a PAID arrival complement is NOT recalled', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: false, price: 80 },
    arrivalComplement: { amount: 12.5, paid: 1, detail: [{ label: 'Taxe de séjour', amount: 12.5 }] },
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('Pas OK');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.queryByText("Compléments d'arrivée non perçus")).toBeNull();
  expect(screen.getByText(/Total à percevoir : 80,00 €/)).toBeInTheDocument(); // ménage only
});

test('departure SAS: an unpaid arrival complement ALONE (no end-of-stay complement) keeps the « non perçus » warning', async () => {
  // 2026-07-20 — the warning framing is kept only when the recalled arrival complement is the sole thing
  // to collect (a genuinely forgotten arrival collection); with an end-of-stay complement it is merged.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: false, price: 80 },
    arrivalComplement: { amount: 12.5, paid: 0, detail: [{ label: 'Taxe de séjour', amount: 12.5 }] },
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('OK'); // ménage fait → NO end-of-stay charge
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText("Compléments d'arrivée non perçus")).toBeInTheDocument();
  expect(screen.getByText(/Total à percevoir : 12,50 €/)).toBeInTheDocument();
});

test('departure SAS: extinguisher not in good condition opens the tariff page; quantities ride to the payload as charges', async () => {
  // specs/extinguisher-seal-and-repair-amounts.md §3.2 — answering « Non » at departure opens the
  // extinguisher tariff page; the per-tariff quantity is sent as extinguisherCharges (priced server-side).
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: false, price: 80 },
    repairAmounts: [
      { id: 1, repairKey: 'extinguisher_seal', label: 'Plomb manquant', price: 30 },
      { id: 2, repairKey: 'extinguisher_use', label: 'Utilisation', price: 15 },
    ],
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('OK'); // cleaning OK → no cleaning charge
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');

  // extinguisher: « Non » = pas en bon état → opens the tariff-quantity page
  await screen.findByText(/bon état/i);
  clickBtn('Non');
  await screen.findByText('Frais extincteur à facturer');
  expect(screen.getByText('Plomb manquant')).toBeInTheDocument();
  expect(screen.getByText('Utilisation')).toBeInTheDocument();
  // First tariff (Plomb manquant) → qty 1; the « + » buttons are in tariff order.
  fireEvent.click(screen.getAllByRole('button', { name: '+' })[0]);
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText(/Total à percevoir : 30,00 €/)).toBeInTheDocument(); // 30 × 1
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.extinguisherSealOkAtDeparture).toBe(0);
  // Charges carry the quantities; the server prices them (not sent in the detail).
  expect(arg.extinguisherCharges).toEqual([
    { repairKey: 'extinguisher_seal', qty: 1, offered: false },
    { repairKey: 'extinguisher_use', qty: 0, offered: false },
  ]);
  expect(arg.endOfStayComplementDetail.some((l) => String(l.repairKey || '').startsWith('extinguisher'))).toBe(false);
});
